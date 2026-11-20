"""Error reports from the AI Brain (prompt 7.3).

An error no endpoint handled becomes a 500 whose body says what went wrong,
with personal details removed, and one JSON line on stderr (the host's log).
The app records the 500s it receives in its own database (lib/aiClient.ts,
lib/errorTracking.ts), so the AI Brain needs no database or secret of its own.

The scrubbing matches lib/errorTracking.ts's: email addresses, tokens, ids,
long numbers and URL queries never leave in a report.
"""
from __future__ import annotations

import json
import re
import sys
import traceback
import uuid
from typing import Any

_RULES: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}"), "<email>"),
    (re.compile(r"\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+(\.[A-Za-z0-9_-]+)?"), "<token>"),
    (re.compile(r"\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+", re.IGNORECASE), r"\1 <token>"),
    (re.compile(r"\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b", re.IGNORECASE), "<id>"),
    (re.compile(r"\b[0-9a-f]{24}\b", re.IGNORECASE), "<id>"),
    (re.compile(r"\b[0-9a-f]{32,}\b", re.IGNORECASE), "<hex>"),
    (re.compile(r"(https?://[^\s?#\"']+)[?#][^\s\"']*"), r"\1?<query>"),
    (re.compile(r"\+?\d[\d\s().-]{7,}\d"), "<number>"),
]

MAX_MESSAGE = 500
MAX_STACK = 2000


def scrub(text: str) -> str:
    for pattern, replacement in _RULES:
        text = pattern.sub(replacement, text)
    return text


def _clip(text: str, n: int) -> str:
    return text if len(text) <= n else text[: n - 1] + "…"


def report(exc: BaseException, where: str) -> dict[str, Any]:
    """The 500 body for an unhandled error, also written to stderr as one line."""
    frames = traceback.format_tb(exc.__traceback__)[-8:]
    out = {
        "error": "internal",
        "errorId": uuid.uuid4().hex[:12],
        "kind": type(exc).__name__,
        "message": _clip(scrub(str(exc) or "(no message)"), MAX_MESSAGE),
        "where": scrub(where.split("?")[0]),
        "stack": _clip(scrub("".join(frames)), MAX_STACK),
    }
    print(json.dumps({"event": "ai-brain-error", **out}), file=sys.stderr, flush=True)
    return out
