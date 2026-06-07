"""
Shared Pydantic response models for API contracts.
Used as response_model on the most critical endpoints.
"""
from __future__ import annotations

from typing import Any, Optional
from pydantic import BaseModel


# ── Auth ──────────────────────────────────────────────────────────────────────

class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"


# ── Data / Ingest ─────────────────────────────────────────────────────────────

class IngestResponse(BaseModel):
    job_id: str
    status: str
    file_count: int = 0
    entity_count: int = 0
    reused: bool = False
    message: str | None = None


class TestConnectionResponse(BaseModel):
    success: bool
    message: str
    schema_: dict[str, Any] | None = None

    class Config:
        populate_by_name = True
        json_schema_extra = {"properties": {"schema": {"$ref": "#/$defs/schema_"}}}


class CorpusItem(BaseModel):
    job_id: str
    domain_label: str
    file_count: int = 0
    entity_count: int = 0
    community_count: int = 0
    created_at: str | None = None


# ── Pipeline ──────────────────────────────────────────────────────────────────

class PipelineKpis(BaseModel):
    entities: int = 0
    relationships: int = 0
    graph_nodes: int = 0
    trust_score: float = 0.0
    ontology_consistency: int = 0


class PipelineLayerInfo(BaseModel):
    id: str
    label: str
    status: str
    pct: int = 0
    detail: Any = None
    started_at: str | None = None
    completed_at: str | None = None
    error_code: str | None = None


class PipelineSnapshotResponse(BaseModel):
    job_id: str
    status: str
    db_status: str | None = None
    domain_label: str = "general"
    overall_pct: int = 0
    eta_seconds: float | None = None
    terminal: bool = False
    layers: list[PipelineLayerInfo] = []
    kpis: PipelineKpis = PipelineKpis()
    previews: dict[str, Any] = {}
    logs: list[dict[str, Any]] = []
    artifacts_available: dict[str, bool] = {}
    file_count: int = 0
    entity_count: int = 0
    community_count: int = 0
    error: str | None = None
    created_at: str | None = None
    completed_at: str | None = None


class PipelineKpisResponse(BaseModel):
    job_id: str
    kpis: PipelineKpis


class EntitiesPreviewResponse(BaseModel):
    job_id: str
    entities: list[str] = []
    total: int = 0


# ── SLM ───────────────────────────────────────────────────────────────────────

class SLMStatusResponse(BaseModel):
    status: str
    model_id: str | None = None
    domain_label: str = "general"


class SLMStatsResponse(BaseModel):
    active_slms: int = 0
    tokens_saved: int = 0
    files_ingested: int = 0
    cost_saved: float = 0.0


class SLMBuildResponse(BaseModel):
    task_id: str | None = None
    status: str
    model_id: str | None = None
    ollama_model_name: str | None = None
    model_path: str | None = None
    quick_rebuild: bool = False
    qa_pairs_reused: bool = False


class SLMForCorpusResponse(BaseModel):
    exists: bool
    model_id: str | None = None
    domain_label: str | None = None
    ollama_model_name: str | None = None
    model_path: str | None = None
    val_loss: float | None = None


# ── Models ────────────────────────────────────────────────────────────────────

class ModelInfo(BaseModel):
    model_id: str
    name: str | None = None
    provider: str | None = None
    status: str | None = None
    parameter_size: str | None = None
    quantization: str | None = None
    vram_gb: float | None = None
    context_window: int | None = None
    task_types: list[str] = []
    is_custom_slm: bool = False
    domain_label: str | None = None


class ModelsListResponse(BaseModel):
    models: list[ModelInfo] = []
    count: int = 0


class BanditArm(BaseModel):
    model_id: str
    theta_norm: float = 0.0
    estimated_reward: float = 0.0
    observations: int = 0
    explore_width: float = 0.0
    converged: bool = False


class BanditStatusResponse(BaseModel):
    arms: list[BanditArm] = []
    total_arms: int = 0
    scoring_note: str = ""


class InsightsCandidate(BaseModel):
    model: str
    provider: str
    benchmark: float = 0.0
    availability: float = 0.0
    bandit_score: float = 0.0
    composite_score: float = 0.0
    is_available: bool = False
    observations: int = 0
    benchmark_source: str = ""
    nash_probability: float = 0.0
    is_dominant: bool = False


class InsightsResponse(BaseModel):
    task_type: str
    valid_task_types: list[str] = []
    candidates: list[InsightsCandidate] = []
    dominant_model: str | None = None
    nash_explanation: str = ""
    formula: str = ""
    game_theory_note: str = ""


# ── Feedback ──────────────────────────────────────────────────────────────────

class FeedbackResponse(BaseModel):
    status: str
    model_id: str
    reward_applied: float
    feedback_type: str | None = None
    note: str | None = None


# ── Wiki ──────────────────────────────────────────────────────────────────────

class WikiReviewsResponse(BaseModel):
    reviews: list[dict[str, Any]] = []
    total: int = 0


# ── Quality ───────────────────────────────────────────────────────────────────

class QualityMetricsResponse(BaseModel):
    job_id: str
    graph_metrics: dict[str, Any] | None = None
    registry_metrics: dict[str, Any] | None = None
    file_scorecards: list[dict[str, Any]] = []
    file_count: int = 0


# ── Error ─────────────────────────────────────────────────────────────────────

class ErrorDetail(BaseModel):
    code: str
    message: str
    details: Any = None


class ErrorResponse(BaseModel):
    error: ErrorDetail
