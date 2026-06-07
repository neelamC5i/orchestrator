"""Database connection + profiling routes."""
from __future__ import annotations
import json
import os
import uuid
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text
from typing import Optional
from app.db.database import get_db
from app.config import get_settings

router = APIRouter(prefix="/db", tags=["db"])

_DB_SESSION_TTL = 3600  # 1 hour
_local_engines: dict = {}  # non-serializable db_engine objects, keyed by db_id


def _redis():
    import redis
    return redis.from_url(get_settings().redis_url, decode_responses=True)


def _save_session(db_id: str, data: dict):
    serializable = {k: v for k, v in data.items() if k != "db_engine"}
    try:
        r = _redis()
        r.setex(f"db_session:{db_id}", _DB_SESSION_TTL, json.dumps(serializable, default=str))
    except Exception:
        pass


def _load_session(db_id: str) -> dict | None:
    try:
        r = _redis()
        raw = r.get(f"db_session:{db_id}")
        if raw:
            return json.loads(raw)
    except Exception:
        pass
    return None


class DBConnectRequest(BaseModel):
    engine: str = "postgresql"   # postgresql | mysql | sqlite
    host: Optional[str] = "localhost"
    port: Optional[int] = 5432
    dbname: Optional[str] = None
    user: Optional[str] = None
    password: Optional[str] = None
    path: Optional[str] = None   # for SQLite
    source_sql_dir: Optional[str] = None
    job_id: Optional[str] = None  # associate with a corpus job


@router.post("/connect")
async def db_connect(body: DBConnectRequest):
    """Connect to a DB, run schema introspection, and return a db_id."""
    from app.modules.db.db_connector import connect_db, get_schema_metadata
    db_id = str(uuid.uuid4())
    try:
        db_engine = connect_db(
            engine=body.engine,
            host=body.host or "localhost",
            port=body.port or 5432,
            dbname=body.dbname or "",
            user=body.user or "",
            password=body.password or "",
            path=body.path,
        )
        metadata = get_schema_metadata(db_engine)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Connection failed: {exc}")

    session_data = {
        "db_id": db_id,
        "engine": body.engine,
        "dbname": body.dbname,
        "host": body.host,
        "port": body.port,
        "user": body.user,
        "job_id": body.job_id,
        "metadata": metadata,
        "status": "connected",
    }
    _local_engines[db_id] = db_engine
    _save_session(db_id, session_data)
    return {
        "db_id": db_id,
        "status": "connected",
        "table_count": len(metadata.get("tables", [])),
        "dialect": metadata.get("dialect"),
    }


@router.post("/test")
async def db_test(body: DBConnectRequest):
    """Test DB connectivity without persisting a session."""
    from app.modules.db.db_connector import connect_db
    try:
        connect_db(
            engine=body.engine,
            host=body.host or "localhost",
            port=body.port or 5432,
            dbname=body.dbname or "",
            user=body.user or "",
            password=body.password or "",
            path=body.path,
        )
        return {"ok": True}
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))


def _get_session(db_id: str) -> dict:
    session = _load_session(db_id)
    if not session:
        raise HTTPException(status_code=404, detail="db session not found")
    if db_id not in _local_engines and session.get("engine"):
        from app.modules.db.db_connector import connect_db
        try:
            _local_engines[db_id] = connect_db(
                engine=session["engine"],
                host=session.get("host") or "localhost",
                port=session.get("port") or 5432,
                dbname=session.get("dbname") or "",
                user=session.get("user") or "",
                password="",
            )
        except Exception:
            pass
    session["db_engine"] = _local_engines.get(db_id)
    return session


@router.get("/status/{db_id}")
async def db_status(db_id: str):
    session = _get_session(db_id)
    return {
        "db_id": db_id,
        "status": session.get("status"),
        "dbname": session.get("dbname"),
        "host": session.get("host"),
        "table_count": len(session.get("metadata", {}).get("tables", [])),
    }


@router.get("/schema/{db_id}")
async def db_schema(db_id: str):
    session = _get_session(db_id)
    return {"db_id": db_id, "schema": session.get("metadata", {})}


@router.get("/profile/{db_id}")
async def db_profile(db_id: str):
    session = _get_session(db_id)
    if "profile" not in session:
        from app.modules.db.db_profiler import profile_database, detect_implicit_relationships
        metadata = session["metadata"]
        db_engine = session["db_engine"]
        profiled = profile_database(metadata, db_engine)
        implicit_rels = detect_implicit_relationships(metadata)
        session["profile"] = profiled
        session["implicit_relationships"] = implicit_rels
        _save_session(db_id, session)
    return {
        "db_id": db_id,
        "profile": session["profile"],
        "implicit_relationships": session.get("implicit_relationships", []),
    }


@router.get("/accuracy/{db_id}")
async def db_accuracy(db_id: str):
    session = _get_session(db_id)
    if "profile" not in session:
        raise HTTPException(status_code=400, detail="run /profile/{db_id} first")
    from app.modules.db.db_profiler import compute_accuracy_metrics
    accuracy = compute_accuracy_metrics(
        metadata=session["metadata"],
        profiled=session["profile"],
        graphify_graph=session.get("graph", {"nodes": [], "edges": []}),
        eda_artifact=session.get("eda_artifact"),
    )
    return {"db_id": db_id, "accuracy": accuracy}
