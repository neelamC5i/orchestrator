#!/usr/bin/env bash
# Start all orchestrator services (for local dev without Docker)
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND="$SCRIPT_DIR/backend"
FRONTEND="$SCRIPT_DIR/frontend"

echo "==> Starting Redis (if not running)..."
if ! redis-cli ping > /dev/null 2>&1; then
  redis-server --daemonize yes --logfile /tmp/redis.log
  sleep 1
fi

echo "==> Starting Backend (uvicorn)..."
kill $(pgrep -f "uvicorn app.main") 2>/dev/null || true
sleep 1
cd "$BACKEND"
nohup .venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8000 > /tmp/backend.log 2>&1 &
echo "   Backend PID: $!"

echo "==> Starting Celery worker..."
kill $(pgrep -f "celery.*worker") 2>/dev/null || true
sleep 1
nohup .venv/bin/celery -A app.tasks worker --loglevel=info --concurrency=2 > /tmp/celery.log 2>&1 &
echo "   Celery PID: $!"

echo "==> Starting Frontend (Next.js on :3000)..."
kill $(pgrep -f "next start") 2>/dev/null || true
sleep 1
cd "$FRONTEND"
PORT=3000 nohup npm start > /tmp/frontend.log 2>&1 &
echo "   Frontend PID: $!"

echo ""
echo "Waiting for services..."
sleep 5

echo -n "Backend:  "; curl -s http://localhost:8000/health || echo "NOT UP"
echo -n "Frontend: "; curl -s http://localhost:3000 > /dev/null && echo '{"status":"ok"}' || echo "NOT UP"
echo -n "Celery:   "; pgrep -f "celery.*worker" > /dev/null && echo "running (PID $(pgrep -f 'celery.*worker' | head -1))" || echo "NOT RUNNING"

echo ""
echo "Logs: /tmp/backend.log | /tmp/celery.log | /tmp/frontend.log"
