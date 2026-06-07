"""
POST /api/v1/feedback — record explicit user judgment on a model response.

Translates a thumbs-up / thumbs-down into a bandit reward signal so the LinUCB
arm for that model is updated with real human judgment — not just task-completion
heuristics.

Reward mapping
  is_correct = True  → reward 0.9   (strong positive — route more queries here)
  is_correct = False → reward 0.1   (strong negative — explore alternatives)

The update uses whatever query_embedding the client provides.  If absent a
zero-vector is used: the magnitude is low so the update is mild, which is the
correct behaviour for low-information feedback.
"""
from fastapi import APIRouter
from pydantic import BaseModel, Field
from app.schemas import FeedbackResponse

router = APIRouter(prefix="/feedback", tags=["feedback"])


class FeedbackRequest(BaseModel):
    session_id: str
    model_id: str = Field(..., min_length=1, max_length=256)
    task_type: str = Field(default="general_reasoning", max_length=64)
    is_correct: bool
    domain_label: str = Field(default="general", max_length=128)
    # Optional — the same embedding the orchestrator used for this query.
    # Providing it gives the bandit a richer update signal.
    query_embedding: list[float] | None = None


@router.post("", response_model=FeedbackResponse)
async def record_feedback(req: FeedbackRequest):
    """
    Update the LinUCB bandit arm for the given model with a user-driven reward.

    This is the only place in the system where a human explicitly tells the
    bandit whether a model's answer was correct.  It closes the feedback loop
    that otherwise only gets implicit signals (task completion, hallucination rate).
    """
    from app.modules.slm_factory.bandit import get_bandit, save_bandit

    bandit = get_bandit()
    dim = bandit.d

    # Build context vector — use provided embedding or zero-vector.
    # A zero-vector produces a mild update (low UCB sensitivity) which is the
    # right behaviour when we don't know the full query context.
    if req.query_embedding and len(req.query_embedding) >= 8:
        x: list[float] = req.query_embedding[:dim]
        if len(x) < dim:
            x = x + [0.0] * (dim - len(x))
    else:
        x = [0.0] * dim

    reward = 0.9 if req.is_correct else 0.1
    bandit.update(model_id=req.model_id, context_vector=x, reward=reward)

    # Persist so the update survives restarts.
    try:
        save_bandit(bandit)
    except Exception:
        pass  # in-memory update still took effect

    return {
        "status": "recorded",
        "model_id": req.model_id,
        "reward_applied": reward,
        "feedback_type": "correct" if req.is_correct else "incorrect",
        "note": (
            "Bandit arm updated. Over time this feedback will shift routing "
            "probability toward models with higher user-confirmed accuracy."
        ),
    }
