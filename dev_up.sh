#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$PROJECT_DIR"

bold() { printf "\033[1m%s\033[0m\n" "$*"; }
info() { printf "[INFO] %s\n" "$*"; }
warn() { printf "[WARN] %s\n" "$*"; }
err()  { printf "[ERROR] %s\n" "$*"; }

# 1) Check Docker is running
if ! docker info >/dev/null 2>&1; then
  err "Docker does not appear to be running. Please start Docker Desktop and retry."
  exit 1
fi

# 2) Ensure required env files exist
if [[ ! -f ./.env ]]; then
  warn "./.env not found (root). Continuing; only python_service/.env is required for GenAI."
fi
if [[ ! -f ./python_service/.env ]]; then
  warn "python_service/.env not found. GenAI may fail without GENAI_API_KEY. Create python_service/.env with:\nGENAI_API_KEY=your_key\nGENAI_MODEL=gemini-2.5-flash"
fi

# 3) Build and start all services
bold "Building and starting containers..."
docker compose up -d --build

# 4) Wait for backend health
BACKEND_URL="http://localhost:3001/api/health"
ATTEMPTS=40
SLEEP=2
bold "Waiting for backend: $BACKEND_URL"
for i in $(seq 1 $ATTEMPTS); do
  if curl -fsS "$BACKEND_URL" | grep -q '"ok":true'; then
    info "Backend is healthy."
    break
  fi
  sleep $SLEEP
  if [[ $i -eq $ATTEMPTS ]]; then
    err "Backend did not become healthy in time. Check logs: docker compose logs --tail=200 backend"
    exit 1
  fi
done

# 5) Optionally wait for frontend to serve (index)
FRONTEND_URL="http://localhost:8080"
bold "Waiting for frontend: $FRONTEND_URL"
for i in $(seq 1 30); do
  if curl -fsS -o /dev/null "$FRONTEND_URL"; then
    info "Frontend is up."
    break
  fi
  sleep 2
  if [[ $i -eq 30 ]]; then
    warn "Frontend did not respond yet. It may still be starting."
  fi
done

# 6) Show quick status
bold "Services running:"
docker compose ps

cat <<EOF

------------------------------------------------------------
App is ready.

Frontend:  $FRONTEND_URL
Backend:   http://localhost:3001 (health: /api/health)

Typical workflow:
1) Open the frontend and paste a repo URL, click "Analyze Repo"
2) Click "Generate AI Doc" to get the summary + tables
3) (Optional) In the Template panel, click "Load Sample" then "AI Format to Table"
4) Click "Download PDF" to export report + AI section

Troubleshooting:
- Backend logs:   docker compose logs --tail=200 backend
- Frontend logs:  docker compose logs --tail=200 frontend
- Python logs:    docker compose logs --tail=200 python_service
- Restart stack:  docker compose down && docker compose up -d --build
------------------------------------------------------------
EOF
