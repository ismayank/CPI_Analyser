# JSON Change Analyzer (GitHub/GitLab)

A full-stack app to analyze JSON file changes between the last two commits of a Git repository (GitHub/GitLab). It:

- Accepts a repo URL via the frontend.
- Clones the repo and computes JSON diffs between the latest two commits.
- Displays a table of changes with detailed JSON diffs.
- Generates an industry-style change report PDF for download.
- Includes an industry-level change template in `.txt` that can be parsed to structured JSON.
- Fully containerized with Docker and docker-compose.

## Project Structure

```
.git-json-change-app/
  backend/
    src/
      index.js
      utils/
        gitAnalyzer.js
        pdfGenerator.js
      templates/
        industry_change_template.txt
    package.json
    Dockerfile
    .dockerignore
  frontend/
    src/
      App.jsx
      App.css
      main.jsx
    vite.config.js
    nginx.conf
    package.json
    Dockerfile
    .dockerignore
  docker-compose.yml
  README.md
```

## Backend

- Express server on port 3001.
- Endpoints:
  - `GET /api/health` – health check.
  - `GET /api/template` – returns the sample industry change template (.txt).
  - `POST /api/parseTemplate` – body: `{ text: string }` – parses the template text into structured JSON.
  - `POST /api/analyzeRepo` – body: `{ repoUrl: string }` – clones repo, diffs JSON files between last two commits, returns a report JSON.
  - `POST /api/generatePdf` – body: `{ report: object }` – generates a PDF from the report JSON and returns it as a download.

## Frontend

- Vite + React app.
- UI features:
  - Input for Git URL (e.g., `https://github.com/owner/repo.git`).
  - Analyze button to call backend.
  - Displays a table of changed JSON files and detailed diffs.
  - Button to download a PDF report.
  - Section to load, edit, and parse an "industry-level" change template (.txt).
- During local dev, Vite proxies `/api` to `http://localhost:3001` (configured in `frontend/vite.config.js`).

## Run Locally (without Docker)

In one terminal:

```
# Backend
cd backend
npm install
npm start
```

In another terminal:

```
# Frontend
cd frontend
npm install
npm run dev
```

Then open http://localhost:5173. The dev server proxies API calls to the backend.

## Run with Docker

Build and run with docker-compose:

```
# From project root
docker compose build
docker compose up
```

- Frontend: http://localhost:8080
- Backend: http://localhost:3001

The frontend Nginx is configured to proxy `/api/*` requests to the backend container, so the UI works out of the box.

## Notes

- The backend uses shallow clone depth 50; for very new repos with <2 commits, analysis will fail.
- Only `.json` files are considered when diffing.
- For private repos, additional auth setup is required (e.g., SSH keys or tokens). This demo assumes public repos.
- The industry-level template file lives at `backend/src/templates/industry_change_template.txt` and is returned via `GET /api/template`.

## Example Template (industry_change_template.txt)

```
Title: Quarterly Configuration JSON Changes
Description: This document outlines the JSON configuration changes between the previous and current release.

Changes:
- config/app.json: Modified keys app.name, app.features.beta; Added key app.logging.level
- config/db.json: Added key connections.readReplica; Modified key pool.max
- features/flags.json: Removed key featureX; Modified key featureY.threshold
```

This template can be parsed via `POST /api/parseTemplate` to a structured form with `title`, `description`, and a list of `changes`.
# CPI_Analyser
