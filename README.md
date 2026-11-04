# IELTS Practice

A web platform for practising the IELTS exam. Students take Reading, Listening, Writing and Speaking tests:

- **Reading and Listening** are marked automatically, with a raw mark and an IELTS band.
- **Writing** gets AI feedback (per-criterion bands and comments), or a teacher's grade on request.
- **Speaking** is graded by a teacher.
- Free and paid plans set daily limits on Writing and Speaking tests. Reading and Listening are unlimited.

This repository is a monorepo with two independently run projects:

| Folder | What it is | Stack |
|---|---|---|
| [`ielts-backend/`](ielts-backend/README.md) | REST API: auth, tests, sessions, grading | Python 3.11, FastAPI, SQLAlchemy 2 (async), Alembic, PostgreSQL, `uv` |
| [`ielts-frontend/`](ielts-frontend/README.md) | Student and teacher web UI | Next.js 15 (App Router), TypeScript, Tailwind v4, shadcn/ui, TanStack Query |

The browser only talks to the Next.js app. Next.js proxies API calls to the backend and keeps the JWTs in httpOnly cookies.

```
Browser ──▶ Next.js (ielts-frontend) ──▶ FastAPI (ielts-backend) ──▶ PostgreSQL
                                                │
                                                ├──▶ Cloudflare R2 / MinIO (audio, test assets)
                                                └──▶ OpenRouter (AI grading of Writing)
```

## Quick start

You need [uv](https://docs.astral.sh/uv/), Node.js 20+ and Docker.

**1. Backend** (from `ielts-backend/`)

```bash
uv sync
cp .env.example .env          # then set JWT_SECRET to a long random value
docker compose up -d          # Postgres + MinIO
uv run alembic upgrade head
uv run uvicorn api.main:app --reload --port 8000
```

API docs are at http://localhost:8000/docs.

**2. Frontend** (from `ielts-frontend/`)

```bash
npm install
cp .env.example .env.local    # BACKEND_URL defaults to http://localhost:8000
npm run dev
```

Open http://localhost:3000 and register an account. To load a test, run `uv run python -m core.cli load-test seed/tests/<file>.json --publish` from `ielts-backend/`. To make yourself an admin, run `uv run python -m core.cli set-role <email> admin`.

AI grading needs a real `OPENROUTER_API_KEY` in `ielts-backend/.env`. Without one, everything except Writing grading still works.

## Common commands

| Where | Command | Purpose |
|---|---|---|
| `ielts-backend/` | `uv run pytest` | Tests (needs Docker, runs against a real Postgres) |
| `ielts-backend/` | `uv run ruff check . && uv run ruff format --check . && uv run mypy . && uv run pyright` | Lint, format, types |
| `ielts-frontend/` | `npm test` | Vitest suite |
| `ielts-frontend/` | `npm run lint` and `npx tsc --noEmit` | Lint and typecheck |

## Keeping the two sides in sync

The backend's OpenAPI schema is the source of truth for the API. After any backend endpoint or schema change, run this from `ielts-frontend/`:

```bash
npm run api:snapshot && npm run gen:api
```

That updates `types/openapi.json` and `types/api.ts`. Test `content` is not typed in OpenAPI, so its Zod schemas in `ielts-frontend/lib/content/schema.ts` must be updated by hand when the backend's content shape changes.

## CI

GitHub Actions runs from the root `.github/workflows/`:

- `backend.yml` runs ruff, mypy and pytest on changes under `ielts-backend/`.
- `frontend.yml` runs lint, typecheck and tests on changes under `ielts-frontend/`.

Each workflow only runs when its own folder changes.

## Deployment

- **Backend:** Fly.io, one image and one always-on machine, with Neon Postgres (pooled endpoint) and Cloudflare in front. Migrations run as a release command, never on boot.
- **Frontend:** deploy `ielts-frontend/` as the project root and set `BACKEND_URL`.

Details are in the [backend README](ielts-backend/README.md#deployment).

## Documentation

- [`ielts-backend/README.md`](ielts-backend/README.md): configuration, API endpoints, CLI, testing
- [`ielts-frontend/README.md`](ielts-frontend/README.md): auth flow, test-taking flow, project layout
- `ielts-backend/docs/superpowers/`: design specs and plans
- `ielts-frontend/docs/superpowers/plans/`: frontend plans
- [`CLAUDE.md`](CLAUDE.md): conventions and agent workflow for working in this repo with Claude Code

## Contributing

Commit from the repo root and prefix commits by project, for example `feat(backend): …` or `fix(frontend): …`. Never commit `.env` or `.env.local`. Use the `.env.example` files for variable names. A change that crosses the API boundary (for example a backend schema change plus the regenerated frontend types) should go in the same pull request.
