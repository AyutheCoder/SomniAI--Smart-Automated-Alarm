"""Pytest configuration for the AI Brain.

The service modules sit at the package root and import each other by bare name
(`from predict import ...`), which is how uvicorn runs them. Tests live in
`tests/`, so the root has to be on `sys.path` for those imports to resolve the
same way they do in production.
"""

from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
