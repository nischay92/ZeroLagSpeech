# ZeroLag

ZeroLag is an open-source real-time voice intelligence platform that turns speech into transcription, AI reasoning, and structured outputs. This repository is an incrementally built, contributor-friendly modular monolith.

## Repository layout

- `apps/web` — Next.js 15, TypeScript, Tailwind CSS, shadcn/ui conventions, and Zustand
- `apps/api` — FastAPI on Python 3.12
- `packages` — provider SDK, plugin SDK, and shared types (reserved for later phases)
- `plugins` — first-party meeting, education, and medical plugins (reserved for later phases)
- `docs` — project documentation
- `docker` — container-related configuration

## Collaborator setup

The simplest setup requires Git and Docker Desktop (or Docker Engine with the Compose plugin).

```bash
git clone https://github.com/nischay92/ZeroLagSpeech.git
cd ZeroLagSpeech
cp .env.example .env
docker compose up --build
```

Wait for the API container to report as healthy and the web container to start, then open:

- Web application: <http://localhost:3000>
- API health: <http://localhost:8000/health>
- Interactive API documentation: <http://localhost:8000/docs>

Stop the project with:

```bash
docker compose down
```

Start it again without rebuilding:

```bash
docker compose up
```

Use `docker compose up --build` after dependency or Dockerfile changes.

## Local development

Local development requires Node.js 20+ and Python 3.12+.

Start the web application:

```bash
npm install
npm run dev:web
```

In another terminal, start the API:

```bash
cd apps/api
python3.12 -m venv .venv
.venv/bin/pip install -r requirements-dev.txt
.venv/bin/uvicorn app.main:app --reload
```

## Quality checks

```bash
npm run lint
npm run format:check
npm run build:web

cd apps/api
.venv/bin/ruff check .
.venv/bin/ruff format --check .
.venv/bin/pytest
```

## Contributing workflow

Create a focused branch before making changes:

```bash
git checkout -b feature/short-description
```

Run the relevant quality checks before opening a pull request. Never commit `.env`, `.venv`, `node_modules`, `.next`, or cache files. Update `.env.example` only with safe placeholder values when adding configuration.

## Current scope

Phase 1 provides runnable frontend and backend foundations. Database, Redis, providers, plugins, APIs, streaming, and product UI are intentionally added in later approved phases.
