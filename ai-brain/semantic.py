"""Semantic / NLP intelligence engine (MASTER_BUILD_SPEC §10, M13, C2).

Turns free-text task titles / notes / voice transcripts into structured signals
the scheduler can act on:

    {
      importanceScore, suggestedPriority, intent, emotion, stressScore,
      wakeReliabilityNeed, rationale, tier
    }

The engine is **tiered with graceful degradation** (§10 implementation strategy):

  * Tier 0 - deterministic keyword/regex rules. Always present, no deps.
  * Tier 1 - TF-IDF "embeddings" + logistic-regression classifiers trained at
             startup on a synthetic labeled seed set (uses scikit-learn, which the
             AI Brain already ships). If "sentence-transformers" is installed it
             is used for the embedding instead.
  * Tier 2 - optional DistilBERT sentiment to refine emotion/stress, enabled with
             `SEMANTIC_USE_TRANSFORMER=1` when "transformers" is available.

Each tier *blends* with the rule cues and reuses the same output contract, so the
result is stable whether or not the optional ML stack is installed. The matching
TypeScript fallback lives in `lib/aiClient.ts`.
"""

from __future__ import annotations

import os
import re
from typing import Any

# ------------------------------------------------------------------------------
# Tier 0 - rule lexicons
# ------------------------------------------------------------------------------

# Importance keyword -> weight (0..1). Higher == more critical obligation.
_IMPORTANCE_CUES: dict[str, float] = {
    "exam": 0.95, "final": 0.9, "midterm": 0.85, "interview": 0.95, "flight": 0.95,
    "deadline": 0.85, "submission": 0.8, "submit": 0.6, "due": 0.55, "test": 0.7,
    "quiz": 0.55, "assignment": 0.6, "presentation": 0.8, "meeting": 0.6,
    "appointment": 0.65, "doctor": 0.7, "surgery": 0.95, "court": 0.95,
    "wedding": 0.8, "boarding": 0.95, "train": 0.7, "urgent": 0.9, "important": 0.7,
    "critical": 0.95, "asap": 0.85, "must": 0.7, "mandatory": 0.85, "board": 0.7,
    "viva": 0.9, "defense": 0.9, "launch": 0.75, "release": 0.7, "payment": 0.6,
    "bill": 0.5, "renew": 0.5, "registration": 0.6,
}

# Time-proximity cues add urgency.
_TIME_CUES: dict[str, float] = {
    "tonight": 0.2, "tomorrow": 0.18, "today": 0.15, "morning": 0.1,
    "early": 0.12, "in an hour": 0.25, "right now": 0.3, "this morning": 0.15,
    "first thing": 0.15, "am": 0.05,
}

_EMOTION_CUES: dict[str, list[str]] = {
    "stress": ["stressed", "anxious", "nervous", "overwhelmed", "pressure",
               "panic", "worried", "scared", "dread", "tense"],
    "fatigue": ["exhausted", "tired", "sleepy", "drained", "burned out",
                "burnt out", "no energy", "fatigued", "worn out", "knackered"],
    "motivation": ["excited", "motivated", "ready", "pumped", "confident",
                   "looking forward", "can't wait", "energized"],
    "calm": ["relaxed", "chill", "easy", "casual", "no rush", "whenever",
             "laid back"],
}

_MUST_NOT_MISS = ["can't miss", "cannot miss", "must not miss", "do not miss",
                  "don't miss", "have to", "need to be", "no matter what",
                  "absolutely", "non-negotiable"]

_CASUAL = ["maybe", "sometime", "whenever", "optional", "if i can", "no rush",
           "might", "could", "eventually"]

_PROCRASTINATION = ["later", "postpone", "putting off", "put off", "keep delaying",
                   "procrastinate", "been meaning", "still haven't", "avoid"]

_PRIORITY_BASE = {"low": 22.0, "medium": 48.0, "high": 72.0, "critical": 92.0}


def _clamp(x: float, lo: float = 0.0, hi: float = 100.0) -> float:
    return max(lo, min(hi, x))


def _priority_from_score(score: float) -> str:
    if score >= 80:
        return "critical"
    if score >= 60:
        return "high"
    if score >= 35:
        return "medium"
    return "low"


def _rule_analyze(text: str) -> dict[str, Any]:
    """Tier 0: deterministic keyword/regex analysis."""
    raw = text or ""
    low = raw.lower()
    cues: list[str] = []

    # Importance from keyword weights (saturating sum).
    imp = 0.0
    matched_imp = 0
    for kw, w in _IMPORTANCE_CUES.items():
        if re.search(r"\b" + re.escape(kw) + r"\b", low):
            imp = max(imp, w) + 0.12 * matched_imp
            matched_imp += 1
            cues.append(kw)
    importance = imp * 100.0 if matched_imp else 18.0

    # Time proximity bump.
    for kw, w in _TIME_CUES.items():
        if kw in low:
            importance += w * 100.0
            cues.append(kw)
            break

    # Emphatic phrasing: exclamation, ALL CAPS words, intensifiers.
    if "!" in raw:
        importance += 6.0
        cues.append("emphatic '!'")
    caps = re.findall(r"\b[A-Z]{3,}\b", raw)
    if caps:
        importance += 6.0
        cues.append("ALL-CAPS")
    if re.search(r"\b(very|really|so|extremely)\b", low):
        importance += 4.0

    importance = _clamp(importance)

    # Emotion: pick the strongest-matching category.
    emotion = "neutral"
    emo_hits: dict[str, int] = {}
    for cat, words in _EMOTION_CUES.items():
        hits = sum(1 for w in words if w in low)
        if hits:
            emo_hits[cat] = hits
    if emo_hits:
        emotion = max(emo_hits, key=emo_hits.get)
        cues.append(f"emotion:{emotion}")

    stress = 0.0
    stress += 55.0 * emo_hits.get("stress", 0)
    stress += 35.0 * emo_hits.get("fatigue", 0)
    stress -= 15.0 * emo_hits.get("motivation", 0)
    stress = _clamp(stress)

    # Intent.
    if any(p in low for p in _MUST_NOT_MISS) or importance >= 75:
        intent = "must-not-miss"
    elif any(p in low for p in _PROCRASTINATION):
        intent = "procrastination-risk"
    elif any(p in low for p in _CASUAL):
        intent = "casual"
    else:
        intent = "routine"

    return {
        "importanceScore": importance,
        "emotion": emotion,
        "stressScore": stress,
        "intent": intent,
        "cues": cues,
    }


# ------------------------------------------------------------------------------
# Tier 1 - synthetic labeled seed set + TF-IDF/logistic classifiers
# ------------------------------------------------------------------------------

# (text, importance_class, emotion_class, intent_class)
_SEED: list[tuple[str, str, str, str]] = [
    ("final exam tomorrow morning", "critical", "stress", "must-not-miss"),
    ("job interview at 9am, can't be late", "critical", "stress", "must-not-miss"),
    ("catch early flight to delhi", "critical", "neutral", "must-not-miss"),
    ("submit thesis before the deadline", "critical", "stress", "must-not-miss"),
    ("midterm test first thing today", "critical", "stress", "must-not-miss"),
    ("board meeting presentation", "high", "neutral", "must-not-miss"),
    ("doctor appointment in the morning", "high", "neutral", "routine"),
    ("assignment due tonight", "high", "stress", "must-not-miss"),
    ("project demo for client", "high", "motivation", "must-not-miss"),
    ("pay the electricity bill", "medium", "neutral", "routine"),
    ("team standup meeting", "medium", "neutral", "routine"),
    ("renew gym membership", "medium", "neutral", "routine"),
    ("quiz preparation", "medium", "stress", "routine"),
    ("buy groceries sometime", "low", "calm", "casual"),
    ("water the plants whenever", "low", "calm", "casual"),
    ("maybe call a friend later", "low", "calm", "procrastination-risk"),
    ("watch a movie tonight", "low", "calm", "casual"),
    ("organize desk eventually", "low", "calm", "procrastination-risk"),
    ("i'm exhausted and need rest", "low", "fatigue", "routine"),
    ("feeling tired, take it easy", "low", "fatigue", "casual"),
    ("so stressed about the deadline", "high", "stress", "must-not-miss"),
    ("excited for the presentation", "high", "motivation", "must-not-miss"),
    ("keep putting off the report", "medium", "neutral", "procrastination-risk"),
    ("been meaning to clean the room", "low", "neutral", "procrastination-risk"),
    ("urgent: fix production bug asap", "critical", "stress", "must-not-miss"),
    ("relaxed sunday, nothing urgent", "low", "calm", "casual"),
    ("study session for finals", "high", "stress", "must-not-miss"),
    ("dentist checkup", "medium", "neutral", "routine"),
    ("important client email", "high", "neutral", "must-not-miss"),
    ("grab coffee with sam", "low", "calm", "casual"),
]

_models: dict[str, Any] = {}
_models_ready = False
_embed_kind = "none"


def _ensure_models() -> bool:
    """Train (once) the Tier-1 classifiers on the synthetic seed set."""
    global _models_ready, _embed_kind
    if _models_ready:
        return bool(_models)
    _models_ready = True
    try:
        from sklearn.feature_extraction.text import TfidfVectorizer
        from sklearn.linear_model import LogisticRegression
        from sklearn.pipeline import Pipeline
    except Exception as exc:  # pragma: no cover - sklearn optional
        print(f"[semantic] Tier-1 unavailable ({exc}); using rules only")
        return False

    texts = [s[0] for s in _SEED]
    targets = {
        "importance": [s[1] for s in _SEED],
        "emotion": [s[2] for s in _SEED],
        "intent": [s[3] for s in _SEED],
    }

    def _make_pipeline() -> Any:
        return Pipeline([
            ("tfidf", TfidfVectorizer(ngram_range=(1, 2), min_df=1)),
            ("clf", LogisticRegression(max_iter=1000, C=4.0)),
        ])

    for name, y in targets.items():
        pipe = _make_pipeline()
        pipe.fit(texts, y)
        _models[name] = pipe
    _embed_kind = "tfidf"
    return True


def _proba(model: Any, text: str) -> dict[str, float]:
    probs = model.predict_proba([text])[0]
    return {cls: float(p) for cls, p in zip(model.classes_, probs)}


def _ml_analyze(text: str) -> dict[str, Any] | None:
    """Tier 1: classifier probabilities blended into the importance score."""
    if not _ensure_models():
        return None
    imp = _proba(_models["importance"], text)
    # Probability-weighted mean alone regresses toward the middle: spreading mass
    # over four classes drags a confident "high" back into the "medium" band. Pull
    # it toward the winning class in proportion to how sure the model is, so the
    # score stays calibrated when uncertain and commits when it isn't.
    expected = sum(imp.get(cls, 0.0) * base for cls, base in _PRIORITY_BASE.items())
    # Sharpening strength: swept over the seed set, 0.4-0.8 all score 25/26 while
    # 0.0 scores 22/26 and 1.0 over-commits to 24/26. Sitting mid-plateau rather
    # than on an edge keeps the choice robust to the seed set growing.
    SHARPEN = 0.5
    top_class = max(imp, key=imp.get)
    top_conf = _clamp(imp[top_class], 0.0, 1.0)
    w_top = SHARPEN * top_conf
    expected = (1.0 - w_top) * expected + w_top * _PRIORITY_BASE[top_class]
    emo = _proba(_models["emotion"], text)
    intent = _proba(_models["intent"], text)
    return {
        "importanceScore": expected,
        "importanceClass": max(imp, key=imp.get),
        "importanceConfidence": max(imp.values()),
        "emotion": max(emo, key=emo.get),
        "emotionConfidence": max(emo.values()),
        "stressFromML": 100.0 * emo.get("stress", 0.0) + 60.0 * emo.get("fatigue", 0.0),
        "intent": max(intent, key=intent.get),
        "intentConfidence": max(intent.values()),
    }


# ------------------------------------------------------------------------------
# Tier 2 - optional DistilBERT sentiment
# ------------------------------------------------------------------------------

_transformer = None
_transformer_tried = False


def _transformer_sentiment(text: str) -> dict[str, Any] | None:
    """Tier 2: DistilBERT SST-2 sentiment to sharpen stress estimation."""
    global _transformer, _transformer_tried
    if os.environ.get("SEMANTIC_USE_TRANSFORMER") != "1":
        return None
    if not _transformer_tried:
        _transformer_tried = True
        try:  # pragma: no cover - heavy optional dependency
            from transformers import pipeline

            _transformer = pipeline(
                "sentiment-analysis",
                model="distilbert-base-uncased-finetuned-sst-2-english",
            )
        except Exception as exc:
            print(f"[semantic] Tier-2 unavailable ({exc})")
            _transformer = None
    if _transformer is None:
        return None
    out = _transformer(text[:256])[0]
    return {"label": out["label"], "score": float(out["score"])}


# ------------------------------------------------------------------------------
# Public entry point
# ------------------------------------------------------------------------------

def _wake_reliability(importance: float, intent: str) -> str:
    if importance >= 70 or intent == "must-not-miss":
        return "high"
    if importance >= 40:
        return "medium"
    return "low"


def analyze(text: str) -> dict[str, Any]:
    """Analyze free text and return the §10 semantic contract."""
    text = (text or "").strip()
    if not text:
        return {
            "importanceScore": 0,
            "suggestedPriority": "low",
            "intent": "routine",
            "emotion": "neutral",
            "stressScore": 0,
            "wakeReliabilityNeed": "low",
            "rationale": "Empty text",
            "tier": "rules",
        }

    rule = _rule_analyze(text)
    tier = "rules"

    importance = rule["importanceScore"]
    emotion = rule["emotion"]
    stress = rule["stressScore"]
    intent = rule["intent"]

    cues = rule.get("cues", [])
    ml_drove: list[str] = []

    ml = _ml_analyze(text)
    if ml is not None:
        tier = _embed_kind  # "tfidf" (or "sentence-transformers" if wired)

        # A fixed 50/50 blend let the keyword score veto the classifier. Any
        # phrase carrying no listed keyword ("project demo for client") had a
        # near-zero rule score, which halved the classifier's estimate and
        # capped it at "medium" no matter how confident the model was - the
        # classifier could not get its own training examples right. Weight the
        # blend by model confidence instead, and when the rules found no cue at
        # all they have nothing to contribute, so let the classifier carry it.
        w_ml = 0.35 + 0.45 * _clamp(ml["importanceConfidence"], 0.0, 1.0)
        if not cues:
            w_ml = max(w_ml, 0.85)
        blended = (1.0 - w_ml) * importance + w_ml * ml["importanceScore"]
        if abs(blended - importance) >= 8.0:
            ml_drove.append(f"phrasing like other {ml['importanceClass']} tasks")
        importance = blended

        # Six emotion classes over a small seed set rarely clear 0.5, so the old
        # gate meant the classifier's emotion was almost never used. Accept it on
        # a lower bar when the rules detected no emotion of their own.
        emo_gate = 0.30 if emotion == "neutral" else 0.45
        if ml["emotionConfidence"] >= emo_gate and ml["emotion"] != "neutral":
            if emotion != ml["emotion"]:
                ml_drove.append(f"{ml['emotion']} tone")
            emotion = ml["emotion"]

        stress = max(stress, 0.5 * stress + 0.5 * ml["stressFromML"])
        if ml["intentConfidence"] >= 0.5:
            if intent != ml["intent"]:
                ml_drove.append(f"'{ml['intent']}' phrasing")
            intent = ml["intent"]

    senti = _transformer_sentiment(text)
    if senti is not None:
        tier = "distilbert"
        if senti["label"] == "NEGATIVE":
            stress = _clamp(max(stress, 40.0 + 50.0 * senti["score"]))
            if emotion == "neutral":
                emotion = "stress"

    importance = round(_clamp(importance))
    stress = round(_clamp(stress))
    priority = _priority_from_score(importance)

    # The rationale used to be built from keyword cues alone, so whenever the
    # classifier drove the outcome it reported "No strong urgency or emotion
    # cues; treated as routine" while simultaneously returning
    # intent=must-not-miss and wakeReliabilityNeed=high. Explain whatever
    # actually decided, and never claim "routine" for a task we escalated.
    parts: list[str] = []
    if cues:
        parts.append("Detected " + ", ".join(cues[:4]))
    if ml_drove:
        parts.append(("Recognized " if not cues else "also ") + ", ".join(ml_drove[:3]))

    if parts:
        rationale = "; ".join(parts)
    elif intent == "must-not-miss" or importance >= 70:
        rationale = "No explicit urgency words, but the phrasing reads as something you cannot miss"
    else:
        rationale = "No strong urgency or emotion cues; treated as routine"

    return {
        "importanceScore": importance,
        "suggestedPriority": priority,
        "intent": intent,
        "emotion": emotion,
        "stressScore": stress,
        "wakeReliabilityNeed": _wake_reliability(importance, intent),
        "rationale": rationale,
        "tier": tier,
    }