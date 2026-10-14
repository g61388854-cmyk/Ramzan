# Единый образ: сборка интерфейса + серверное приложение с локальным OCR (Tesseract).
FROM node:22.11.0-bookworm-slim AS frontend
WORKDIR /build
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm ci --no-audit --no-fund --ignore-scripts || npm install --no-audit --no-fund --ignore-scripts
COPY frontend/ ./
RUN npx tsc --noEmit && npx vite build

FROM python:3.12.7-slim-bookworm
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 \
    PAI_DATA_DIR=/data PAI_FRONTEND_DIR=/app/frontend PAI_OCR_ENGINE=auto
# Источники пакетов — по HTTPS
RUN sed -i 's|http://deb.debian.org|https://deb.debian.org|g' /etc/apt/sources.list.d/debian.sources \
    && apt-get update && apt-get install -y --no-install-recommends \
        tesseract-ocr tesseract-ocr-rus fonts-liberation fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/*
RUN useradd --system --uid 10001 --home /app pai
WORKDIR /app
COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY backend/ ./
COPY --from=frontend /build/dist /app/frontend
COPY deploy/entrypoint.sh /entrypoint.sh
RUN chmod 0755 /entrypoint.sh && mkdir -p /data && chown -R pai:pai /data
USER pai
VOLUME ["/data"]
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --retries=5 CMD python -c "import urllib.request,sys;sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/api/v1/health').status==200 else 1)"
ENTRYPOINT ["/entrypoint.sh"]
