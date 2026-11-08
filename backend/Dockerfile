FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 \
    FASTEMBED_CACHE_PATH=/app/.fastembed HF_HUB_DISABLE_TELEMETRY=1
WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
# Bake the embedding model into the image so cold starts don't download it
RUN python -c "from fastembed import TextEmbedding; list(TextEmbedding('sentence-transformers/all-MiniLM-L6-v2').embed(['warmup']))"

COPY . .
# Runs as root: Railway volumes mount root-owned at /data (SQLite + embedded Qdrant live there)
RUN mkdir -p /data

EXPOSE 8000
# Single worker: paused approvals live in the in-process LangGraph checkpointer (same as AUBI).
CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000} --workers 1 --proxy-headers"]
