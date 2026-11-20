"""Who may call the AI Brain (prompt 7.4).

Deployed, the AI Brain has a public address, and only the SomniAI app should
use it. With AI_BRAIN_TOKEN set, every endpoint except /health needs
"Authorization: Bearer <token>"; the app sends it (lib/aiClient.ts). /health
stays open for uptime monitors and says only whether the models are loaded.
Without the variable (local development, the tests) everything is open, as before.
"""
from __future__ import annotations

import hmac

OPEN_PATHS = frozenset({"/health"})


def allowed(path: str, authorization: str | None, token: str | None) -> bool:
    if not token or path in OPEN_PATHS:
        return True
    return hmac.compare_digest((authorization or "").encode(), f"Bearer {token}".encode())
