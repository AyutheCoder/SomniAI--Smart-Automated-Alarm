"""Error reports from the AI Brain (prompt 7.3): scrubbed like the app's, and
a clear 500 instead of a bare one."""
from __future__ import annotations

import json
from pathlib import Path

import pytest

import errors

CASES = json.loads((Path(__file__).resolve().parents[2] / "tests" / "fixtures" / "error-scrub" / "cases.json").read_text(encoding="utf-8"))


@pytest.mark.parametrize("case", CASES, ids=[c["in"][:40] for c in CASES])
def test_scrubs_like_the_app(case):
    # The same cases as lib/errorTracking.test.ts: one report reads the same from either side.
    assert errors.scrub(case["in"]) == case["out"]


def test_report_is_scrubbed_clipped_and_logged(capsys):
    try:
        raise ValueError("no plan for sleeper@example.org " + "x" * 900)
    except ValueError as exc:
        out = errors.report(exc, "/plan/wake?user=64f0a1b2c3d4e5f601234567")
    assert out["error"] == "internal"
    assert out["kind"] == "ValueError"
    assert out["message"].startswith("no plan for <email> ")
    assert len(out["message"]) == errors.MAX_MESSAGE
    assert out["where"] == "/plan/wake"
    assert "test_errors.py" in out["stack"]
    logged = json.loads(capsys.readouterr().err.strip())
    assert logged["event"] == "ai-brain-error"
    assert logged["errorId"] == out["errorId"]
    assert "sleeper@example.org" not in json.dumps(logged)


def test_an_unhandled_error_is_a_clear_500():
    pytest.importorskip("httpx")
    fastapi = pytest.importorskip("fastapi")
    from fastapi.testclient import TestClient

    import main

    route = "/__test_boom"
    if not any(getattr(r, "path", None) == route for r in main.app.routes):
        @main.app.get(route)
        def boom():  # pragma: no cover - raises
            raise RuntimeError("broke for someone@example.org")
    client = TestClient(main.app, raise_server_exceptions=False)
    res = client.get(route)
    assert res.status_code == 500
    body = res.json()
    assert body["error"] == "internal"
    assert body["kind"] == "RuntimeError"
    assert body["message"] == "broke for <email>"
    assert body["where"] == route
    assert fastapi is not None
