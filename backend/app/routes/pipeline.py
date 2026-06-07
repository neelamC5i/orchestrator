"""
Pipeline control-plane routes.
GET   /api/v1/pipeline/{job_id}/state           — full node topology with per-node status
PATCH /api/v1/pipeline/{job_id}/config          — write thresholds to Redis pipeline_config:{job_id}
POST  /api/v1/pipeline/{job_id}/approve/{step}  — set Redis gate:{job_id}:{step}=approved
POST  /api/v1/pipeline/{job_id}/pause           — set Redis pipeline_pause:{job_id}=1
POST  /api/v1/pipeline/{job_id}/resume          — delete that key
GET   /api/v1/pipeline/{job_id}/entities/preview — top-20 entities from graph
GET   /api/v1/pipeline/{job_id}/layer/{layer_id} — per-layer artifact detail
GET   /api/v1/pipeline/{job_id}/kpis            — aggregate header KPIs
"""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter(prefix="/pipeline", tags=["pipeline"])

# ── Redis helpers ─────────────────────────────────────────────────────────────

def _get_redis():
    import redis as _redis
    from app.config import get_settings
    s = get_settings()
    return _redis.from_url(s.redis_url, decode_responses=True)


# ── Models ────────────────────────────────────────────────────────────────────

class PipelineConfigPatch(BaseModel):
    quality_threshold: float | None = None
    dedup_sensitivity: int | None = None
    selected_model: str | None = None
    gates_enabled: bool | None = None


# ── Node topology helper ──────────────────────────────────────────────────────

_STEP_STATUS_MAP = {
    "ingesting":        {"import": "running"},
    "deduplicating":    {"import": "done",    "clean":   "running"},
    "quality_scoring":  {"import": "done",    "clean":   "done",    "quality": "running"},
    "graph_building":   {"import": "done",    "clean":   "done",    "quality": "done",    "graph": "running"},
    "graph_done":       {"import": "done",    "clean":   "done",    "quality": "done",    "graph": "done"},
    "failed":           {},
}

def _build_topology(db_status: str) -> list[dict]:
    status_map = _STEP_STATUS_MAP.get(db_status, {})
    nodes = [
        {"id": "import",  "label": "Import Data",       "icon": "📥"},
        {"id": "clean",   "label": "Clean & Organize",   "icon": "🧹"},
        {"id": "quality", "label": "Readiness Check",    "icon": "📊"},
        {"id": "graph",   "label": "Knowledge Graph",    "icon": "🕸️"},
        {"id": "ai",      "label": "Select AI Models",   "icon": "🤖"},
        {"id": "answer",  "label": "Generate Answer",    "icon": "✨"},
    ]
    for node in nodes:
        node["status"] = status_map.get(node["id"], "pending")
    return nodes


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("/{job_id}/state")
async def get_state(job_id: str):
    """Return full pipeline topology with per-node statuses."""
    from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker
    from sqlalchemy.pool import NullPool
    from sqlalchemy import text as sql_text
    from app.config import get_settings
    import json

    s = get_settings()
    engine = create_async_engine(s.database_url, echo=False, poolclass=NullPool)
    factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    async with factory() as db:
        row = await db.execute(
            sql_text("SELECT status, progress FROM ingest_jobs WHERE job_id = :id"),
            {"id": job_id},
        )
        result = row.fetchone()

    await engine.dispose()

    if not result:
        raise HTTPException(status_code=404, detail="Job not found")

    db_status, progress_json = result
    progress = json.loads(progress_json) if isinstance(progress_json, str) else (progress_json or {})

    # Check Redis for gate states
    try:
        r = _get_redis()
        gate_states = {}
        for step in ["import", "clean", "quality", "graph", "model"]:
            val = r.get(f"gate:{job_id}:{step}")
            gate_states[step] = val or "pending"
        paused = r.exists(f"pipeline_pause:{job_id}") == 1
    except Exception:
        gate_states = {}
        paused = False

    topology = _build_topology(db_status)

    return {
        "job_id": job_id,
        "db_status": db_status,
        "overall_pct": progress.get("overall_pct", 0),
        "eta_seconds": progress.get("eta_seconds"),
        "nodes": topology,
        "gate_states": gate_states,
        "paused": paused,
    }


@router.patch("/{job_id}/config")
async def patch_config(job_id: str, body: PipelineConfigPatch):
    """Write pipeline config overrides to Redis (picked up by ingest task on next gate)."""
    try:
        r = _get_redis()
        import json
        existing_raw = r.get(f"pipeline_config:{job_id}")
        existing = json.loads(existing_raw) if existing_raw else {}
        patch = body.model_dump(exclude_none=True)
        existing.update(patch)
        r.set(f"pipeline_config:{job_id}", json.dumps(existing), ex=86400)
        return {"status": "ok", "config": existing}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/{job_id}/approve/{step}")
async def approve_gate(job_id: str, step: str):
    """Signal that the user has approved the gate for a given pipeline step."""
    valid = {"import", "clean", "quality", "graph", "model"}
    if step not in valid:
        raise HTTPException(status_code=400, detail=f"Invalid step. Must be one of: {valid}")
    try:
        r = _get_redis()
        r.set(f"gate:{job_id}:{step}", "approved", ex=3600)
        return {"status": "approved", "job_id": job_id, "step": step}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/{job_id}/pause")
async def pause_pipeline(job_id: str):
    """Pause the pipeline — ingest task will stop at next checkpoint."""
    try:
        r = _get_redis()
        r.set(f"pipeline_pause:{job_id}", "1", ex=3600)
        return {"status": "paused", "job_id": job_id}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/{job_id}/resume")
async def resume_pipeline(job_id: str):
    """Resume a paused pipeline."""
    try:
        r = _get_redis()
        r.delete(f"pipeline_pause:{job_id}")
        return {"status": "resumed", "job_id": job_id}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/{job_id}/layer/{layer_id}")
async def get_layer_detail(job_id: str, layer_id: str):
    """Return per-layer artifact detail for the given pipeline layer."""
    from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker
    from sqlalchemy.pool import NullPool
    from sqlalchemy import text as sql_text
    from app.config import get_settings
    import json, os, glob

    valid_layers = {
        "upload", "extract", "clean", "chunk", "metadata", "entities",
        "semantic", "eda", "validation", "ontology", "canonical",
        "graph_build", "graph_consist", "wiki",
    }
    if layer_id not in valid_layers:
        raise HTTPException(status_code=400, detail=f"Invalid layer_id. Must be one of: {valid_layers}")

    s = get_settings()
    engine = create_async_engine(s.database_url, echo=False, poolclass=NullPool)
    factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    async with factory() as db:
        row = await db.execute(
            sql_text("SELECT metadata, progress FROM ingest_jobs WHERE job_id = :id"),
            {"id": job_id},
        )
        result = row.fetchone()

    await engine.dispose()

    if not result:
        raise HTTPException(status_code=404, detail="Job not found")

    meta_raw, progress_raw = result
    meta = json.loads(meta_raw) if isinstance(meta_raw, str) else (meta_raw or {})
    progress = json.loads(progress_raw) if isinstance(progress_raw, str) else (progress_raw or {})

    corpus_dir = meta.get("corpus_dir", f"corpus_store/{job_id}")
    processed_dir = os.path.join(corpus_dir, "processed")

    step_data = {}
    for st in progress.get("steps", []):
        if st.get("id") == layer_id:
            step_data = st
            break

    detail_str = step_data.get("detail", "{}")
    try:
        step_detail = json.loads(detail_str) if detail_str else {}
    except (json.JSONDecodeError, TypeError):
        step_detail = {"raw": detail_str}

    artifacts = {}

    def _safe_read_json(path):
        try:
            with open(path, encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            return None

    def _glob_read(pattern, limit=5):
        paths = glob.glob(os.path.join(processed_dir, pattern))
        results = []
        for p in paths[:limit]:
            data = _safe_read_json(p)
            if data is not None:
                results.append(data)
        return results

    if layer_id == "upload":
        artifacts = step_detail

    elif layer_id == "extract":
        corpus_files = glob.glob(os.path.join(processed_dir, "*_corpus.json"))
        artifacts = {
            **step_detail,
            "corpus_files": [os.path.basename(f) for f in corpus_files],
        }

    elif layer_id in ("clean", "chunk"):
        artifacts = step_detail

    elif layer_id == "metadata":
        artifacts = step_detail

    elif layer_id == "entities":
        cg = _safe_read_json(os.path.join(corpus_dir, "canonical_graph.json"))
        entity_sample, rel_sample = [], []
        if cg:
            nodes = cg.get("nodes", [])
            edges = [e for e in cg.get("edges", []) if not e.get("suppressed")]
            entity_sample = sorted(nodes, key=lambda n: n.get("confidence", 0), reverse=True)[:30]
            rel_sample = sorted(edges, key=lambda e: e.get("confidence", 0), reverse=True)[:30]

        per_file_graphs = glob.glob(os.path.join(corpus_dir, "graphs", "*_graph.json"))
        visuals = _glob_read("*_eda_visuals.json", 1)
        conf_hist = visuals[0].get("confidence_histograms", {}) if visuals else {}

        artifacts = {
            **step_detail,
            "entity_sample": entity_sample,
            "relationship_sample": rel_sample,
            "per_file_graph_count": len(per_file_graphs),
            "confidence_histograms": conf_hist,
        }

    elif layer_id == "semantic":
        visuals = _glob_read("*_eda_visuals.json", 1)
        conf_hist = visuals[0].get("confidence_histograms", {}) if visuals else {}
        artifacts = {
            **step_detail,
            "confidence_histograms": conf_hist,
        }

    elif layer_id == "eda":
        eda_summaries = _glob_read("*_eda_summary.json", 5)
        scorecards = _glob_read("*_kg_scorecard.json", 5)
        visuals = _glob_read("*_eda_visuals.json", 5)
        graph_vals = _glob_read("*_graph_validation.json", 5)

        artifacts = {
            **step_detail,
            "eda_summaries": eda_summaries,
            "scorecards": scorecards,
            "visuals": visuals,
            "graph_validations": graph_vals,
        }

    elif layer_id == "validation":
        scorecards = _glob_read("*_kg_scorecard.json", 5)
        score_breakdown = {}
        if scorecards:
            sc = scorecards[0]
            for k in ("overall_kg_quality_score", "completeness_score", "consistency_score",
                       "confidence_score", "graph_trust_score", "retrieval_readiness_score",
                       "semantic_coherence_score", "canonical_resolution_score",
                       "extraction_reliability_score"):
                score_breakdown[k] = sc.get(k, 0)
        artifacts = {**step_detail, "scorecards": scorecards, "score_breakdown": score_breakdown}

    elif layer_id == "ontology":
        graph_vals = _glob_read("*_graph_validation.json", 5)
        eda_summaries = _glob_read("*_eda_summary.json", 3)
        semantic_metrics = {}
        if eda_summaries:
            semantic_metrics = eda_summaries[0].get("semantic_quality_metrics", {})

        all_violations, all_contradictions, all_temporal = [], [], []
        for gv in graph_vals:
            all_violations.extend(gv.get("ontology_violations", [])[:10])
            all_contradictions.extend(gv.get("semantic_inconsistencies", [])[:10])
        for es_data in eda_summaries:
            sqm = es_data.get("semantic_quality_metrics", {})
            all_temporal.extend(sqm.get("temporal_inconsistencies", [])[:10])

        artifacts = {
            **step_detail,
            "validations": graph_vals,
            "semantic_metrics": semantic_metrics,
            "violation_samples": all_violations[:20],
            "contradiction_samples": all_contradictions[:20],
            "temporal_issues": all_temporal[:10],
        }

    elif layer_id == "canonical":
        reg_path = os.path.join(corpus_dir, "canonical_registry.json")
        reg = _safe_read_json(reg_path)
        cn = (reg or {}).get("canonical_nodes", [])
        merge_history = (reg or {}).get("merge_history", [])
        pending_reviews = (reg or {}).get("pending_reviews", [])
        artifacts = {
            **step_detail,
            "registry_summary": {
                "total_nodes": len(cn),
                "total_aliases": sum(len(n.get("aliases", [])) for n in cn),
                "merge_count": len(merge_history),
                "pending_review_count": len(pending_reviews),
            },
            "merge_history_sample": merge_history[:15],
            "pending_review_sample": pending_reviews[:10],
        }

    elif layer_id == "graph_build":
        graph_path = os.path.join(corpus_dir, "canonical_graph.json")
        graph = _safe_read_json(graph_path)
        per_file_graphs = glob.glob(os.path.join(corpus_dir, "graphs", "*_graph.json"))

        if graph:
            nodes = graph.get("nodes", [])
            edges = [e for e in graph.get("edges", []) if not e.get("suppressed")]
            stats = graph.get("stats", {})
            conf_dist = {"low": 0, "medium": 0, "high": 0}
            for e in edges:
                c = e.get("confidence", 0)
                if c < 0.4:
                    conf_dist["low"] += 1
                elif c < 0.7:
                    conf_dist["medium"] += 1
                else:
                    conf_dist["high"] += 1

            central = sorted(nodes, key=lambda n: n.get("confidence", 0), reverse=True)

            artifacts = {
                **step_detail,
                "node_count": len(nodes),
                "edge_count": len(edges),
                "density": stats.get("density", 0),
                "avg_degree": stats.get("avg_degree", 0),
                "edge_confidence_distribution": conf_dist,
                "central_entities": [
                    {"label": n.get("label", ""), "type": n.get("entity_type", ""),
                     "confidence": n.get("confidence", 0), "source_count": len(n.get("source_files", []))}
                    for n in central[:20]
                ],
                "per_file_graph_count": len(per_file_graphs),
                "node_sample": nodes[:15],
                "edge_sample": edges[:15],
            }
        else:
            artifacts = {**step_detail, "per_file_graph_count": len(per_file_graphs)}

    elif layer_id == "graph_consist":
        graph_vals = _glob_read("*_graph_validation.json", 5)
        cg = _safe_read_json(os.path.join(corpus_dir, "canonical_graph.json"))

        all_weak, all_dupes, all_disconnected, all_onto_violations = [], [], [], []
        for gv in graph_vals:
            all_weak.extend(gv.get("weak_edges", [])[:10])
            all_dupes.extend(gv.get("duplicate_entities", [])[:10])
            all_disconnected.extend(gv.get("disconnected_nodes", [])[:10])
            all_onto_violations.extend(gv.get("ontology_violations", [])[:10])

        graph_stats = {}
        if cg:
            edges = cg.get("edges", [])
            suppressed = [e for e in edges if e.get("suppressed")]
            graph_stats = {
                **cg.get("stats", {}),
                "suppressed_count": len(suppressed),
                "active_count": len(edges) - len(suppressed),
            }

        artifacts = {
            **step_detail,
            "weak_edges": all_weak[:20],
            "duplicate_entities": all_dupes[:20],
            "disconnected_nodes": all_disconnected[:20],
            "ontology_violations": all_onto_violations[:20],
            "graph_stats": graph_stats,
        }

    elif layer_id == "wiki":
        wiki_dir = os.path.join(corpus_dir, "wiki_pages")
        wiki_index = _safe_read_json(os.path.join(wiki_dir, "index.json"))
        page_catalog = (wiki_index or {}).get("pages", [])

        sample_pages = []
        for entry in page_catalog[:5]:
            cid = entry.get("canonical_id", "")
            safe_id = cid.replace("/", "_").replace("\\", "_")
            page_data = _safe_read_json(os.path.join(wiki_dir, f"{safe_id}.json"))
            if page_data:
                sample_pages.append({
                    "canonical_id": page_data.get("canonical_id", cid),
                    "title": page_data.get("title", cid),
                    "entity_type": page_data.get("entity_type", ""),
                    "summary": (page_data.get("summary", "") or "")[:300],
                    "key_fact_count": len(page_data.get("key_facts", [])),
                    "related_entity_count": len(page_data.get("related_entities", [])),
                    "source_file_count": len(page_data.get("source_files", [])),
                    "citation_coverage": page_data.get("citation_coverage", {}),
                })

        artifacts = {
            **step_detail,
            "wiki_page_count": len(page_catalog),
            "wiki_pages_sample": [p.get("title", p.get("canonical_id", "")) for p in page_catalog[:20]],
            "sample_pages": sample_pages,
            "index_updated_at": (wiki_index or {}).get("updated_at"),
        }

    return {
        "job_id": job_id,
        "layer_id": layer_id,
        "label": step_data.get("label", layer_id),
        "status": step_data.get("status", "pending"),
        "started_at": step_data.get("started_at"),
        "completed_at": step_data.get("completed_at"),
        "error_code": step_data.get("error_code"),
        "artifacts": artifacts,
    }


@router.get("/{job_id}/kpis")
async def get_pipeline_kpis(job_id: str):
    """Return aggregate header KPIs for the pipeline dashboard."""
    from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker
    from sqlalchemy.pool import NullPool
    from sqlalchemy import text as sql_text
    from app.config import get_settings
    import json, os

    s = get_settings()
    engine = create_async_engine(s.database_url, echo=False, poolclass=NullPool)
    factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    async with factory() as db:
        row = await db.execute(
            sql_text("SELECT metadata, progress FROM ingest_jobs WHERE job_id = :id"),
            {"id": job_id},
        )
        result = row.fetchone()

    await engine.dispose()

    if not result:
        raise HTTPException(status_code=404, detail="Job not found")

    meta_raw, progress_raw = result
    meta = json.loads(meta_raw) if isinstance(meta_raw, str) else (meta_raw or {})
    progress = json.loads(progress_raw) if isinstance(progress_raw, str) else (progress_raw or {})

    corpus_dir = meta.get("corpus_dir", f"corpus_store/{job_id}")

    kpis = {
        "entities": 0, "relationships": 0, "graph_nodes": 0,
        "trust_score": 0.0, "ontology_consistency": 0,
    }

    for st in progress.get("steps", []):
        try:
            d = json.loads(st.get("detail", "{}")) if st.get("detail") else {}
        except (json.JSONDecodeError, TypeError):
            d = {}

        if st["id"] == "entities":
            kpis["entities"] = d.get("entity_count", 0)
            kpis["relationships"] = d.get("relationship_count", 0)
        elif st["id"] == "graph_build":
            kpis["graph_nodes"] = d.get("graph_nodes", 0)
        elif st["id"] == "validation":
            kpis["trust_score"] = d.get("avg_trust_score", 0.0)
        elif st["id"] == "ontology":
            kpis["ontology_consistency"] = d.get("ontology_violations", 0)

    graph_path = os.path.join(corpus_dir, "canonical_graph.json")
    if os.path.exists(graph_path):
        try:
            with open(graph_path, encoding="utf-8") as f:
                graph = json.load(f)
            kpis["graph_nodes"] = kpis["graph_nodes"] or len(graph.get("nodes", []))
        except Exception:
            pass

    return {"job_id": job_id, "kpis": kpis}


@router.get("/{job_id}/entities/preview")
async def entities_preview(job_id: str, limit: int = 20):
    """Return top entities from the knowledge graph for the given job."""
    from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker
    from sqlalchemy.pool import NullPool
    from sqlalchemy import text as sql_text
    from app.config import get_settings
    import json, os

    s = get_settings()
    engine = create_async_engine(s.database_url, echo=False, poolclass=NullPool)
    factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    async with factory() as db:
        row = await db.execute(
            sql_text("SELECT graph_path, metadata FROM ingest_jobs WHERE job_id = :id"),
            {"id": job_id},
        )
        result = row.fetchone()

    await engine.dispose()

    if not result:
        raise HTTPException(status_code=404, detail="Job not found")

    graph_path, meta_raw = result
    if not graph_path:
        meta = json.loads(meta_raw) if isinstance(meta_raw, str) else (meta_raw or {})
        corpus_dir = meta.get("corpus_dir", f"corpus_store/{job_id}")
        graph_path = os.path.join(corpus_dir, "canonical_graph.json")
    if not os.path.exists(graph_path):
        raise HTTPException(status_code=404, detail="Graph not available yet")

    try:
        with open(graph_path, encoding="utf-8") as f:
            graph = json.load(f)
        nodes = graph.get("nodes", [])
        nodes_sorted = sorted(
            nodes,
            key=lambda n: (
                n.get("weight")
                or n.get("degree")
                or len(n.get("source_files", []) or [])
                or n.get("confidence", 0)
            ),
            reverse=True,
        )
        top = [n.get("label") or n.get("canonical_id") or n.get("id", "") for n in nodes_sorted[:limit]]
        return {"job_id": job_id, "entities": top, "total": len(nodes)}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
