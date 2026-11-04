# IELTS Practice — Workspace

This is a **monorepo** (`khoand3012/ielts-fullstack`) holding the two projects that together make one product. Launch Claude Code from here to work on both at once.

| Folder | Stack | Role |
|---|---|---|
| `ielts-backend/` | Python 3.11, FastAPI, SQLAlchemy 2 async, Alembic, Postgres, `uv` | REST API, grading, sessions, auth |
| `ielts-frontend/` | Next.js 15 App Router, TypeScript strict, Tailwind v4, shadcn/ui, TanStack Query | Student/teacher web UI; proxies to the backend |

**One git repo at this root.** Do not run `git init` in the subfolders. Commit from the root; scope commits to one project where you can (conventional prefix, e.g. `feat(backend): …`, `fix(frontend): …`). A change that crosses the API seam (backend schema + regenerated `types/`) should land in the same commit or PR.

**CI** lives in the root `.github/workflows/`: `backend.yml` and `frontend.yml`, each triggered only by changes under its own folder (path filters) and run with that folder as the working directory. GitHub ignores any `.github/` inside a subfolder, so never add workflows there. Deploy configs must set the project root (frontend → `ielts-frontend`, backend → `ielts-backend`).

## Read first

Each project has its own detailed `CLAUDE.md`. Read the one for any project you touch before editing:

- `ielts-backend/CLAUDE.md` — architecture, domain model, conventions, commands
- `ielts-frontend/CLAUDE.md` — stack, conventions, user flows, commands
- `ielts-backend/docs/superpowers/{specs,plans,logs}/` — design specs and plans (source of truth for backend behaviour)
- `ielts-frontend/docs/superpowers/plans/` and `ielts-frontend/2026-10-24-frontend-handoff.md` — frontend plans and handoff

## The contract between the two projects

The **backend OpenAPI schema is the single source of truth** for the API.

- Backend change → frontend must refresh types: from `ielts-frontend`, run `npm run api:snapshot && npm run gen:api` (updates `types/openapi.json` and `types/api.ts`).
- Test `content` is untyped in OpenAPI; its Zod schemas live in `ielts-frontend/lib/content/schema.ts` and must be kept in sync with the backend's content JSON shape (`ielts-backend/core/schemas/`, `seed/tests/`).
- The browser never talks to the backend directly: it goes through Next (`app/api/backend/[...path]` proxy, `app/api/auth/*`, `middleware.ts`).
- Errors: backend raises typed `AppError`s mapped to HTTP; the frontend maps them in `ielts-frontend/lib/api/errors.ts`. Change both together.
- Time limits, roles, quotas and grading are **server-enforced**. The frontend only reflects them.

## Commands (run from the project folder)

Backend (`ielts-backend/`): `uv sync` · `docker compose up -d` · `uv run uvicorn api.main:app --reload` · `uv run alembic upgrade head` · `uv run pytest` (Docker required) · `uv run ruff check . && uv run ruff format --check . && uv run mypy .`

Frontend (`ielts-frontend/`): `npm run dev` (needs backend at `BACKEND_URL`) · `npm test` · `npx tsc --noEmit` · `npm run lint`

## Agent team

Subagents live in `.claude/agents/`:

| Agent | Scope | Edits |
|---|---|---|
| `backend-engineer` | `ielts-backend/` | backend only |
| `frontend-engineer` | `ielts-frontend/` | frontend only |
| `contract-integrator` | the API seam between both | `types/*`, `lib/api/*`, `lib/content/schema.ts`, backend schemas when asked |
| `qa-reviewer` | both, read-mostly | nothing (reports findings) |

Agent teams are enabled in `.claude/settings.json` (experimental flag). For a cross-cutting feature, the lead should:

1. Have `backend-engineer` define/change the endpoint and tests first.
2. Have `contract-integrator` refresh the OpenAPI snapshot and types.
3. Have `frontend-engineer` build the UI against the new types.
4. Have `qa-reviewer` check both sides and the seam.

Backend and frontend work on disjoint folders, so they can run in parallel once the endpoint shape is agreed.

## Rules for every agent

- Stay inside your assigned folder unless your role says otherwise; ask the lead before editing the other project.
- Follow the target project's own conventions (backend: async everywhere, thin routers, typed exceptions, UUIDv7, no `print`; frontend: RSC by default, API via `lib/api/`, no barrel files).
- Never read, print, or commit `.env`, `.env.local`, or secrets. Use `.env.example` for variable names.
- Run the project's tests/lint/typecheck before reporting done, and report real output.
- Don't touch `.git`, `.next`, `.venv`, caches, or `node_modules`.
