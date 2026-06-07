import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.modules.pipeline.read_model import build_snapshot


def _write_json(path: Path, payload: dict):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload), encoding="utf-8")


def test_snapshot_uses_artifact_fallbacks_for_completed_job(tmp_path):
    corpus = tmp_path / "job-1"
    processed = corpus / "processed"
    _write_json(corpus / "canonical_graph.json", {
        "nodes": [
            {"canonical_id": "n1", "label": "Acme", "confidence": 0.9, "source_files": ["doc"]},
            {"canonical_id": "n2", "label": "Retail", "confidence": 0.6, "source_files": ["doc"]},
        ],
        "edges": [{"source_canonical_id": "n1", "target_canonical_id": "n2", "relation": "related_to", "confidence": 0.8}],
        "stats": {"density": 0.5, "avg_degree": 1.0},
    })
    _write_json(processed / "doc_kg_scorecard.json", {"graph_trust_score": 0.77, "overall_kg_quality_score": 0.8})
    _write_json(processed / "doc_eda_visuals.json", {
        "entity_distribution": [{"type": "ORG", "count": 1}],
        "relation_distributions": [{"relation": "related_to", "count": 1}],
        "confidence_histograms": {"entities": [{"bin_start": 0.8, "bin_end": 0.9, "count": 1}]},
    })
    _write_json(corpus / "wiki_pages" / "index.json", {
        "pages": [{"canonical_id": "n1", "title": "Acme", "generated_at": 1}],
        "updated_at": 1,
    })
    _write_json(corpus / "wiki_pages" / "n1.json", {
        "canonical_id": "n1",
        "title": "Acme",
        "summary": "Acme summary",
        "key_facts": [{"claim": "Acme related_to Retail."}],
        "related_entities": [{"canonical_id": "n2"}],
        "source_files": ["doc"],
        "citation_coverage": {"facts_with_citations": 0, "total_facts": 1},
    })

    row = {
        "status": "graph_done",
        "progress": {"steps": [], "overall_pct": 100},
        "metadata": {"corpus_dir": str(corpus)},
        "graph_path": str(corpus / "canonical_graph.json"),
        "file_count": 1,
        "entity_count": 0,
        "community_count": 0,
    }

    snapshot = build_snapshot("job-1", row)

    assert snapshot["terminal"] is True
    assert snapshot["kpis"]["entities"] == 2
    assert snapshot["kpis"]["relationships"] == 1
    assert snapshot["kpis"]["graph_nodes"] == 2
    assert snapshot["kpis"]["trust_score"] == 0.77
    assert snapshot["artifacts_available"] == {"eda": True, "kg": True, "wiki": True}
    assert snapshot["previews"]["entities"] == ["Acme", "Retail"]
    assert snapshot["previews"]["wiki"]["sample_pages"][0]["title"] == "Acme"


def test_snapshot_reports_empty_artifacts_without_zeroing_progress(tmp_path):
    corpus = tmp_path / "job-2"
    row = {
        "status": "ingesting",
        "progress": {
            "overall_pct": 42,
            "steps": [
                {"id": "entities", "label": "Entity + Relationship", "status": "done", "pct": 100, "detail": "{\"entity_count\": 3, \"relationship_count\": 2}"},
                {"id": "graph_build", "label": "KG Construction", "status": "running", "pct": 0, "detail": ""},
            ],
            "logs": [{"status": "ingesting", "message": "Entity + Relationship done", "overall_pct": 42}],
        },
        "metadata": {"corpus_dir": str(corpus)},
        "graph_path": None,
        "file_count": 1,
        "entity_count": 0,
        "community_count": 0,
    }

    snapshot = build_snapshot("job-2", row)

    assert snapshot["terminal"] is False
    assert snapshot["overall_pct"] == 42
    assert snapshot["kpis"]["entities"] == 3
    assert snapshot["kpis"]["relationships"] == 2
    assert snapshot["artifacts_available"]["kg"] is False
    assert "Knowledge graph not generated yet" in snapshot["previews"]["kg"]["warnings"]
    assert snapshot["logs"][0]["message"] == "Entity + Relationship done"
