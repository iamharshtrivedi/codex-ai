# ──────────────────────────────────────────────
#  Dockerfile — Codex AI Agent for Cloud Run
# ──────────────────────────────────────────────
FROM python:3.12-slim

# Prevent Python from writing .pyc files and enable stdout flushing
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

# Install system dependencies (needed for compiling Python packages and SQLite)
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential curl sqlite3 \
    && rm -rf /var/lib/apt/lists/*

# Install Python dependencies first (leverage Docker cache)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application source code
COPY . .

# Ensure the database directory exists and has correct permissions
RUN mkdir -p database && chmod 777 database

# Cloud Run injects PORT env var; default to 8000 to match local
ENV PORT=8000
EXPOSE 8000

# Start the FastAPI server using the dedicated entry point
CMD ["python", "server.py"]