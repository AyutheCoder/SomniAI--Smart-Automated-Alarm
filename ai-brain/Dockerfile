# SomniAI AI Brain - FastAPI ML microservice
FROM python:3.11-slim

WORKDIR /app

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# The models are trained on real data (LifeSnaps) and committed in models/real
# (prompt 5.2, MODEL_CARD.md); the image has no datasets and trains nothing.
RUN python -c "import predict; predict.load_models(); print('models loaded:', sorted(predict.get_meta()['models']))"

EXPOSE 8000
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]