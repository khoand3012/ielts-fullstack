# IELTS Practice — Frontend

Web frontend for an IELTS practice platform. Users take Reading, Listening, Writing, and Speaking tests, get automated grading (Reading/Listening), AI-graded feedback (Writing, unless the student asks for a teacher) and teacher grading (Speaking), and track progress over time.

The backend lives at `../ielts-backend` (Python + FastAPI, one in-process app — no separate worker, no SSE). This folder is a standalone Next.js app that consumes the backend's REST API.

## Tech stack

- **Framework**: Next.js 15.5 with the App Router (pinned to 15 — 16 renames `middleware.ts` to `proxy.ts`)
- **Language**: TypeScript (strict mode)
- **Styling**: Tailwind CSS v4 + shadcn/ui components (Radix, "nova" preset)
- **Data fetching**: TanStack Query (React Query) for server state; polling for async grading results
- **Forms**: React Hook Form + Zod for validation
- **Auth**: JWT access + refresh tokens, stored in httpOnly cookies. The browser only talks to Next: `app/api/auth/*` sets cookies, `app/api/backend/[...path]` proxies to the backend, `middleware.ts` refreshes the access token before rendering (refresh tokens rotate; Server Components cannot set cookies)
- **Audio capture**: Browser `MediaRecorder` API for the Speaking section (WebM/Opus, uploaded to backend via pre-signed URL)
- **Audio playback**: Native `<audio>` element for Listening sections
- **Async results**: polling against the backend (no SSE)
- **Tests**: Vitest + React Testing Library + MSW (jsdom; `// @vitest-environment node` for route handlers and middleware)

## Project conventions

- **React Server Components by default**; mark `"use client"` only when needed (interactivity, browser APIs, hooks)
- **Routes** live in `app/`; colocated `loading.tsx`, `error.tsx`, and `page.tsx` per route
- **API calls** go through a typed client in `lib/api/` — never `fetch` directly from components
- **Types** generated from the backend's OpenAPI schema via `openapi-typescript` into `types/api.ts` (from the committed snapshot `types/openapi.json`). Test `content` is untyped in OpenAPI; its Zod schemas live in `lib/content/schema.ts`
- **No barrel files** (`index.ts` re-exports) — they slow down builds and IDE
- **Tailwind**: prefer utility classes over custom CSS; extract repeated patterns into shadcn/ui components or `cn()` helpers, not @apply

## Key user flows

1. **Take a test** — start from `/tests` (practice or exam mode), then `/sessions/[sessionId]` — autosaved answers, server-enforced time limits; submissions go to `POST /sessions/{id}/submit`. Re-opening the URL resumes the session
2. **My sessions** — `/sessions` — the student's attempts, newest first
3. **Speaking section** (not built yet) — record per question via `MediaRecorder`, upload via backend-issued pre-signed URLs
4. **Results page** (not built yet) — Reading/Listening grades show immediately; Writing/Speaking show "Processing" state and poll until ready
5. **Progress dashboard** (not built yet) — `/dashboard` — band score trends per skill, weak areas

## What's NOT in scope here

- Server-side scoring logic (lives in backend)
- IELTS content (passages, audio files, questions — served by backend)
- Grading (backend handles it)

## Commands

- `npm run dev` — dev server on http://localhost:3000 (needs the backend on `BACKEND_URL`, see `.env.example`)
- `npm test` — Vitest suite; `npx vitest run <path>` for one file
- `npx tsc --noEmit` — typecheck
- `npm run lint` — ESLint
- `npm run api:snapshot && npm run gen:api` — refresh `types/openapi.json` from `../ielts-backend` (via `uv`, no DB needed) and regenerate `types/api.ts`

## Things to check before implementation

- Verify endpoints against the FastAPI OpenAPI spec at `http://localhost:8000/docs` (or `types/openapi.json`) before wiring up new screens
- Speaking recording: test MediaRecorder mime type fallbacks (Safari uses `audio/mp4`, Chrome/Firefox use `audio/webm`)
- Time limits are enforced server-side — do not trust client timers for submission gating
- Fonts: `next/font` variable classes go on `<html>` (shadcn applies `font-sans` there); `globals.css` maps `--font-sans` to `--font-geist-sans`
- The backend's email validator rejects reserved domains (`.test`, `.example`, …) — use a normal-looking domain for test accounts
- In the desktop app's preview pane, a hidden pane never fires `requestAnimationFrame`, so streamed Suspense content (pages with `loading.tsx`) stays hidden; check with curl or bring the pane forward
