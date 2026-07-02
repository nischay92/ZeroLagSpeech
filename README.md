# ZeroLag

ZeroLag is an open-source real-time voice intelligence platform that turns speech into transcription, AI reasoning, and structured outputs. This repository is an incrementally built, contributor-friendly modular monolith.

## Repository layout

- `apps/web` — Next.js 15, TypeScript, Tailwind CSS, shadcn/ui conventions, and Zustand
- `apps/api` — FastAPI on Python 3.12
- `packages` — provider SDK, plugin SDK, and shared types (reserved for later phases)
- `plugins` — first-party meeting, education, and medical plugins (reserved for later phases)
- `docs` — project documentation
- `docker` — container-related configuration

## Quick start

Requirements: Node.js 20+, Python 3.12+, and Docker with Compose.

```bash
cp .env.example .env
npm install
npm run dev:web
```

In another terminal:

```bash
cd apps/api
python3.12 -m venv .venv
.venv/bin/pip install -r requirements-dev.txt
.venv/bin/uvicorn app.main:app --reload
```

Or run both applications with Docker:

```bash
docker compose up --build
```

The web app is available at <http://localhost:3000> and the API at <http://localhost:8000>.

## Quality checks

```bash
npm run lint
npm run format:check
cd apps/api && .venv/bin/ruff check . && .venv/bin/ruff format --check .
```

## Current scope

Phase 1 provides runnable frontend and backend foundations. Database, Redis, providers, plugins, APIs, streaming, and product UI are intentionally added in later approved phases.
