from __future__ import annotations

import os
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, ConfigDict

import access as access_mod
import errors as errors_mod
import predict as predict_mod
import recommend as recommend_mod
import rl as rl_mod
import semantic as semantic_mod
import wake_plan as wake_plan_mod


@asynccontextmanager
async def lifespan(_app: FastAPI):
    try:
        predict_mod.load_models()
    except Exception as exc:  # pragma: no cover - surfaced via /health
        print(f"[ai-brain] model load failed: {exc}")
    yield


app = FastAPI(title="SomniAI AI Brain", version="0.1.0", lifespan=lifespan)


@app.exception_handler(predict_mod.ModelsUnavailable)
async def models_unavailable(_request: Request, exc: predict_mod.ModelsUnavailable) -> JSONResponse:
    # No models, no prediction: the app falls back to its own rules and says so.
    # Never a synthetic stand-in (prompt 5.2).
    return JSONResponse(status_code=503, content={"error": "models unavailable", "detail": str(exc)})

@app.exception_handler(Exception)
async def unhandled(request: Request, exc: Exception) -> JSONResponse:
    # Error tracking (prompt 7.3): a clear 500 the app records, never a bare
    # "Internal Server Error"; personal details removed (errors.py).
    return JSONResponse(status_code=500, content=errors_mod.report(exc, request.url.path))


@app.middleware("http")
async def require_token(request: Request, call_next):
    # Deployed, only the app may call it (access.py, prompt 7.4). Read per request, so tests can set it.
    if not access_mod.allowed(request.url.path, request.headers.get("authorization"), os.environ.get("AI_BRAIN_TOKEN")):
        return JSONResponse(status_code=401, content={"error": "unauthorized"})
    return await call_next(request)


_origins = os.environ.get("AI_BRAIN_ALLOW_ORIGINS", "*").split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in _origins],
    allow_methods=["*"],
    allow_headers=["*"],
)


class FeaturesRequest(BaseModel):
    model_config = ConfigDict(extra="allow")
    features: dict[str, Any] | None = None

    def feature_dict(self) -> dict[str, Any]:
        if self.features is not None:
            return self.features
        # Tolerate callers that send feature keys at the top level.
        return {k: v for k, v in self.model_dump().items() if k != "features"}


class RecommendRequest(BaseModel):
    model_config = ConfigDict(extra="allow")
    metrics: dict[str, Any] | None = None
    recentSleepHours: float | None = None
    predictedSleepDuration: float | None = None
    sleepGoalHours: float | None = None
    oversleepProbability: float | None = None
    wakeSuccessProbability: float | None = None


class SemanticRequest(BaseModel):
    model_config = ConfigDict(extra="allow")
    text: str | None = None
    context: str | None = None


class WakePlanRequest(BaseModel):
    model_config = ConfigDict(extra="allow")
    features: dict[str, Any] | None = None
    requiredReliability: float | None = None
    wakeTime: str | None = None
    minSleepHours: float | None = None


class RlUpdateRequest(BaseModel):
    model_config = ConfigDict(extra="allow")
    policy: dict[str, Any] | None = None
    context: dict[str, Any] | None = None
    action: dict[str, Any] | None = None
    outcome: str | None = None
    snoozes: float | None = None
    ttwMin: float | None = None
    satisfaction: float | None = None
    reward: float | None = None
    weights: dict[str, Any] | None = None


@app.get("/health")
def health() -> dict[str, Any]:
    return {
        "status": "ok",
        "modelsLoaded": predict_mod.models_loaded(),
        # The model card (MODEL_CARD.md): what they were trained on and how well they do.
        "meta": predict_mod.get_meta(),
    }


@app.post("/predict/sleep")
def predict_sleep(req: FeaturesRequest) -> dict[str, Any]:
    return predict_mod.predict_sleep(req.feature_dict())


@app.post("/predict/wake-success")
def predict_wake_success(req: FeaturesRequest) -> dict[str, Any]:
    return predict_mod.predict_wake_success(req.feature_dict())


class BatchRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")
    rows: list[dict[str, Any]] = []


@app.post("/predict/batch")
def predict_batch(req: BatchRequest) -> Any:
    """The population models for many nights at once, for personalisation (prompt 5.3)."""
    try:
        return predict_mod.predict_batch(req.rows)
    except ValueError as exc:
        return JSONResponse(status_code=422, content={"error": str(exc)})


@app.post("/recommend")
def recommend(req: RecommendRequest) -> dict[str, Any]:
    return recommend_mod.build_report(req.model_dump())


@app.post("/semantic/analyze")
def semantic_analyze(req: SemanticRequest) -> dict[str, Any]:
    text = req.text or req.context or ""
    return semantic_mod.analyze(text)


@app.post("/rl/update")
def rl_update(req: RlUpdateRequest) -> dict[str, Any]:
    return rl_mod.update(req.model_dump())


@app.post("/plan/wake")
def plan_wake(req: WakePlanRequest) -> dict[str, Any]:
    """Invert the model: latest bedtime that meets a required wake reliability."""
    return wake_plan_mod.plan_wake(req.model_dump())


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=int(os.environ.get("PORT", "8000")),
        reload=bool(os.environ.get("AI_BRAIN_RELOAD")),
    )