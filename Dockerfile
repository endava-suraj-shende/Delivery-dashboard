# ---------- frontend build ----------
FROM node:22-alpine AS frontend
WORKDIR /ui
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
RUN npm run build

# ---------- backend runtime ----------
FROM python:3.10-slim AS runtime
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 \
    EDD_HOST=0.0.0.0 EDD_PORT=8000 EDD_ENVIRONMENT=production \
    EDD_STATIC_DIR=/app/frontend/dist \
    EDD_DATA_DIR=/data/Data EDD_UPLOAD_DIR=/data/storage/uploads EDD_REPORT_DIR=/data/storage/reports \
    EDD_SNAPSHOT_DIR=/data/storage/snapshot EDD_BACKUP_DIR=/data/storage/backups \
    EDD_DATABASE_URL=sqlite:////data/storage/app.db \
    EDD_SECRET_KEY_PATH=/data/config/.secret.key \
    EDD_STATUS_CONFIG_PATH=/data/config/status_mapping.json EDD_JIRA_BOARDS_PATH=/data/config/jira_boards.json \
    EDD_JIRA_USER_MAP_PATH=/data/config/jira_user_map.json EDD_JIRA_CREDENTIALS_PATH=/data/config/jira_credentials.json \
    EDD_DATA_SOURCE_CONFIG_PATH=/data/config/data_source.json \
    EDD_CORS_ORIGINS='[]'
WORKDIR /app
RUN useradd --create-home --uid 10001 appuser && mkdir -p /data/Data /data/storage /data/config && chown -R appuser /data
COPY backend/requirements.lock backend/requirements.lock
RUN pip install -r backend/requirements.lock
COPY backend/ backend/
COPY manage.py run.py ./
COPY --from=frontend /ui/dist frontend/dist
USER appuser
WORKDIR /app/backend
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=90s CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=4).status==200 else 1)"
# migrations run automatically at start-up (EDD_AUTO_MIGRATE=1 default); demo accounts are self-healing
CMD ["python", "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers", "--forwarded-allow-ips", "*"]
