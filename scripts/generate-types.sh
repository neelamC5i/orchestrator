#!/usr/bin/env bash
# Generate TypeScript types from the running backend's OpenAPI spec.
# Requires: backend running on :8000, npx available.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$SCRIPT_DIR/.."
FRONTEND="$ROOT/frontend"
SPEC_FILE="$ROOT/backend/openapi.json"

echo "Fetching OpenAPI spec from backend..."
curl -sf http://localhost:8000/openapi.json -o "$SPEC_FILE"

echo "Generating TypeScript types..."
cd "$FRONTEND"
npx openapi-typescript "$SPEC_FILE" -o app/lib/api-types.ts

echo "Done — types written to frontend/app/lib/api-types.ts"
