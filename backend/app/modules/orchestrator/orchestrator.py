"""
Orchestrator Core — main engine.

Flow per query:
  1. Semantic cache check
  2. Task classifier → DOMAIN | CAPABILITY | HYBRID
  3. Coverage checker → ROUTE_MIXED | EXTEND_EXISTING | BUILD_NEW
  4. If BUILD_NEW/EXTEND_EXISTING: start SLM build, hold query (no fallback)
  5. If ROUTE_MIXED: SLM decomposes query into sub-tasks
  6. Model capability catalog selects specialists per sub-task
  7. Sub-tasks execute (domain SLM + specialists in parallel for HYBRID)
  8. Synthesize final answer with graph citations
  9. Hallucination evaluation
  10. Bandit update
  11. SSE stream all progress events
"""
import asyncio
import time
import uuid
from typing import AsyncGenerator

from app.adapters.registry import AdapterRegistry
from app.modules.task_classifier import TaskClassifier, TaskIntent
from app.modules.slm_factory.coverage_checker import CoverageChecker, CoverageAction
from app.modules.slm_factory.slm_registry import SLMRegistry
from app.modules.slm_factory.slm_builder import SLMBuilder
from app.modules.slm_factory.slm_store import SLMStore
from app.modules.slm_factory.bandit import get_bandit, save_bandit
from app.modules.model_capability_catalog import ModelCapabilityCatalog
from app.modules.token_efficiency.compressor import get_compressor
from app.modules.token_efficiency.semantic_cache import SemanticCache
from app.modules.evaluation.hallucination_detector import HallucinationDetector
from app.modules.orchestrator.orchestrator_output import (
    OrchestratorOutput, OrchestratorStep, StepExplanation,
    SubTaskResult, ModelRecommendationCard,
)
from app.config import get_settings

settings = get_settings()


def _conf(value: float | None, default: float = 0.5) -> float:
    """Clamp a confidence value to [0.0, 1.0], replacing nan/None with default."""
    import math
    if value is None or math.isnan(value) or math.isinf(value):
        return default
    return max(0.0, min(1.0, float(value)))

DECOMPOSITION_PROMPT = """\
You are a domain specialist. Decompose this query into sub-tasks.
For each sub-task, specify:
  - task_type: one of [domain_qa, code_generation, data_analysis, time_series, general_reasoning, ui_building, financial, geospatial]
  - query_fragment: the specific sub-question
  - my_confidence: 0.0-1.0 (how confident you are you can answer this from your domain knowledge)

Respond ONLY with a JSON array. Example:
[
  {{"task_type": "domain_qa", "query_fragment": "What entities are involved?", "my_confidence": 0.9}},
  {{"task_type": "code_generation", "query_fragment": "Write SQL for this", "my_confidence": 0.1}}
]

Query: {query}
"""

SYNTHESIS_PROMPT = """\
You are synthesizing a final answer from multiple specialist responses.
Cite the graph entities used to derive each point.

Original query: {query}
Sub-task results:
{sub_results}

Graph context summary:
{graph_context}

Provide a comprehensive answer that:
1. Integrates all sub-task results coherently
2. Explicitly cites entity IDs as [entity_id] when stating a fact
3. Flags any areas of uncertainty
"""


class Orchestrator:
    def __init__(
        self,
        adapter_registry: AdapterRegistry,
        slm_registry: SLMRegistry,
        slm_store: SLMStore,
        embed_fn,           # async (str) -> list[float]
        redis_client=None,
    ):
        self._adapters = adapter_registry
        self._slm_registry = slm_registry
        self._slm_store = slm_store
        self._embed = embed_fn
        self._cache = SemanticCache(redis_client) if redis_client else None
        self._classifier = TaskClassifier(embed_fn=embed_fn)
        self._coverage = CoverageChecker(slm_registry, embed_fn)
        self._catalog = ModelCapabilityCatalog(adapter_registry, get_bandit())
        self._compressor = get_compressor()
        self._detector = HallucinationDetector(adapter_registry)
        self._builder = SLMBuilder(slm_registry, adapter_registry, slm_store, settings.slm_store_path)

    async def run(
        self,
        query: str,
        session_id: str | None = None,
        graph_context: str = "",
        wiki_articles: list[dict] | None = None,
        domain_label: str = "general",
        coverage_topics: list[str] | None = None,
        corpus_hash: str = "",
        available_models: list[str] | None = None,
        system_prompt: str = "",
        scoring_weights=None,   # app.routes.orchestrator.ModelWeights | None
    ) -> AsyncGenerator[dict, None]:
        """
        Full orchestration pipeline. Yields SSE-compatible events.
        Last event has type="output" containing OrchestratorOutput.
        """
        session_id = session_id or str(uuid.uuid4())
        output = OrchestratorOutput(
            session_id=session_id,
            query=query,
            intent="",
            primary_task_type="",
            coverage_action="",
        )
        steps: list[OrchestratorStep] = []

        # Build sys_prefix once — prepended to every LLM call this session
        sys_prefix = f"[System] {system_prompt.strip()}\n\n" if system_prompt.strip() else ""

        # Pre-compute embedding once — reused by classifier, coverage checker, and bandit
        query_embedding = await self._embed(query)

        # ── Semantic cache check (short-circuit on hit) ───────────────
        if self._cache:
            try:
                cached = await self._cache.get(query, query_embedding)
                if cached and isinstance(cached, dict):
                    output = OrchestratorOutput(**{
                        **output.model_dump(),
                        **{k: v for k, v in cached.items() if k in OrchestratorOutput.model_fields},
                        "cached_hit": True,
                        "session_id": session_id,
                        "query": query,
                    })
                    yield {"type": "step", "step": 0, "data": {"step_number": 0, "step_name": "Semantic Cache Hit", "duration_ms": int((time.monotonic() - (time.monotonic())) * 1000), "explanation": {"what": "Found semantically similar cached answer", "why": "Avoids redundant LLM calls for repeated or similar queries", "what_we_found": "Cache hit", "decision_made": "Returning cached result", "confidence": 1.0, "caveats": [], "graph_entity_ids": []}}}
                    yield {"type": "output", "data": output.model_dump()}
                    return
            except Exception:
                pass

        # ── Step 1: Task Classification ───────────────────────────────
        t0 = time.monotonic()
        classification = await self._classifier.classify(query, query_embedding)
        output.intent = classification.intent.value
        output.primary_task_type = classification.primary_task_type

        steps.append(OrchestratorStep(
            step_number=1,
            step_name="Task Classification",
            duration_ms=int((time.monotonic() - t0) * 1000),
            explanation=StepExplanation(
                what="Classified the query intent using keyword analysis",
                why="Determines whether to route to domain SLM, capability model, or both",
                what_we_found=classification.reasoning,
                decision_made=f"Intent: {classification.intent.value} | Task: {classification.primary_task_type}",
                confidence=_conf(classification.confidence),
                caveats=["Keyword-based; may be updated after SLM routing plan"],
                graph_entity_ids=[],
            ),
        ))
        yield {"type": "step", "step": 1, "data": steps[-1].model_dump()}

        # ── Step 2: Coverage Check ────────────────────────────────────
        t0 = time.monotonic()
        coverage = await self._coverage.check(query, query_embedding)
        output.coverage_action = coverage.action.value
        # Validate that the matched Ollama model is actually available; fall back to best if not
        if coverage.model_id:
            adapter = await self._adapters.get_adapter_for_model(coverage.model_id)
            if adapter is None:
                _fallback = await self._adapters.get_best_local_model()
                coverage.model_id = _fallback.model_id if _fallback else None
                coverage.reason += f" | model unavailable, using {coverage.model_id}"
        output.slm_model_id = coverage.model_id

        steps.append(OrchestratorStep(
            step_number=2,
            step_name="Coverage Check",
            duration_ms=int((time.monotonic() - t0) * 1000),
            explanation=StepExplanation(
                what="Checked SLM registry for domain coverage via vector similarity",
                why="Determine if existing SLM can handle this query or a new one must be built",
                what_we_found=coverage.reason,
                decision_made=coverage.action.value,
                confidence=_conf(coverage.similarity),
                caveats=["Similarity threshold 0.82 for full match, 0.65 for partial"],
                graph_entity_ids=[],
            ),
        ))
        yield {"type": "step", "step": 2, "data": steps[-1].model_dump()}

        # ── Step 3: SLM Build (if needed) ────────────────────────────
        if coverage.action in (CoverageAction.BUILD_NEW, CoverageAction.EXTEND_EXISTING):
            output.build_in_progress = True
            output.estimated_build_minutes = 74
            yield {"type": "build_start", "model_id": "pending", "message": "Building domain SLM — no fallback, your query will be answered after build completes"}

            if wiki_articles:
                # Enrich domain embedding with a sample of the actual corpus text
                _corpus_sample = " ".join(
                    a.get("text", a.get("content", ""))[:200]
                    for a in (wiki_articles or [])[:5]
                )[:500]
                _emb_text = f"{domain_label} {' '.join(coverage_topics or [])} {_corpus_sample}".strip()
                domain_embedding = await self._embed(_emb_text)
                async for event in self._builder.build(
                    domain_label=domain_label,
                    wiki_articles=wiki_articles,
                    domain_embedding=domain_embedding,
                    coverage_topics=coverage_topics or [],
                    corpus_hash=corpus_hash,
                    trigger_query=query,
                ):
                    yield {**event, "phase": "slm_build"}
                    if event.get("type") == "done":
                        # Use the actual Ollama model name (fallback or trained), not the registry ID
                        output.slm_model_id = event.get("ollama_name") or event.get("model_id")
                        output.build_in_progress = False
                        # Refresh available_models so the newly built SLM is included in scoring
                        _refreshed = await self._adapters.list_all_models()
                        available_models = [m.model_id for m in _refreshed]
            else:
                yield {"type": "warning", "message": "No wiki articles provided — cannot build SLM"}
                output.error = "No corpus available for SLM build"

        # ── Step 4: Query Decomposition ───────────────────────────────
        sub_tasks = []
        if output.slm_model_id:
            t0 = time.monotonic()
            decomp_prompt = sys_prefix + DECOMPOSITION_PROMPT.format(query=query)
            try:
                raw_decomp = await asyncio.wait_for(
                    self._adapters.generate(
                        output.slm_model_id, decomp_prompt, temperature=0.1
                    ),
                    timeout=120.0,
                )
            except asyncio.TimeoutError:
                raw_decomp = ""
            import json, re
            match = re.search(r"\[.*?\]", raw_decomp, re.DOTALL)
            if match:
                try:
                    sub_tasks = json.loads(match.group())
                except Exception:
                    sub_tasks = []

            # Gate 2+3: re-evaluate coverage with SLM confidence
            if sub_tasks:
                routing_plan = {"sub_tasks": sub_tasks}
                coverage = await self._coverage.evaluate_routing_plan(routing_plan, coverage)
                output.coverage_action = coverage.action.value

            steps.append(OrchestratorStep(
                step_number=3,
                step_name="Query Decomposition",
                duration_ms=int((time.monotonic() - t0) * 1000),
                explanation=StepExplanation(
                    what="Domain SLM decomposed the query into sub-tasks",
                    why="Identify which parts need domain knowledge vs specialist capability",
                    what_we_found=f"Found {len(sub_tasks)} sub-tasks",
                    decision_made=f"Routing: {coverage.action.value}",
                    confidence=_conf(coverage.max_confidence, 0.5),
                    caveats=["SLM confidence used to re-evaluate coverage action"],
                    graph_entity_ids=[],
                ),
            ))
            yield {"type": "step", "step": 3, "data": steps[-1].model_dump()}

        # ── Step 5: Model Recommendations ────────────────────────────
        t0 = time.monotonic()
        all_recs: list[ModelRecommendationCard] = []

        task_types_needed = list({st.get("task_type", "domain_qa") for st in sub_tasks})
        if not task_types_needed:
            task_types_needed = [classification.primary_task_type]

        for task_type in task_types_needed:
            recs = await self._catalog.recommend(
                task_type=task_type,
                query_embedding=query_embedding,
                available_models=available_models or [],
                token_count=len(query.split()),
                # slm_model_id intentionally not passed — SLM is for orchestration only
                scoring_weights=scoring_weights,
            )
            for r in recs[:2]:
                all_recs.append(ModelRecommendationCard(
                    model_name=r.model_name,
                    provider=r.provider,
                    task_type=task_type,
                    benchmark_score=r.benchmark_score,
                    composite_score=r.composite_score,
                    speed_score=r.speed_score,
                    why_primary=r.why_primary,
                    why_not_alternatives=r.why_not_alternatives,
                    is_primary=r.is_primary,
                    is_available_locally=r.availability_score >= 0.9,
                ))

        output.model_recommendations = all_recs
        steps.append(OrchestratorStep(
            step_number=4,
            step_name="Model Recommendations",
            duration_ms=int((time.monotonic() - t0) * 1000),
            explanation=StepExplanation(
                what="Selected optimal models per sub-task using capability catalog + bandit scores",
                why="Match each sub-task to the model with the best benchmark + availability + learning history",
                what_we_found=f"Evaluated {sum(len(MODEL_CATALOG.get(t, [])) for t in task_types_needed)} candidate models",
                decision_made=f"Recommended {len(all_recs)} models for {len(task_types_needed)} task types",
                confidence=_conf(max((r.composite_score for r in all_recs), default=0.5)),
                caveats=["Bandit scores improve with usage; cold-start defaults to benchmark-only"],
                graph_entity_ids=[],
            ),
        ))
        yield {"type": "step", "step": 4, "data": steps[-1].model_dump()}

        # ── Step 6: Sub-task Execution ────────────────────────────────
        t0 = time.monotonic()
        compressed_context = graph_context
        if graph_context and len(graph_context) > 2000:
            compressed_context = self._compressor.compress(graph_context, query)
            output.tokens_saved_by_compression = max(0, len(graph_context.split()) - len(compressed_context.split()))

        sub_results: list[SubTaskResult] = []
        for st in sub_tasks:
            task_type = st.get("task_type", "domain_qa")
            fragment = st.get("query_fragment", query)

            # Pick primary model for this task_type
            model_for_task = None
            for rec in all_recs:
                if rec.task_type == task_type and rec.is_primary:
                    model_for_task = rec.model_name
                    break
            if not model_for_task:
                _best = await self._adapters.get_best_local_model()
                model_for_task = _best.model_id if _best else None
            if not model_for_task:
                continue

            context_prefix = f"{sys_prefix}Knowledge Graph Context:\n{compressed_context}\n\n" if compressed_context else sys_prefix
            try:
                response = await asyncio.wait_for(
                    self._adapters.generate(
                        model_for_task,
                        f"{context_prefix}Question: {fragment}",
                        temperature=0.2,
                    ),
                    timeout=180.0,
                )
            except asyncio.TimeoutError:
                response = "[Response timed out — model took too long. Try a smaller model.]"
            except Exception as exc:
                # Primary model unavailable (no API key / not installed) — fall back to best local
                _fallback_info = await self._adapters.get_best_local_model()
                fallback_model = _fallback_info.model_id if _fallback_info else None
                if fallback_model and fallback_model != model_for_task:
                    try:
                        response = await asyncio.wait_for(
                            self._adapters.generate(
                                fallback_model,
                                f"{context_prefix}Question: {fragment}",
                                temperature=0.2,
                            ),
                            timeout=180.0,
                        )
                        model_for_task = fallback_model
                    except Exception as exc2:
                        response = f"[Error: {exc2}]"
                else:
                    response = f"[Error: {exc}]"

            sub_results.append(SubTaskResult(
                task_type=task_type,
                query_fragment=fragment,
                assigned_model=model_for_task,
                response=response,
                confidence=_conf(st.get("my_confidence", 0.5)),
            ))

        if not sub_results:
            # No decomposition — use catalog recommendation for the direct answer
            _exec_recs = await self._catalog.recommend(
                task_type=classification.primary_task_type,
                query_embedding=query_embedding,
                available_models=available_models or [],
                token_count=len(query.split()),
                scoring_weights=scoring_weights,
            )
            _exec_model = next((r.model_name for r in _exec_recs if r.is_primary), None)
            if not _exec_model:
                _best = await self._adapters.get_best_local_model()
                _exec_model = _best.model_id if _best else None
            if _exec_model:
                context_prefix = f"{sys_prefix}Knowledge Graph Context:\n{compressed_context}\n\n" if compressed_context else sys_prefix
                try:
                    response = await asyncio.wait_for(
                        self._adapters.generate(
                            _exec_model,
                            f"{context_prefix}Question: {query}",
                            temperature=0.2,
                        ),
                        timeout=180.0,
                    )
                    sub_results.append(SubTaskResult(
                        task_type=classification.primary_task_type,
                        query_fragment=query,
                        assigned_model=_exec_model,
                        response=response,
                        confidence=0.7,
                    ))
                except Exception:
                    pass

        output.sub_task_results = sub_results
        steps.append(OrchestratorStep(
            step_number=5,
            step_name="Sub-task Execution",
            duration_ms=int((time.monotonic() - t0) * 1000),
            explanation=StepExplanation(
                what="Executed each sub-task with its assigned specialist model",
                why="Domain knowledge + capability separation ensures each part uses the best model",
                what_we_found=f"Completed {len(sub_results)} sub-tasks",
                decision_made="All sub-tasks answered",
                confidence=_conf(sum(r.confidence for r in sub_results) / max(len(sub_results), 1)),
                caveats=[],
                graph_entity_ids=[],
            ),
        ))
        yield {"type": "step", "step": 5, "data": steps[-1].model_dump()}

        # ── Step 7: Synthesis ─────────────────────────────────────────
        t0 = time.monotonic()
        sub_results_text = "\n\n".join(
            f"[{r.task_type}] {r.query_fragment}\n→ {r.response}" for r in sub_results
        )
        _best_synth = await self._adapters.get_best_local_model()
        synth_model = output.slm_model_id or (_best_synth.model_id if _best_synth else None)
        final_answer = ""
        if synth_model and sub_results_text:
            synth_prompt = sys_prefix + SYNTHESIS_PROMPT.format(
                query=query,
                sub_results=sub_results_text[:3000],
                graph_context=compressed_context[:1000],
            )
            try:
                final_answer = await asyncio.wait_for(
                    self._adapters.generate(synth_model, synth_prompt, temperature=0.15),
                    timeout=180.0,
                )
            except asyncio.TimeoutError:
                final_answer = sub_results_text
            except Exception:
                final_answer = sub_results_text

        output.final_answer = final_answer
        steps.append(OrchestratorStep(
            step_number=6,
            step_name="Answer Synthesis",
            duration_ms=int((time.monotonic() - t0) * 1000),
            explanation=StepExplanation(
                what="Domain SLM synthesized all sub-task results into a final coherent answer",
                why="Coherent integration with graph citations and uncertainty flagging",
                what_we_found=f"Synthesized {len(sub_results)} results into final answer",
                decision_made="Final answer ready",
                confidence=0.8,
                caveats=["Citations are entity IDs from graph.json"],
                graph_entity_ids=[],
            ),
        ))
        yield {"type": "step", "step": 6, "data": steps[-1].model_dump()}

        # ── Step 8: Hallucination Check ───────────────────────────────
        if final_answer and graph_context:
            hall_result = await self._detector.detect(final_answer, graph_context[:2000])
            output.hallucination_rate = hall_result.hallucination_rate
            for sr in sub_results:
                sr.hallucination_verdict = hall_result.verdict

        # ── Step 9: Bandit Update ─────────────────────────────────────
        if output.slm_model_id and query_embedding:
            bandit = get_bandit()
            reward = bandit.compute_reward(
                task_completion=0.9 if final_answer else 0.0,
                hallucination_rate=output.hallucination_rate,
                user_acceptance=0.7,
            )
            context_vec = bandit._build_feature_vector(
                query_embedding, classification.primary_task_type, len(query.split()), 5
            )
            bandit.update(output.slm_model_id, context_vec.tolist(), reward)
            save_bandit()

        output.steps = steps

        if self._cache and final_answer:
            try:
                await self._cache.set(query, query_embedding, output.model_dump())
            except Exception:
                pass

        yield {"type": "output", "data": output.model_dump()}


# Import MODEL_CATALOG for Step 5 count
from app.modules.model_capability_catalog import MODEL_CATALOG
