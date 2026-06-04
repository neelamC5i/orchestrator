"""
Semantic Intelligence layers for the 14-layer ingest pipeline.

These layers are *additive* and *non-fatal*: each reuses existing platform
utilities, writes a single JSON artifact under the corpus directory, and returns
a small summary dict for the pipeline step `detail`. They never raise into the
pipeline (callers wrap them in try/except), so they cannot break the
`graph_done` terminal contract.

Layer 5  → metadata_intelligence.run_metadata_intelligence
Layer 7  → semantic_learning.run_semantic_learning
Layer 9  → ml_validation.run_ml_validation
Layer 10 → ontology_governance.run_ontology_governance
Layer 13 → graph_validation.run_graph_validation
"""

from .metadata_intelligence import run_metadata_intelligence
from .semantic_learning import run_semantic_learning
from .ml_validation import run_ml_validation
from .ontology_governance import run_ontology_governance
from .graph_validation import run_graph_validation

__all__ = [
    "run_metadata_intelligence",
    "run_semantic_learning",
    "run_ml_validation",
    "run_ontology_governance",
    "run_graph_validation",
]
