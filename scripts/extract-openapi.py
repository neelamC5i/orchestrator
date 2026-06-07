#!/usr/bin/env python3
"""
Extract the OpenAPI spec from the FastAPI app and write it to stdout as JSON.

Usage:
    cd backend && python ../scripts/extract-openapi.py > openapi.json
"""
import json
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))

from app.main import app  # noqa: E402

spec = app.openapi()
json.dump(spec, sys.stdout, indent=2, default=str)
