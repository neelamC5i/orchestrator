#!/usr/bin/env bash
# Start all orchestrator services (for local dev without Docker)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND="$SCRIPT_DIR/backend"
FRONTEND="$SCRIPT_DIR/frontend"
LOG_DIR="$SCRIPT_DIR/logs"
BACKEND_LOG="$LOG_DIR/backend.log"
CELERY_LOG="$LOG_DIR/celery.log"
FRONTEND_LOG="$LOG_DIR/frontend.log"
REDIS_LOG="$LOG_DIR/redis.log"

mkdir -p "$LOG_DIR"

if [[ -x "$BACKEND/venv/bin/python" ]]; then
  UVICORN_BIN="$BACKEND/venv/bin/uvicorn"
  CELERY_BIN="$BACKEND/venv/bin/celery"
elif [[ -x "$BACKEND/.venv/bin/python" ]]; then
  UVICORN_BIN="$BACKEND/.venv/bin/uvicorn"
  CELERY_BIN="$BACKEND/.venv/bin/celery"
else
  UVICORN_BIN="uvicorn"
  CELERY_BIN="celery"
fi

echo "==> Starting Redis (if not running)..."
if ! redis-cli ping > /dev/null 2>&1; then
  redis-server --daemonize yes --logfile "$REDIS_LOG"
  sleep 1
fi

echo "==> Starting Backend (uvicorn)..."
kill $(pgrep -f "uvicorn app.main") 2>/dev/null || true
sleep 1
cd "$BACKEND"
nohup "$UVICORN_BIN" app.main:app --host 0.0.0.0 --port 8000 > "$BACKEND_LOG" 2>&1 &
echo "   Backend PID: $!"

echo "==> Starting Celery worker..."
kill $(pgrep -f "celery.*worker") 2>/dev/null || true
sleep 1
nohup "$CELERY_BIN" -A app.tasks worker -Q ingest,celery -n "orchestrator_${USER}@%h" --loglevel=info --concurrency=2 > "$CELERY_LOG" 2>&1 &
echo "   Celery PID: $!"

echo "==> Starting Frontend (Next.js on :3001)..."
# Kill whichever process is bound to 3001 (robust against stale next-server instances).
PORT_3001_PIDS="$(ss -ltnp 2>/dev/null | sed -n 's/.*:3001 .*pid=\([0-9]\+\).*/\1/p' | sort -u)"
if [[ -n "$PORT_3001_PIDS" ]]; then
  kill $PORT_3001_PIDS 2>/dev/null || true
fi
kill $(pgrep -f "next start.*3001") 2>/dev/null || true
sleep 1
cd "$FRONTEND"
nohup npm start -- -p 3001 > "$FRONTEND_LOG" 2>&1 &
echo "   Frontend PID: $!"

echo ""
echo "Waiting for services..."
sleep 6

echo -n "Backend:  "; curl -s http://localhost:8000/health || echo "NOT UP"
echo -n "Frontend: "; curl -s http://localhost:3001 > /dev/null && echo '{"status":"ok"}' || echo "NOT UP"
echo -n "Celery:   "; pgrep -u "$USER" -f "celery.*worker" > /dev/null && echo "running (PID $(pgrep -u "$USER" -f 'celery.*worker' | head -1))" || echo "NOT RUNNING"

echo ""
echo "Logs: $BACKEND_LOG | $CELERY_LOG | $FRONTEND_LOG"
