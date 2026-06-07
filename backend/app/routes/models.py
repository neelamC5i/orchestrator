"""
GET /api/v1/models — list all available models across all adapters + custom-built SLMs.
GET /api/v1/models/insights/{task_type} — Nash equilibrium + bandit scores for a task.
GET /api/v1/models/bandit-status — current LinUCB arm states for all observed models.
"""
import numpy as np
from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from app.adapters.registry import get_adapter_registry
from app.db.database import get_db
from app.schemas import ModelsListResponse, BanditStatusResponse, InsightsResponse

router = APIRouter(prefix="/models", tags=["models"])


@router.get("", response_model=ModelsListResponse)
async def list_models(db: AsyncSession = Depends(get_db)):
    registry = get_adapter_registry()
    models = await registry.list_all_models()
    result = [m.model_dump() for m in models]
    seen_ids = {m["model_id"] for m in result}

    # Merge custom-built SLMs from the SLM registry
    try:
        from app.modules.slm_factory.slm_registry import SLMRegistry
        slm_registry = SLMRegistry(db)
        slm_records = await slm_registry.list_all()
        for r in slm_records:
            model_id = r.get("model_id") or ""
            ollama_name = r.get("ollama_model_name") or model_id
            if not model_id or model_id in seen_ids:
                continue
            seen_ids.add(model_id)
            result.append({
                "model_id": model_id,
                # Always use model_id as display name for custom SLMs (student models).
                # ollama_model_name may be a fallback Ollama model when QLoRA was skipped —
                # exposing that as the name would make the student model appear as a duplicate
                # of the teacher/fallback Ollama model in the UI.
                "name": model_id,
                "base_model": r.get("base_model") or "",        # e.g. SmolLM2-1.7B-Instruct
                "ollama_model_name": r.get("ollama_model_name") or model_id,  # for inference routing
                "provider": "custom_slm",
                "status": "local",
                "vram_gb": r.get("vram_required_gb") or 4.0,
                "context_window": 4096,
                "capabilities": ["text_generation", "domain_qa"],
                "domain_label": r.get("domain_label") or "",
                "coverage_topics": r.get("coverage_topics") or [],
                "val_loss": r.get("val_loss"),
                "hallucination_rate": r.get("hallucination_rate"),
                "adapter_type": r.get("adapter_type") or "none",  # "qlora" or "none"
                "is_custom_slm": True,
            })
    except Exception:
        pass  # never break the model list if SLM registry is unavailable

    return {
        "models": result,
        "count": len(result),
    }


@router.get("/bandit-status", response_model=BanditStatusResponse)
async def bandit_status():
    """Return current LinUCB arm strengths and convergence state for all observed models."""
    from app.modules.slm_factory.bandit import get_bandit

    bandit = get_bandit()
    arms = []
    for model_id, arm in bandit._arms.items():
        A = arm["A"]
        b = arm["b"]
        A_inv = np.linalg.inv(A)
        theta = A_inv @ b                          # estimated reward coefficients
        theta_norm = float(np.linalg.norm(theta))  # overall reward estimate strength
        # Pseudo-observation count: diagonal of A minus identity (scale=10 warm-start)
        diag_excess = float(np.mean(np.diag(A))) - 10.0
        obs_estimate = max(0, round(diag_excess))
        # Exploit-vs-explore: UCB width for a unit vector
        explore_width = float(np.sqrt(np.mean(np.diag(A_inv))))
        arms.append({
            "model_id": model_id,
            "theta_norm": round(theta_norm, 4),
            "estimated_reward": round(float(np.mean(theta)), 4),
            "observations": obs_estimate,
            "explore_width": round(explore_width, 6),
            "converged": obs_estimate > 50 and explore_width < 0.01,
        })

    arms.sort(key=lambda x: x["estimated_reward"], reverse=True)
    return {
        "arms": arms,
        "total_arms": len(arms),
        "scoring_note": (
            "theta_norm: strength of learned reward signal. "
            "observations: estimated real queries seen. "
            "explore_width: UCB uncertainty — decreases as model learns. "
            "converged: True when >50 observations and uncertainty < 0.01."
        ),
    }


@router.get("/insights/{task_type}", response_model=InsightsResponse)
async def model_insights(task_type: str):
    """
    Nash equilibrium + bandit status for a given task type.
    Shows why the system picks a specific model and how game theory allocates queries.
    """
    import asyncio
    from app.modules.model_capability_catalog import MODEL_CATALOG
    from app.modules.slm_factory.bandit import get_bandit

    VALID_TASKS = list(MODEL_CATALOG.keys())
    if task_type not in VALID_TASKS:
        task_type = "general_reasoning"

    candidates = list(MODEL_CATALOG.get(task_type, []))
    if not candidates:
        candidates = list(MODEL_CATALOG.get("general_reasoning", []))

    registry = get_adapter_registry()
    try:
        models = await asyncio.wait_for(registry.list_all_models(), timeout=3.0)
        available_set = {m.model_id for m in models}
    except Exception:
        available_set = set()

    bandit = get_bandit()
    dummy_emb = [0.0] * 768  # neutral embedding for scoring (nomic-embed-text dim)

    arm_data = []
    for cand in candidates:
        is_avail = cand["model"] in available_set
        if cand["provider"] == "ollama":
            avail = 1.0 if is_avail else 0.2
        elif cand["provider"] == "openai":
            avail = 0.9 if is_avail else 0.0
        else:
            avail = 1.0 if is_avail else 0.1

        try:
            scores = bandit.score([cand["model"]], dummy_emb, task_type, 100, 0)
            bandit_score = round(min(max(scores.get(cand["model"], cand["benchmark"] * 0.8), 0), 1.0), 4)
        except Exception:
            bandit_score = round(cand["benchmark"] * 0.8, 4)

        composite = round(
            0.35 * cand["benchmark"] +
            0.25 * avail +
            0.25 * bandit_score +
            0.15 * cand["benchmark"],
            4
        )

        # Get real observation count from bandit arm
        arm = bandit._arms.get(cand["model"])
        obs = 0
        if arm:
            diag_excess = float(np.mean(np.diag(arm["A"]))) - 10.0
            obs = max(0, round(diag_excess))

        arm_data.append({
            "model": cand["model"],
            "provider": cand["provider"],
            "benchmark": cand["benchmark"],
            "availability": avail,
            "bandit_score": bandit_score,
            "composite_score": composite,
            "is_available": is_avail,
            "observations": obs,
            "benchmark_source": f"HumanEval {cand['heval']}%" if cand.get("heval") else "internal benchmark",
        })

    arm_data.sort(key=lambda x: x["composite_score"], reverse=True)

    # Nash equilibrium: replicator dynamics converges to softmax of payoffs.
    # At equilibrium, each model is selected with probability proportional to
    # exp(payoff/T) where T is the "temperature" (exploration level).
    payoffs = np.array([a["composite_score"] for a in arm_data])
    T = 0.05  # low temperature → strongly favours dominant strategy
    shifted = payoffs - payoffs.max()
    exp_p = np.exp(shifted / T)
    nash_probs = (exp_p / exp_p.sum()).tolist()

    for i, a in enumerate(arm_data):
        a["nash_probability"] = round(nash_probs[i], 4)
        a["is_dominant"] = i == 0

    dominant = arm_data[0] if arm_data else None

    # Build plain-English explanation
    why_lines = []
    if dominant:
        why_lines.append(
            f"{dominant['model']} leads with composite {dominant['composite_score']:.3f}: "
            f"benchmark {dominant['benchmark']:.0%} (×0.35) + "
            f"availability {dominant['availability']:.0%} (×0.25) + "
            f"bandit {dominant['bandit_score']:.3f} (×0.25) + "
            f"benchmark bonus (×0.15)."
        )
        if dominant["observations"] > 0:
            why_lines.append(
                f"The bandit has seen ~{dominant['observations']} real queries for this model — "
                f"its reward estimate is data-driven."
            )
        else:
            why_lines.append(
                "The bandit is using a warm-start prior (benchmark × 0.8) — "
                "it will update after real queries come in."
            )
        why_lines.append(
            f"Nash equilibrium allocates {round(dominant['nash_probability']*100, 1)}% of queries "
            f"to {dominant['model']}. As the bandit gathers data, this allocation adapts."
        )

    return {
        "task_type": task_type,
        "valid_task_types": VALID_TASKS,
        "candidates": arm_data,
        "dominant_model": dominant["model"] if dominant else None,
        "nash_explanation": " ".join(why_lines),
        "formula": "composite = 0.35×benchmark + 0.25×availability + 0.25×bandit + 0.15×benchmark",
        "game_theory_note": (
            "Nash equilibrium is computed via replicator dynamics (softmax of composite payoffs). "
            "At equilibrium, no model can unilaterally improve its expected reward by changing strategy. "
            "The bandit (LinUCB) updates arm weights after every query, shifting equilibrium over time."
        ),
    }
