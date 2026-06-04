"""
Data ingestion API routes.
POST /api/v1/data/ingest — accept files + optional DB credentials, start Celery job
GET  /api/v1/data/status/{job_id} — check job progress (JSON poll)
GET  /api/v1/data/progress/{job_id} — SSE stream of live progress events
"""
import uuid
import json
import asyncio
from pathlib import Path

from fastapi import APIRouter, UploadFile, File, Form, Depends, HTTPException
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text

from app.db.database import get_db
from app.config import get_settings

settings = get_settings()
router = APIRouter(prefix="/data", tags=["data"])


class DBCredentials(BaseModel):
    db_type: str          # postgresql | mysql | sqlite | mongodb
    host: str = ""
    port: int = 5432
    database: str = ""
    username: str = ""
    password: str = ""
    connection_string: str = ""


@router.post("/ingest")
async def ingest(
    files: list[UploadFile] = File(default=[]),
    db_type: str = Form(default=""),
    host: str = Form(default=""),
    port: int = Form(default=5432),
    database: str = Form(default=""),
    username: str = Form(default=""),
    password: str = Form(default=""),
    connection_string: str = Form(default=""),
    domain_label: str = Form(default="general"),
    force_reingest: bool = Form(default=False),
    db: AsyncSession = Depends(get_db),
):
    # Deduplication: if a completed corpus already exists for this domain, reuse it
    if not force_reingest:
        existing = await db.execute(text("""
            SELECT job_id, file_count, entity_count, graph_path, created_at
            FROM ingest_jobs
            WHERE domain_label = :domain AND status = 'graph_done'
            ORDER BY created_at DESC
            LIMIT 1
        """), {"domain": domain_label})
        existing_row = existing.mappings().first()
        if existing_row:
            return {
                "job_id": existing_row["job_id"],
                "status": "graph_done",
                "file_count": existing_row["file_count"] or 0,
                "entity_count": existing_row["entity_count"] or 0,
                "reused": True,
                "message": (
                    f"Reusing existing corpus for domain '{domain_label}' "
                    f"(created {existing_row['created_at'].strftime('%Y-%m-%d %H:%M') if existing_row['created_at'] else 'N/A'}). "
                    "Pass force_reingest=true to build a new one."
                ),
            }

    job_id = str(uuid.uuid4())
    corpus_dir = Path(settings.corpus_store_path) / job_id
    corpus_dir.mkdir(parents=True, exist_ok=True)

    saved_files = []
    for upload in files:
        dest = corpus_dir / upload.filename
        content = await upload.read()
        dest.write_bytes(content)
        saved_files.append(str(dest))

    db_creds = {}
    if db_type:
        db_creds = {
            "db_type": db_type, "host": host, "port": port,
            "database": database, "username": username,
            "connection_string": connection_string,
        }
        # NOTE: password never stored — passed to worker via env or secure vault
        if password:
            db_creds["_has_password"] = True

    # Record job in DB
    await db.execute(text("""
        INSERT INTO ingest_jobs (job_id, status, file_count, domain_label, metadata)
        VALUES (:job_id, 'queued', :file_count, :domain_label, (:metadata)::jsonb)
    """), {
        "job_id": job_id,
        "file_count": len(saved_files),
        "domain_label": domain_label,
        "metadata": __import__("json").dumps({"corpus_dir": str(corpus_dir), "db_creds": db_creds}),
    })
    await db.commit()

    # Dispatch Celery task
    try:
        from app.tasks.ingest_task import run_ingest_pipeline
        run_ingest_pipeline.delay(job_id)
    except Exception as exc:
        return JSONResponse({"job_id": job_id, "status": "queued", "warning": str(exc)})

    return {"job_id": job_id, "status": "queued", "file_count": len(saved_files)}


@router.post("/test-connection")
async def test_connection(creds: DBCredentials):
    """Test external DB connectivity without storing credentials."""
    import asyncio
    db_type = creds.db_type.lower()
    try:
        if db_type == "postgresql":
            import asyncpg
            conn_str = creds.connection_string or (
                f"postgresql://{creds.username}:{creds.password}@{creds.host}:{creds.port}/{creds.database}"
            )
            conn = await asyncio.wait_for(asyncpg.connect(conn_str), timeout=5)
            await conn.close()
        elif db_type == "mysql":
            import aiomysql
            conn = await asyncio.wait_for(
                aiomysql.connect(host=creds.host, port=creds.port, user=creds.username,
                                 password=creds.password, db=creds.database), timeout=5
            )
            conn.close()
        elif db_type == "sqlite":
            import aiosqlite
            async with aiosqlite.connect(creds.database) as _:
                pass
        else:
            return {"success": False, "message": f"Unsupported db_type: {db_type}"}
        return {"success": True, "message": f"Connected to {db_type} successfully"}
    except Exception as exc:
        return {"success": False, "message": str(exc)}


@router.get("/corpora")
async def list_corpora(db: AsyncSession = Depends(get_db)):
    """List the best (most recent) completed corpus per domain."""
    result = await db.execute(text("""
        SELECT DISTINCT ON (domain_label)
               job_id, domain_label, file_count, entity_count, community_count,
               graph_path, metadata, created_at
        FROM ingest_jobs
        WHERE status = 'graph_done'
        ORDER BY domain_label, created_at DESC
    """))
    rows = result.mappings().all()
    out = []
    for r in rows:
        meta = r["metadata"] or {}
        if isinstance(meta, str):
            try:
                meta = json.loads(meta)
            except Exception:
                meta = {}
        out.append({
            "job_id": r["job_id"],
            "domain_label": r["domain_label"],
            "file_count": r["file_count"] or 0,
            "entity_count": r["entity_count"] or 0,
            "community_count": r["community_count"] or 0,
            "created_at": r["created_at"].isoformat() if r["created_at"] else None,
        })
    return out


@router.get("/wiki/{job_id}")
async def get_wiki(job_id: str, q: str = "", db: AsyncSession = Depends(get_db)):
    """
    Return parsed wiki articles for a job's knowledge graph.
    Articles are read from the graphify-out/wiki/ directory.
    Optional ?q= filters articles by keyword.
    Returns partial results if graph is still building (enables live polling).
    """
    import re as _re
    row = (await db.execute(
        text("SELECT graph_path, metadata, status FROM ingest_jobs WHERE job_id = :id"),
        {"id": job_id},
    )).mappings().first()

    if not row:
        raise HTTPException(status_code=404, detail="Job not found")

    # Derive corpus_dir from graph_path or metadata
    corpus_dir = None
    graph_path = row.get("graph_path")
    if graph_path:
        corpus_dir = str(Path(graph_path).parent.parent)
    if not corpus_dir:
        meta = row.get("metadata") or {}
        if isinstance(meta, str):
            try:
                meta = json.loads(meta)
            except Exception:
                meta = {}
        corpus_dir = meta.get("corpus_dir", "")

    wiki_dir = Path(corpus_dir) / "graphify-out" / "wiki" if corpus_dir else None

    articles = []
    if wiki_dir and wiki_dir.exists():
        _TYPE_LABELS = {
            "Organizations": "ORG", "Countries & Cities": "GPE",
            "Locations": "LOC", "Products & Goods": "PRODUCT",
            "People": "PERSON", "Events": "EVENT",
            "Facilities": "FAC", "Groups & Nationalities": "NORP",
            "Regulations & Laws": "LAW", "Other Entities": "ENTITY",
        }
        for md_file in sorted(wiki_dir.glob("*.md")):
            raw = md_file.read_text(encoding="utf-8", errors="replace")

            # Parse title
            title_match = _re.search(r"^# (.+)$", raw, _re.MULTILINE)
            title = title_match.group(1).strip() if title_match else md_file.stem

            # Parse entity sections: **Label:** a, b, c
            sections: dict = {}
            for section_match in _re.finditer(r"\*\*([^*]+):\*\*\s*(.+)", raw):
                label = section_match.group(1).strip()
                entities = [e.strip() for e in section_match.group(2).split(",") if e.strip()]
                if label == "Disruption signals":
                    sections["disruptions"] = entities
                elif label in _TYPE_LABELS:
                    sections[_TYPE_LABELS[label]] = entities

            # Parse passages
            passages = _re.findall(r"^>\s*(.+)$", raw, _re.MULTILINE)
            passages = [p.strip() for p in passages if len(p.strip()) > 20][:6]

            # Total entity count across all type sections
            entity_count = sum(
                len(v) for k, v in sections.items() if k != "disruptions"
            )

            article = {
                "community_id": int(_re.search(r"\d+", md_file.stem).group()),
                "title": title,
                "sections": sections,
                "passages": passages,
                "entity_count": entity_count,
                "status": row.get("status"),
            }

            # Keyword filter
            if q:
                ql = q.lower()
                all_text = title + " " + " ".join(passages) + " " + " ".join(
                    e for vals in sections.values() for e in (vals if isinstance(vals, list) else [])
                )
                if ql not in all_text.lower():
                    continue

            articles.append(article)

    return {
        "job_id": job_id,
        "pipeline_status": row.get("status"),
        "article_count": len(articles),
        "articles": articles,
    }


@router.get("/status/{job_id}")
async def get_status(job_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        text("SELECT * FROM ingest_jobs WHERE job_id = :id"),
        {"id": job_id},
    )
    row = result.mappings().first()
    if not row:
        raise HTTPException(status_code=404, detail="Job not found")
    return dict(row)


@router.get("/progress/{job_id}")
async def stream_progress(job_id: str, db: AsyncSession = Depends(get_db)):
    """
    SSE endpoint that streams progress events for a running ingest job.
    Emits `progress` events every ~1.5s until status is graph_done or failed.
    """
    async def _generate():
        terminal_statuses = {"graph_done", "failed", "error"}
        while True:
            result = await db.execute(
                text("SELECT status, progress, entity_count, community_count, file_count, error_message FROM ingest_jobs WHERE job_id = :id"),
                {"id": job_id},
            )
            row = result.mappings().first()
            if not row:
                yield f"data: {json.dumps({'type': 'error', 'message': 'Job not found'})}\n\n"
                break

            row_dict = dict(row)
            progress = row_dict.get("progress") or {}
            if isinstance(progress, str):
                try:
                    progress = json.loads(progress)
                except Exception:
                    progress = {}

            event = {
                "type": "progress",
                "status": row_dict["status"],
                "steps": progress.get("steps", []),
                "current_step": progress.get("current_step", 0),
                "overall_pct": progress.get("overall_pct", 0),
                "eta_seconds": progress.get("eta_seconds"),
                "entity_count": row_dict.get("entity_count", 0),
                "community_count": row_dict.get("community_count", 0),
                "file_count": row_dict.get("file_count", 0),
                "error": row_dict.get("error_message"),
                "pipeline_steps": progress,
            }
            yield f"data: {json.dumps(event)}\n\n"

            if row_dict["status"] in terminal_statuses:
                break

            await asyncio.sleep(1.5)

    return StreamingResponse(
        _generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


# ══════════════════════════════════════════════════════════════════════════════
# Scrape endpoint (Phase 3)
# ══════════════════════════════════════════════════════════════════════════════

class ScrapeRequest(BaseModel):
    url: str
    domain_label: str = "general"
    job_id: str | None = None   # attach to existing corpus job, or omit to create new
    force: bool = False         # skip SHA-256 duplicate check


@router.post("/scrape")
async def scrape_url(req: ScrapeRequest, db: AsyncSession = Depends(get_db)):
    """
    Fetch a URL, extract clean text, save as .txt under the corpus dir,
    then enqueue the full ingest pipeline (or re-embed only if graph exists).
    """
    import hashlib
    import httpx
    from urllib.parse import urlparse

    # ── Fetch page ───────────────────────────────────────────────────────────
    try:
        async with httpx.AsyncClient(timeout=20, follow_redirects=True, verify=False) as client:
            resp = await client.get(req.url, headers={"User-Agent": "Mozilla/5.0"})
            resp.raise_for_status()
            raw_html = resp.text
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"Failed to fetch URL: {exc}")

    # ── Extract clean text ───────────────────────────────────────────────────
    page_text = _extract_text_from_html(raw_html, req.url)
    if not page_text.strip():
        raise HTTPException(status_code=422, detail="No readable text found at URL")

    # ── SHA-256 duplicate check ──────────────────────────────────────────────
    checksum = hashlib.sha256(page_text.encode("utf-8", errors="ignore")).hexdigest()
    if not req.force:
        dup = await db.execute(text("""
            SELECT job_id FROM ingest_jobs
            WHERE metadata->>'content_checksum' = :cs
            LIMIT 1
        """), {"cs": checksum})
        if dup.mappings().first():
            raise HTTPException(status_code=409,
                detail="Duplicate content (same SHA-256 already ingested). Pass force=true to re-ingest.")

    # ── Resolve / create corpus dir ──────────────────────────────────────────
    if req.job_id:
        row = (await db.execute(
            text("SELECT metadata FROM ingest_jobs WHERE job_id = :id"), {"id": req.job_id}
        )).mappings().first()
        if not row:
            raise HTTPException(status_code=404, detail="job_id not found")
        meta = row["metadata"] or {}
        if isinstance(meta, str):
            import json as _j; meta = _j.loads(meta)
        corpus_dir = Path(meta.get("corpus_dir") or (Path(settings.corpus_store_path) / req.job_id))
        corpus_dir.mkdir(parents=True, exist_ok=True)
        job_id = req.job_id
    else:
        job_id = str(uuid.uuid4())
        corpus_dir = Path(settings.corpus_store_path) / job_id
        corpus_dir.mkdir(parents=True, exist_ok=True)

    # ── Save text file ───────────────────────────────────────────────────────
    safe_name = urlparse(req.url).netloc.replace(".", "_") + f"_{job_id[:8]}.txt"
    (corpus_dir / safe_name).write_text(page_text, encoding="utf-8")

    # ── Upsert DB job record ─────────────────────────────────────────────────
    meta_payload = json.dumps({
        "corpus_dir": str(corpus_dir),
        "source_url": req.url,
        "content_checksum": checksum,
        "db_creds": {},
    })
    if not req.job_id:
        await db.execute(text("""
            INSERT INTO ingest_jobs (job_id, status, file_count, domain_label, metadata)
            VALUES (:job_id, 'queued', 1, :domain, (:meta)::jsonb)
        """), {"job_id": job_id, "domain": req.domain_label, "meta": meta_payload})
    else:
        await db.execute(text("""
            UPDATE ingest_jobs
            SET status='queued', metadata=metadata || (:meta)::jsonb
            WHERE job_id=:job_id
        """), {"job_id": job_id, "meta": meta_payload})
    await db.commit()

    # ── Dispatch Celery task ─────────────────────────────────────────────────
    try:
        from app.tasks.ingest_task import run_ingest_pipeline
        run_ingest_pipeline.delay(job_id)
    except Exception as exc:
        return JSONResponse({"job_id": job_id, "status": "queued", "warning": str(exc)})

    return {"job_id": job_id, "status": "queued", "source_url": req.url, "file": safe_name}


def _extract_text_from_html(html: str, url: str = "") -> str:
    """Extract readable text from HTML. Uses readability-lxml if available, else BeautifulSoup."""
    try:
        from readability import Document
        doc = Document(html)
        clean_html = doc.summary()
        try:
            from bs4 import BeautifulSoup
            return BeautifulSoup(clean_html, "html.parser").get_text(separator=" ", strip=True)
        except ImportError:
            import re
            return re.sub(r"<[^>]+>", " ", clean_html)
    except ImportError:
        pass
    try:
        from bs4 import BeautifulSoup
        soup = BeautifulSoup(html, "html.parser")
        for tag in soup(["script", "style", "nav", "footer", "header", "aside"]):
            tag.decompose()
        return soup.get_text(separator=" ", strip=True)
    except ImportError:
        import re
        return re.sub(r"<[^>]+>", " ", html)


# ══════════════════════════════════════════════════════════════════════════════
# Graph query API (Phase 4)
# ══════════════════════════════════════════════════════════════════════════════

@router.get("/graph/{job_id}")
async def get_graph(job_id: str, db: AsyncSession = Depends(get_db)):
    """Return full knowledge graph (nodes + edges) for a corpus job."""
    corpus_dir = await _resolve_corpus_dir(job_id, db)
    graph_file = Path(corpus_dir) / "graphify-out" / "graph.json"
    if not graph_file.exists():
        raise HTTPException(status_code=404, detail="Graph not yet built for this job")
    data = json.loads(graph_file.read_text(encoding="utf-8"))
    nodes = data.get("nodes", [])
    edges = data.get("edges", [])
    return {
        "job_id": job_id,
        "node_count": len(nodes),
        "edge_count": len(edges),
        "nodes": nodes,
        "edges": edges,
    }


@router.get("/entities/{job_id}")
async def get_entities(
    job_id: str,
    type: str = "",
    limit: int = 100,
    db: AsyncSession = Depends(get_db),
):
    """
    Return entity nodes for a corpus job.
    Optional ?type= filters by entity type (organization, person, location, …).
    Combines graphify community nodes + NLP extractor results.
    """
    corpus_dir = await _resolve_corpus_dir(job_id, db)
    result: list[dict] = []

    # ── Graphify nodes ────────────────────────────────────────────────────────
    graph_file = Path(corpus_dir) / "graphify-out" / "graph.json"
    if graph_file.exists():
        data = json.loads(graph_file.read_text(encoding="utf-8"))
        for node in data.get("nodes", []):
            if type and node.get("type", "").lower() != type.lower():
                continue
            result.append({
                "text": node.get("id") or node.get("label"),
                "label": node.get("type", "ENTITY").upper(),
                "type": node.get("type", "entity"),
                "count": node.get("count", 1),
                "community": node.get("community"),
                "source": "graphify",
            })

    # ── NLP extractor entities ────────────────────────────────────────────────
    nlp_file = Path(corpus_dir) / "nlp_entities.json"
    if nlp_file.exists():
        try:
            nlp_data = json.loads(nlp_file.read_text(encoding="utf-8"))
            seen = {r["text"] for r in result}
            for doc_result in nlp_data:
                for ent in doc_result.get("entities", []):
                    if type and ent.get("type", "").lower() != type.lower():
                        continue
                    if ent["text"] not in seen:
                        seen.add(ent["text"])
                        result.append({**ent, "count": 1, "community": None, "source": "nlp"})
        except Exception:
            pass

    result.sort(key=lambda x: x.get("count", 1), reverse=True)
    return {
        "job_id": job_id,
        "total": len(result),
        "entities": result[:limit],
    }


@router.get("/search/{job_id}")
async def search_corpus(
    job_id: str,
    q: str,
    k: int = 5,
    db: AsyncSession = Depends(get_db),
):
    """
    Semantic chunk search over a corpus's FAISS index.
    Returns top-k matching passages with relevance scores.
    """
    if not q.strip():
        raise HTTPException(status_code=422, detail="Query string ?q= is required")
    corpus_dir = await _resolve_corpus_dir(job_id, db)
    try:
        from app.modules.data_curation.faiss_store import FaissStore
        store = FaissStore(corpus_dir)
        if not store.is_built:
            return {"job_id": job_id, "query": q, "results": [],
                    "message": "FAISS index not yet built for this job"}
        results = store.search(q, k=min(k, 20))
        return {"job_id": job_id, "query": q, "result_count": len(results), "results": results}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Search failed: {exc}")


# ══════════════════════════════════════════════════════════════════════════════
# Retry / Repair endpoints (Phase 5)
# ══════════════════════════════════════════════════════════════════════════════

@router.post("/retry/{job_id}")
async def retry_job(job_id: str, db: AsyncSession = Depends(get_db)):
    """
    If the graph is already built: re-run embed-only (FAISS indexing).
    Otherwise: re-run the full pipeline from source files.
    """
    corpus_dir, domain_label, graph_exists = await _job_meta(job_id, db)
    await db.execute(
        text("UPDATE ingest_jobs SET status='queued', error_message=NULL WHERE job_id=:id"),
        {"id": job_id},
    )
    await db.commit()

    try:
        if graph_exists:
            from app.tasks.ingest_task import reindex_pipeline
            reindex_pipeline.delay(job_id, corpus_dir)
            return {"job_id": job_id, "mode": "reindex_only", "status": "queued"}
        else:
            from app.tasks.ingest_task import run_ingest_pipeline
            run_ingest_pipeline.delay(job_id)
            return {"job_id": job_id, "mode": "full_pipeline", "status": "queued"}
    except Exception as exc:
        return JSONResponse({"job_id": job_id, "status": "queued", "warning": str(exc)})


@router.post("/repair/{job_id}")
async def repair_job(job_id: str, db: AsyncSession = Depends(get_db)):
    """Always re-run the full pipeline from source files, regardless of current state."""
    corpus_dir, domain_label, _ = await _job_meta(job_id, db)
    await db.execute(
        text("UPDATE ingest_jobs SET status='queued', error_message=NULL WHERE job_id=:id"),
        {"id": job_id},
    )
    await db.commit()
    try:
        from app.tasks.ingest_task import run_ingest_pipeline
        run_ingest_pipeline.delay(job_id)
    except Exception as exc:
        return JSONResponse({"job_id": job_id, "status": "queued", "warning": str(exc)})
    return {"job_id": job_id, "mode": "full_pipeline", "status": "queued"}


# ── Shared helpers ─────────────────────────────────────────────────────────────

async def _resolve_corpus_dir(job_id: str, db: AsyncSession) -> str:
    row = (await db.execute(
        text("SELECT graph_path, metadata FROM ingest_jobs WHERE job_id = :id"),
        {"id": job_id},
    )).mappings().first()
    if not row:
        raise HTTPException(status_code=404, detail="Job not found")
    graph_path = row.get("graph_path")
    if graph_path:
        return str(Path(graph_path).parent.parent)
    meta = row.get("metadata") or {}
    if isinstance(meta, str):
        try:
            meta = json.loads(meta)
        except Exception:
            meta = {}
    corpus_dir = meta.get("corpus_dir", "")
    if not corpus_dir:
        raise HTTPException(status_code=404, detail="Corpus directory not recorded for this job")
    return corpus_dir


async def _job_meta(job_id: str, db: AsyncSession) -> tuple[str, str, bool]:
    """Return (corpus_dir, domain_label, graph_exists) for a job."""
    row = (await db.execute(
        text("SELECT graph_path, metadata, domain_label, status FROM ingest_jobs WHERE job_id = :id"),
        {"id": job_id},
    )).mappings().first()
    if not row:
        raise HTTPException(status_code=404, detail="Job not found")
    corpus_dir = await _resolve_corpus_dir(job_id, db)
    graph_exists = bool(row.get("graph_path")) or (
        Path(corpus_dir) / "graphify-out" / "graph.json"
    ).exists()
    return corpus_dir, row.get("domain_label", "general"), graph_exists



@router.get("/wiki/{job_id}/stats")
async def get_wiki_stats(job_id: str, db: AsyncSession = Depends(get_db)):
    """
    Return token counts from the nanoGPT-format train.bin / val.bin files
    that WikiSerializer writes during ingest.
    Also returns article count and whether schema-enriched articles are present.
    """
    row = (await db.execute(
        text("SELECT graph_path, metadata, status FROM ingest_jobs WHERE job_id = :id"),
        {"id": job_id},
    )).mappings().first()

    if not row:
        raise HTTPException(status_code=404, detail="Job not found")

    corpus_dir = None
    graph_path = row.get("graph_path")
    if graph_path:
        corpus_dir = str(Path(graph_path).parent.parent)
    if not corpus_dir:
        meta = row.get("metadata") or {}
        if isinstance(meta, str):
            try:
                meta = json.loads(meta)
            except Exception:
                meta = {}
        corpus_dir = meta.get("corpus_dir", "")

    out_dir = Path(corpus_dir) / "graphify-out" if corpus_dir else None
    wiki_dir = out_dir / "wiki" if out_dir else None

    train_tokens = 0
    val_tokens = 0
    total_articles = 0
    schema_articles = 0

    if out_dir and out_dir.exists():
        train_bin = out_dir / "train.bin"
        val_bin = out_dir / "val.bin"
        # uint16 = 2 bytes per token
        if train_bin.exists():
            train_tokens = train_bin.stat().st_size // 2
        if val_bin.exists():
            val_tokens = val_bin.stat().st_size // 2

    if wiki_dir and wiki_dir.exists():
        all_md = list(wiki_dir.glob("*.md"))
        total_articles = len(all_md)
        schema_articles = len([f for f in all_md if f.name.startswith("schema_")])

    return {
        "job_id": job_id,
        "pipeline_status": row.get("status"),
        "train_tokens": train_tokens,
        "val_tokens": val_tokens,
        "total_tokens": train_tokens + val_tokens,
        "vocab_size": 100277,  # cl100k_base actual n_vocab
        "total_articles": total_articles,
        "schema_articles": schema_articles,
        "graphify_articles": total_articles - schema_articles,
    }


@router.post("/sample-corpus")
async def load_sample_corpus(
    domain_label: str = "nanogpt_ml",
    db: AsyncSession = Depends(get_db),
):
    """
    Fetch Karpathy's nanoGPT + minGPT files from GitHub (MIT licensed)
    and run them through the ingest pipeline as a starter demo corpus.
    Returns job_id so the client can track progress normally.
    """
    import aiohttp
    import tempfile
    import os

    SAMPLE_FILES = [
        {
            "url": "https://raw.githubusercontent.com/karpathy/nanoGPT/master/model.py",
            "filename": "nanogpt_model.py",
        },
        {
            "url": "https://raw.githubusercontent.com/karpathy/nanoGPT/master/train.py",
            "filename": "nanogpt_train.py",
        },
        {
            "url": "https://raw.githubusercontent.com/karpathy/minGPT/master/README.md",
            "filename": "minGPT_README.md",
        },
        {
            "url": "https://raw.githubusercontent.com/karpathy/minGPT/master/mingpt/model.py",
            "filename": "minGPT_model.py",
        },
    ]

    job_id = str(uuid.uuid4())
    corpus_dir = str(Path(settings.corpus_store_path) / job_id)
    Path(corpus_dir).mkdir(parents=True, exist_ok=True)

    # Download files
    downloaded = []
    try:
        async with aiohttp.ClientSession() as session:
            for item in SAMPLE_FILES:
                try:
                    async with session.get(item["url"], timeout=aiohttp.ClientTimeout(total=15)) as resp:
                        if resp.status == 200:
                            content = await resp.text()
                            file_path = Path(corpus_dir) / item["filename"]
                            file_path.write_text(content, encoding="utf-8")
                            downloaded.append(item["filename"])
                except Exception:
                    pass  # skip individual file failures
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Failed to fetch sample files: {e}")

    if not downloaded:
        raise HTTPException(status_code=502, detail="Could not download any sample files from GitHub")

    # Insert ingest job record
    await db.execute(
        text("""
            INSERT INTO ingest_jobs
                (job_id, domain_label, status, file_count, progress, metadata, created_at)
            VALUES
                (:job_id, :domain_label, 'queued', :file_count, '{}', :meta, NOW())
        """),
        {
            "job_id": job_id,
            "domain_label": domain_label,
            "file_count": len(downloaded),
            "meta": json.dumps({"corpus_dir": corpus_dir, "sample": True, "files": downloaded}),
        },
    )
    await db.commit()

    # Launch Celery ingest task
    from app.tasks.ingest_task import run_ingest_pipeline
    run_ingest_pipeline.delay(job_id)

    return {
        "job_id": job_id,
        "domain_label": domain_label,
        "files_downloaded": downloaded,
        "status": "queued",
    }


# ── Canonical graph endpoint ──────────────────────────────────────────────────

@router.get("/graph/{job_id}/canonical")
async def get_canonical_graph(
    job_id: str,
    db: AsyncSession = Depends(get_db),
):
    row = (await db.execute(
        text("SELECT job_id FROM ingest_jobs WHERE job_id=:id"),
        {"id": job_id},
    )).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="job not found")

    corpus_dir = f"corpus_store/{job_id}"
    from app.modules.graph.graph_builder import GraphBuilder
    gb = GraphBuilder(corpus_dir)
    canonical = gb.get_canonical_graph()
    return {"job_id": job_id, "canonical_graph": canonical}


@router.get("/ingestion-report/{job_id}")
async def ingestion_report(
    job_id: str,
    db: AsyncSession = Depends(get_db),
):
    import json as _json
    import os as _os
    row = (await db.execute(
        text("SELECT status, pipeline_steps, entity_count, file_count FROM ingest_jobs WHERE job_id=:id"),
        {"id": job_id},
    )).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="job not found")

    corpus_dir = f"corpus_store/{job_id}"
    processed_dir = _os.path.join(corpus_dir, "processed")

    scorecard_files = []
    if _os.path.isdir(processed_dir):
        for fname in _os.listdir(processed_dir):
            if fname.endswith("_kg_scorecard.json"):
                try:
                    with open(_os.path.join(processed_dir, fname), encoding="utf-8") as f:
                        scorecard_files.append({
                            "file_id": fname.replace("_kg_scorecard.json", ""),
                            "scorecard": _json.load(f),
                        })
                except Exception:
                    pass

    from app.modules.kg.entity_resolution import registry_metrics
    reg_metrics = registry_metrics(corpus_dir)

    return {
        "job_id": job_id,
        "status": row[0],
        "pipeline_steps": row[1],
        "entity_count": row[2],
        "file_count": row[3],
        "file_scorecards": scorecard_files,
        "registry_metrics": reg_metrics,
    }


# ── Semantic intelligence layer artifacts (14-layer pipeline) ──────────────────

@router.get("/intelligence/{job_id}")
async def get_intelligence(job_id: str, db: AsyncSession = Depends(get_db)):
    """
    Return the JSON artifacts produced by the new semantic-intelligence layers
    (metadata intelligence, semantic learning, ML validation, ontology governance,
    graph validation). Read-only and additive; a missing artifact returns {} so the
    UI can render whatever is available. Powers the per-layer panels on the
    Processing page.
    """
    corpus_dir = await _resolve_corpus_dir(job_id, db)
    artifacts = {
        "metadata_intelligence": "metadata_intelligence.json",
        "semantic_learning": "semantic_learning.json",
        "ml_validation": "ml_validation.json",
        "ontology": "ontology.json",
        "graph_validation": "graph_validation.json",
    }
    out: dict = {"job_id": job_id}
    for key, fname in artifacts.items():
        data: dict = {}
        try:
            fpath = Path(corpus_dir) / fname
            if fpath.exists():
                data = json.loads(fpath.read_text(encoding="utf-8"))
        except Exception:
            # Missing / unreadable artifact → empty payload, never 500.
            data = {}
        out[key] = data
    return out
