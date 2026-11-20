"""Only the app may call the deployed AI Brain (prompt 7.4)."""
from __future__ import annotations

import pytest

import access


def test_open_without_a_token_as_in_development():
    assert access.allowed("/predict/sleep", None, None)
    assert access.allowed("/predict/sleep", None, "")


def test_with_a_token_only_the_right_bearer_passes():
    assert access.allowed("/predict/sleep", "Bearer s3cret-token", "s3cret-token")
    for given in (None, "", "Bearer wrong", "s3cret-token", "bearer s3cret-token", "Bearer s3cret-token "):
        assert not access.allowed("/predict/sleep", given, "s3cret-token"), given


def test_health_stays_open_for_uptime_monitors():
    assert access.allowed("/health", None, "s3cret-token")


def test_the_service_refuses_a_call_without_the_token(monkeypatch):
    pytest.importorskip("httpx")
    pytest.importorskip("fastapi")
    from fastapi.testclient import TestClient

    import main

    monkeypatch.setenv("AI_BRAIN_TOKEN", "s3cret-token")
    client = TestClient(main.app)
    refused = client.post("/semantic/analyze", json={"text": "exam at 9"})
    assert refused.status_code == 401
    assert refused.json() == {"error": "unauthorized"}
    allowed = client.post("/semantic/analyze", json={"text": "exam at 9"}, headers={"Authorization": "Bearer s3cret-token"})
    assert allowed.status_code == 200
    assert client.get("/health").status_code == 200
