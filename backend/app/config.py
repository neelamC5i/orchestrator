from pydantic_settings import BaseSettings
from functools import lru_cache
from pathlib import Path


class Settings(BaseSettings):
    # Database
    database_url: str = "postgresql+asyncpg://orchestrator:orchestrator_secret@localhost:5432/orchestrator"
    redis_url: str = "redis://localhost:6379"

    # Ollama
    ollama_base_url: str = "http://localhost:11434"

    # Cloud providers (optional)
    openai_api_key: str = ""
    groq_api_key: str = ""
    hf_token: str = ""
    fred_api_key: str = ""

    # Storage paths
    slm_store_path: str = "./slm_store"
    corpus_store_path: str = "./corpus_store"

    # SLM Factory thresholds
    slm_match_threshold: float = 0.82
    slm_partial_threshold: float = 0.65
    slm_confidence_threshold: float = 0.25
    slm_max_confidence_threshold: float = 0.40

    # Distillation settings
    teacher_qa_pairs_target: int = 15000
    distillation_target_pairs: int = 12000
    self_consistency_min_agree: int = 2
    self_consistency_repeats: int = 3

    # Training defaults
    lora_r: int = 16
    lora_alpha: int = 32
    lora_dropout: float = 0.05
    lora_target_modules: list[str] = ["q_proj", "v_proj", "k_proj", "o_proj"]

    # Embedding model for coverage checker
    embedding_model: str = "nomic-embed-text"
    embedding_dim: int = 1536

    # Quality thresholds
    dedup_threshold: float = 0.8
    dedup_num_perm: int = 128
    quality_min_score: float = 0.75
    entity_resolver_threshold: float = 0.72

    # Cache TTLs (seconds)
    cache_ttl_news: int = 900       # 15 minutes
    cache_ttl_stable: int = 86400   # 24 hours
    cache_similarity_threshold: float = 0.92

    # Upload validation
    max_upload_size_mb: int = 100
    allowed_upload_extensions: list[str] = [
        ".csv", ".json", ".jsonl", ".txt", ".pdf",
        ".xlsx", ".xls", ".parquet", ".md", ".docx", ".doc",
    ]

    # Graphify
    graphify_token_budget: int = 50000

    # Authentication
    auth_secret_key: str = "orchestrator-dev-secret-change-in-production"
    auth_algorithm: str = "HS256"
    auth_access_token_expire_minutes: int = 60
    auth_refresh_token_expire_minutes: int = 1440  # 24 hours
    auth_username: str = "admin"
    auth_password: str = "orchestrator"

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"

    def ensure_storage_dirs(self):
        Path(self.slm_store_path).mkdir(parents=True, exist_ok=True)
        Path(self.corpus_store_path).mkdir(parents=True, exist_ok=True)


@lru_cache()
def get_settings() -> Settings:
    return Settings()
