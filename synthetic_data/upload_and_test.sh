#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# RefreshCo CPG Synthetic Data — Upload & End-to-End Test Script
# Usage: bash upload_and_test.sh
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

API="http://localhost:8000/api/v1"
DATA_DIR="$(dirname "$0")/cpg_data"
DOMAIN="refreshco_cpg"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
NC='\033[0m'

ok()   { echo -e "${GREEN}✓${NC} $*"; }
info() { echo -e "${CYAN}ℹ${NC}  $*"; }
warn() { echo -e "${YELLOW}⚠${NC}  $*"; }
fail() { echo -e "${RED}✗${NC} $*"; }

separator() { echo -e "\n${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"; }

# ─── STEP 0: Prerequisites ────────────────────────────────────────────────────
separator
info "STEP 0 — Checking prerequisites"

if ! command -v curl &>/dev/null; then
  fail "curl is required"; exit 1
fi
if ! command -v jq &>/dev/null; then
  warn "jq not found — output will not be pretty-printed (install with: sudo apt install jq)"
  JQ_CMD="cat"
else
  JQ_CMD="jq ."
fi

# Check backend is running
if ! curl -sf "${API}/data/corpora" -o /dev/null 2>/dev/null; then
  fail "Backend not reachable at ${API}"
  info "Start with: cd \$(dirname \"\$0\")/../backend && uvicorn app.main:app --reload --port 8000"
  exit 1
fi
ok "Backend reachable at ${API}"

# Check data files exist
for f in cpg_sku_master.csv cpg_weekly_demand.csv cpg_inventory_snapshot.csv \
          cpg_trade_promotions.csv cpg_vendor_scorecard.csv \
          product_catalog.txt market_research_report.txt \
          category_playbook.txt trade_promotion_guidelines.txt; do
  if [ ! -f "${DATA_DIR}/${f}" ]; then
    fail "Missing: ${DATA_DIR}/${f} — run: python3 generate_cpg_data.py first"
    exit 1
  fi
done
ok "All 9 synthetic data files found in ${DATA_DIR}/"

# ─── STEP 1: Ingest ───────────────────────────────────────────────────────────
separator
info "STEP 1 — Uploading all 9 files (domain: ${DOMAIN})"
info "This triggers: parse → dedup → quality → schema_enrichment → graphify → wiki serialisation"
echo ""

INGEST_RESPONSE=$(curl -sf -X POST "${API}/data/ingest" \
  -F "domain_label=${DOMAIN}" \
  -F "force_reingest=true" \
  -F "files=@${DATA_DIR}/cpg_sku_master.csv" \
  -F "files=@${DATA_DIR}/cpg_weekly_demand.csv" \
  -F "files=@${DATA_DIR}/cpg_inventory_snapshot.csv" \
  -F "files=@${DATA_DIR}/cpg_trade_promotions.csv" \
  -F "files=@${DATA_DIR}/cpg_vendor_scorecard.csv" \
  -F "files=@${DATA_DIR}/product_catalog.txt" \
  -F "files=@${DATA_DIR}/market_research_report.txt" \
  -F "files=@${DATA_DIR}/category_playbook.txt" \
  -F "files=@${DATA_DIR}/trade_promotion_guidelines.txt")

JOB_ID=$(echo "$INGEST_RESPONSE" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('job_id',''))")
STATUS=$(echo "$INGEST_RESPONSE"  | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('status',''))")

if [ -z "$JOB_ID" ]; then
  fail "Ingest failed — response:"
  echo "$INGEST_RESPONSE" | ${JQ_CMD}
  exit 1
fi

ok "Ingest queued — job_id: ${JOB_ID}  status: ${STATUS}"
echo "$JOB_ID" > /tmp/cpg_job_id.txt
info "Job ID saved to /tmp/cpg_job_id.txt"

# ─── STEP 2: Poll progress ────────────────────────────────────────────────────
separator
info "STEP 2 — Polling progress (up to 10 minutes)"
echo ""

MAX_WAIT=600   # 10 min
ELAPSED=0
LAST_STEP=""
SPINNER=("⣾" "⣽" "⣻" "⢿" "⡿" "⣟" "⣯" "⣷")
SP_IDX=0

while [ $ELAPSED -lt $MAX_WAIT ]; do
  PROG=$(curl -sf "${API}/data/status/${JOB_ID}" 2>/dev/null || echo '{}')
  CURR_STATUS=$(echo "$PROG" | python3 -c "import sys,json; print(json.load(sys.stdin).get('status','unknown'))" 2>/dev/null || echo "unknown")
  CURR_STEP=$(echo "$PROG"   | python3 -c "import sys,json; d=json.load(sys.stdin); steps=d.get('steps',[]); print(steps[-1].get('label','') if steps else '')" 2>/dev/null || echo "")
  PCT=$(echo "$PROG" | python3 -c "import sys,json; print(round(json.load(sys.stdin).get('progress_pct',0)))" 2>/dev/null || echo "0")

  if [ "$CURR_STEP" != "$LAST_STEP" ] && [ -n "$CURR_STEP" ]; then
    echo ""
    ok "${CURR_STEP}"
    LAST_STEP="$CURR_STEP"
  fi
  printf "\r  ${SPINNER[$SP_IDX]} %3d%%  status: %-12s" "$PCT" "$CURR_STATUS"
  SP_IDX=$(( (SP_IDX + 1) % 8 ))

  if [ "$CURR_STATUS" = "graph_done" ]; then
    echo ""
    ok "Pipeline completed successfully!"
    break
  elif [ "$CURR_STATUS" = "failed" ] || [ "$CURR_STATUS" = "error" ]; then
    echo ""
    fail "Pipeline failed — full status:"
    echo "$PROG" | ${JQ_CMD}
    exit 1
  fi
  sleep 5
  ELAPSED=$((ELAPSED + 5))
done

if [ "$CURR_STATUS" != "graph_done" ]; then
  warn "Timed out waiting. Last status: ${CURR_STATUS}. Check manually:"
  info "  curl -s ${API}/data/status/${JOB_ID} | jq ."
  exit 1
fi

# ─── STEP 3: Verify wiki articles ─────────────────────────────────────────────
separator
info "STEP 3 — Verifying wiki articles (schema + graphify)"
echo ""

WIKI=$(curl -sf "${API}/data/wiki/${JOB_ID}" 2>/dev/null || echo '{"articles":[]}')
ARTICLE_COUNT=$(echo "$WIKI" | python3 -c "import sys,json; print(len(json.load(sys.stdin).get('articles',[])))" 2>/dev/null || echo 0)
SCHEMA_COUNT=$(echo "$WIKI" | python3 -c "
import sys,json
arts=json.load(sys.stdin).get('articles',[])
print(sum(1 for a in arts if a.get('title','').startswith('Schema:')))
" 2>/dev/null || echo 0)

ok "Total wiki articles: ${ARTICLE_COUNT}"
ok "Schema enrichment articles (structured tables): ${SCHEMA_COUNT}"

if [ "$SCHEMA_COUNT" -gt 0 ]; then
  info "Schema article titles:"
  echo "$WIKI" | python3 -c "
import sys,json
arts=json.load(sys.stdin).get('articles',[])
for a in arts:
    if a.get('title','').startswith('Schema:'):
        print('    •', a['title'])
" 2>/dev/null || true
else
  warn "No schema articles found — schema_enricher may not have run yet"
fi

# ─── STEP 4: Wiki stats (token counts) ────────────────────────────────────────
separator
info "STEP 4 — Wiki/corpus stats (train.bin / val.bin token counts)"
echo ""

STATS=$(curl -sf "${API}/data/wiki/${JOB_ID}/stats" 2>/dev/null || echo '{}')
TRAIN_TOK=$(echo "$STATS" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('train_tokens',0):,)" 2>/dev/null || echo "N/A")
TOT_TOK=$(echo "$STATS"   | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('total_tokens',0))" 2>/dev/null || echo "N/A")
TOTAL_ART=$(echo "$STATS" | python3 -c "import sys,json; print(json.load(sys.stdin).get('total_articles',0))" 2>/dev/null || echo "N/A")

ok "Total tokens (train+val): ${TOT_TOK}"
ok "Total articles: ${TOTAL_ART}"
echo ""
echo "$STATS" | python3 -c "
import sys,json
d=json.load(sys.stdin)
print('  train_tokens      :', d.get('train_tokens',0))
print('  val_tokens        :', d.get('val_tokens',0))
print('  schema_articles   :', d.get('schema_articles',0))
print('  graphify_articles :', d.get('graphify_articles',0))
print('  vocab_size        :', d.get('vocab_size',0))
" 2>/dev/null || echo "$STATS"

# ─── STEP 5: Orchestrator queries ─────────────────────────────────────────────
separator
info "STEP 5 — Firing 5 test orchestrator queries"
echo ""

ask_orchestrator() {
  local LABEL="$1"
  local QUERY="$2"
  echo -e "  ${CYAN}Query:${NC} ${QUERY}"
  RESP=$(curl -sf -X POST "${API}/orchestrator/ask" \
    -H "Content-Type: application/json" \
    -d "{\"query\": \"${QUERY}\", \"corpus_id\": \"${JOB_ID}\"}" 2>/dev/null || echo '{}')
  ANSWER=$(echo "$RESP" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('final_answer','(no answer)')[:300])" 2>/dev/null || echo "(parse error)")
  INTENT=$(echo "$RESP" | python3 -c "import sys,json; print(json.load(sys.stdin).get('intent','?'))" 2>/dev/null || echo "?")
  STEPS=$(echo "$RESP"  | python3 -c "import sys,json; print(len(json.load(sys.stdin).get('steps',[])))" 2>/dev/null || echo "0")
  echo -e "  ${GREEN}Intent:${NC} ${INTENT}   ${GREEN}Reasoning steps:${NC} ${STEPS}"
  echo -e "  ${GREEN}Answer:${NC} ${ANSWER}"
  echo ""
}

ask_orchestrator "Demand forecast"    "What is the adjusted demand forecast for ZingEnergy SKUs over the next 4 weeks?"
ask_orchestrator "Inventory risk"     "Which SKUs have critically low inventory at any plant right now?"
ask_orchestrator "Promo ROI"          "Which trade promotions had the highest ROI and what drove the lift?"
ask_orchestrator "Vendor risk"        "Are there any vendors with OTIF below 85% and what products do they supply?"
ask_orchestrator "Schema columns"     "What does the ADJSTD_DMND_QTY_WK4_FCST column mean and how is it calculated?"

# ─── DONE ─────────────────────────────────────────────────────────────────────
separator
ok "End-to-end test complete!"
echo ""
info "Next steps:"
echo "  1. Open http://localhost:3001/processing  → watch live pipeline steps"
echo "  2. Open http://localhost:3001/wiki        → browse schema + graphify articles"
echo "  3. Open http://localhost:3001/query       → ask free-form questions"
echo "  4. Open http://localhost:3001/recommendations → full orchestrator output"
echo ""
info "Job ID: ${JOB_ID}"
info "Re-query later:  curl -s ${API}/data/status/${JOB_ID} | jq ."
