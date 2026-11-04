# Milestone 1 — Auth, Test List, Reading Session, My Sessions — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A student can register or sign in, browse published tests, start a Reading test in practice or exam mode, answer with autosave, see a server-corrected countdown, submit (or be auto-submitted on timeout), resume after closing the tab, and see their attempts.

**Architecture:** Next.js 15 App Router. The browser only talks to Next: route handlers set httpOnly JWT cookies and a catch-all route handler proxies `/api/backend/*` to FastAPI with a Bearer header. Middleware refreshes the access token *before* rendering, because Server Components cannot set cookies and refresh tokens rotate. Server Components call the backend directly (server-to-server) with the cookie's token; client components use TanStack Query through the proxy. A framework-agnostic `SaveQueue` owns autosave (debounce, single in-flight request, coalescing, retry, flush-before-submit).

**Tech Stack:** Next.js 15.5 · TypeScript strict · Tailwind CSS v4 + shadcn/ui · TanStack Query v5 · React Hook Form + Zod · openapi-typescript + openapi-fetch · Vitest + React Testing Library + MSW (jsdom; `node` env for route handlers and middleware).

**Spec:** `2026-10-24-frontend-handoff.md` (repo root) — §1–9. Backend design: `../ielts-backend/docs/superpowers/specs/2026-10-24-tests-and-sessions-design.md`. Backend branch `feat/tests-and-sessions`.

**Out of scope (follow-up plans):** Writing (essay editor, word count, chart, manual-grading toggle, daily-limit 429 screen + pre-start warning), Listening (audio, once-per-part playback in exam mode), Speaking, results, dashboard, admin. See "Follow-up plans" at the end.

## Global Constraints

- Next.js **15.5.x** (`create-next-app@15.5.28`), not 16 — CLAUDE.md pins 15; 16 renames middleware to `proxy` and would invalidate this plan. In 15, `cookies()`, `headers()`, `params` and `searchParams` are async (`await` them).
- No barrel files (`index.ts` re-exports). RSC by default; `"use client"` only where needed.
- Components never call `fetch` directly; all backend calls go through `lib/api/`.
- Generated types live in `types/api.ts` (from the committed snapshot `types/openapi.json`); never hand-edit.
- Backend URL comes from `BACKEND_URL` (default `http://localhost:8000`), server-side only. The browser never calls the backend (no CORS on the backend).
- Cookies: `ielts_access` (maxAge 900 s), `ielts_refresh` (maxAge 2 592 000 s); both `httpOnly`, `sameSite: "lax"`, `path: "/"`, `secure` when `NODE_ENV === "production"`.
- Refresh tokens **rotate on use**; the old one dies. Never refresh from a Server Component.
- Error body shapes to handle: `{"error": {"code","message","extra"}}` and FastAPI's `{"detail": [...]}`.
- Answer keys: an item's key is `numbers[0]`; saved `answers` keys arrive as strings (`"21"`).
- `value`: `multiple_choice` → `string[]` of 1..`numbers.length` distinct keys; `matching` → one key `string`; `fill_blank`/`short_answer` → `string` ≤ 200 chars; clear → `null`.
- Autosave: debounce text 500 ms; choices immediately; retry on 5xx/network only; never retry 4xx.
- Exam timer is display-only: never disable inputs or block submit from the client clock. `offset = Date.parse(server_time) − receivedAt`.
- Playable skills in this milestone: **reading** only. Writing/Listening/Speaking show "Coming soon".
- Route handlers, `proxyToBackend` and middleware read `req.cookies` and write `res.cookies` — never `next/headers` (so tests can call them directly). The proxy buffers the body with `await req.arrayBuffer()`; no streaming.
- `lib/env.ts` must not import `server-only` (middleware runs on the Edge runtime and imports it via `refresh.ts`); `server-only` is used only in `lib/api/server.ts`.
- Browser-side clients (`lib/api/browser.ts`, `lib/api/auth.ts`) use absolute bases: `` `${window.location.origin}/api/…` `` (empty origin on the server). Node's `fetch` rejects relative URLs, which would surface as a fake "network" error.
- Matching questions use a styled native `<select>` (not Radix Select): no jsdom stubs, and "Clear" can be `value=""`.
- Fake timers in tests: `vi.useFakeTimers({ shouldAdvanceTime: true })` and `userEvent.setup({ advanceTimers: vi.advanceTimersByTime })` — plain fake timers hang RTL's `findBy`/`waitFor`.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Test command: `npx vitest run <path>`; full suite `npm test`; types `npx tsc --noEmit`; lint `npm run lint`.

## Review Focus

1. **Submit within 500 ms of typing** — the debounced text must be saved before `POST /submit`. Pinned in Task 7 (`flush sends a pending debounced value immediately`) and Task 11 (`submit flushes pending text first`).
2. **Out-of-order save responses** — an older PUT landing after a newer edit must not overwrite it. Pinned in Task 7 (`one request in flight; edits during flight are coalesced into the next`) and Task 11 (`server echo does not clobber a field edited during the request`).
3. **Late save in exam mode** — 409 `session_closed` → refetch → "Time's up — submitted" when `submit_reason: "timeout"`; no retries on 4xx. Pinned in Task 7 and Task 11.
4. **Client clock skew** — countdown uses `server_time`, and inputs stay enabled at 00:00. Pinned in Task 9 and Task 11.
5. **Refresh-token rotation race** — two concurrent requests with the same refresh token must share one refresh call. Pinned in Task 3.

---

### Task 1: Scaffold, tooling, CLAUDE.md fixes

**Files:**
- Create: Next.js scaffold at repo root (`app/`, `public/`, `package.json`, `tsconfig.json`, `next.config.ts`, `eslint.config.mjs`, `postcss.config.mjs`)
- Create: `vitest.config.mts`, `tests/setup.ts`, `tests/empty-module.ts`, `tests/msw/server.ts`, `tests/smoke.test.tsx`, `scripts/snapshot-openapi.mjs`, `.env.example`, `.env.local` (gitignored)
- Create: `app/providers.tsx`
- Modify: `CLAUDE.md`, `app/layout.tsx`, `app/page.tsx`

**Interfaces:**
- Produces: `npm test` (vitest run), `npm run gen:api`, `npm run api:snapshot`; `tests/msw/server.ts` exports `server` (MSW `setupServer()` with no default handlers); `app/providers.tsx` exports `Providers({children})` wrapping a `QueryClientProvider` (`retry: false` for mutations, `staleTime: 0`).

- [ ] **Step 1: Scaffold around the existing files.** `create-next-app` refuses a non-empty folder. Move `CLAUDE.md` and `2026-10-24-frontend-handoff.md` (and `docs/`) to the scratchpad, run
  `npx create-next-app@15.5.28 . --ts --tailwind --eslint --app --no-src-dir --import-alias "@/*" --use-npm --turbopack --yes`, then move them back. Confirm `git status` shows a repo (create-next-app runs `git init`; if not, run it).
- [ ] **Step 2: Install deps.** `npm i @tanstack/react-query react-hook-form zod @hookform/resolvers openapi-fetch server-only` and `npm i -D openapi-typescript vitest @vitejs/plugin-react jsdom @testing-library/react @testing-library/user-event @testing-library/jest-dom msw vite-tsconfig-paths`.
- [ ] **Step 3: shadcn.** `npx shadcn@latest init` (defaults, neutral), then `npx shadcn@latest add button card dialog radio-group input label select tabs badge table alert sonner`.
- [ ] **Step 4: Vitest config.** `vitest.config.mts`: plugins `react()`, `tsconfigPaths()`; `environment: "jsdom"`, `environmentOptions: { jsdom: { url: "http://localhost:3000" } }`, `setupFiles: ["tests/setup.ts"]`, `include: ["**/*.test.{ts,tsx}"]`, exclude `node_modules`, `.next`; `resolve.alias: { "server-only": "<abs path>/tests/empty-module.ts" }` (its real entry throws outside RSC). `tests/setup.ts`: import `@testing-library/jest-dom/vitest`; `server.listen({ onUnhandledRequest: "error" })` / `resetHandlers` / `close`; `afterEach(() => vi.useRealTimers())`. MSW handlers match `*/api/backend/...` and `http://localhost:8000/...`. Scripts: `"test": "vitest run"`, `"test:watch": "vitest"`, `"gen:api": "openapi-typescript types/openapi.json -o types/api.ts"`, `"api:snapshot": "node scripts/snapshot-openapi.mjs"` — the script runs `uv run --directory ../ielts-backend python -c "import json;from api.main import app;print(json.dumps(app.openapi(),indent=1))"` via `execFileSync` and writes `types/openapi.json` (npm scripts run in `cmd.exe` here, so no shell quoting or redirects).
- [ ] **Step 5: Write the smoke test** `tests/smoke.test.tsx`: render `<Providers><p>ok</p></Providers>`, expect `getByText("ok")`.
- [ ] **Step 6: Run** `npm test` → PASS; `npx tsc --noEmit` and `npm run lint` → clean.
- [ ] **Step 7: Wire providers.** `app/layout.tsx` wraps children in `<Providers>` and `<Toaster />`; title "IELTS Practice". `app/page.tsx` → `redirect("/tests")`. `.env.example`: `BACKEND_URL=http://localhost:8000`.
- [ ] **Step 8: Fix CLAUDE.md** (handoff §7): backend is `../ielts-backend`; Speaking is teacher-graded; no SSE and no worker — results are polled, the backend is one in-process app; take-a-test route is `/sessions/[sessionId]` (started from the `/tests` list); add a **Commands** section (`npm run dev`, `npm test`, `npx tsc --noEmit`, `npm run lint`, `npm run api:snapshot && npm run gen:api`); add "Next.js 15.5 (pinned; not 16)".
- [ ] **Step 9: Commit** on `main` as the initial commit (`chore: scaffold Next.js 15 app with tooling`), then `git switch -c feat/m1-reading`. Every later task commits to this branch.

---

### Task 2: API types, error normalizer, typed clients

**Files:**
- Create: `types/openapi.json` (snapshot), `types/api.ts` (generated)
- Create: `lib/env.ts`, `lib/api/errors.ts`, `lib/api/unwrap.ts`, `lib/api/browser.ts`, `lib/api/server.ts`
- Test: `lib/api/errors.test.ts`, `lib/api/unwrap.test.ts`

**Interfaces:**
- Produces:
  - `lib/env.ts` (no `server-only`; Edge-safe): `export const BACKEND_URL: string`
  - `class ApiError extends Error { status: number; code: string; extra: Record<string, unknown> }`
  - `toApiError(status: number, body: unknown): ApiError`
  - `unwrap<T>(p: Promise<{ data?: T; error?: unknown; response: Response }>): Promise<T>` — throws `ApiError`; a thrown `TypeError` (network) becomes `ApiError(0, "network")`.
  - `lib/api/browser.ts`: `export const api = createClient<paths>({ baseUrl: "/api/backend" })`
  - `lib/api/server.ts` (`server-only`): `getServerApi(): Promise<Client<paths>>` — reads `ielts_access` via `await cookies()`, sets `Authorization: Bearer …`, `baseUrl: BACKEND_URL`, `cache: "no-store"`.
  - Type aliases in `lib/api/types.ts`: `SessionRead`, `SessionDetail`, `TestSummary`, `Skill`, `SessionMode`, `AnswerInput`, `UserRead` = `components["schemas"][...]`.

- [ ] **Step 1: Snapshot + generate.** `npm run api:snapshot` (needs `uv`; no DB required) then `npm run gen:api`. Check `types/api.ts` contains `"/sessions/{session_id}/answers"` and `SessionDetail`.
- [ ] **Step 2: Write failing tests** `lib/api/errors.test.ts`:
```ts
expect(toApiError(429, { error: { code: "quota_exceeded", message: "m", extra: { resets_at: "2026-10-25T00:00:00Z" } } }))
  .toMatchObject({ status: 429, code: "quota_exceeded", extra: { resets_at: "2026-10-25T00:00:00Z" } });
expect(toApiError(422, { detail: [{ loc: ["body", "mode"], msg: "Input should be 'practice' or 'exam'", type: "enum" }] }))
  .toMatchObject({ status: 422, code: "validation_error", message: "Input should be 'practice' or 'exam'" });
expect(toApiError(502, "<html>")).toMatchObject({ status: 502, code: "http_error" });
expect(toApiError(409, { error: { code: "session_closed", message: "x" } }).extra).toEqual({});
```
  `lib/api/unwrap.test.ts`: resolves `data`; throws `ApiError` with status from `response.status` when `error` set; a rejected promise with `TypeError("fetch failed")` → `{ status: 0, code: "network" }`; **`api.GET("/tests")` from `lib/api/browser.ts` hits an MSW handler on `*/api/backend/tests` and resolves** (proves the absolute base works in jsdom).
- [ ] **Step 3: Run** `npx vitest run lib/api` → FAIL (modules missing).
- [ ] **Step 4: Implement** the files above.
- [ ] **Step 5: Run** `npx vitest run lib/api` → PASS; `npx tsc --noEmit` clean.
- [ ] **Step 6: Commit** `feat: typed API client and error normalizer`.

---

### Task 3: Auth primitives — cookies, JWT expiry, single-flight refresh

**Files:**
- Create: `lib/auth/cookies.ts`, `lib/auth/jwt.ts`, `lib/auth/refresh.ts`
- Test: `lib/auth/jwt.test.ts`, `lib/auth/refresh.test.ts` (`// @vitest-environment node`)

**Interfaces:**
- Produces:
  - `ACCESS_COOKIE = "ielts_access"`, `REFRESH_COOKIE = "ielts_refresh"`, `setAuthCookies(jar: ResponseCookies, pair: TokenPair): void`, `clearAuthCookies(jar: ResponseCookies): void` (`ResponseCookies` from `next/dist/compiled/@edge-runtime/cookies`, i.e. `NextResponse#cookies`).
  - `tokenExpiresAt(token: string): number | null` (ms epoch, decoded without verification) and `isExpiringSoon(token: string | undefined, now = Date.now(), skewMs = 30_000): boolean` — missing/malformed → `true`.
  - `type TokenPair = { access_token: string; refresh_token: string }`
  - `refreshTokens(refreshToken: string, fetchImpl: typeof fetch = fetch): Promise<TokenPair | null>` — POSTs `${BACKEND_URL}/auth/refresh`; non-2xx → `null`. Single-flight: concurrent calls with the same token share one promise; the settled result stays cached for **10 s** so a request that still carries the old (now dead) token gets the new pair. `__resetRefreshCache()` for tests. Must run on the Edge runtime (no Node APIs; use `atob`).

- [ ] **Step 1: Write failing tests.** `jwt.test.ts`: a token with `exp = 1000` → `tokenExpiresAt` = `1_000_000`; `isExpiringSoon(tok, 1_000_000 - 31_000)` false, `(…- 29_000)` true; `"garbage"` → true; `undefined` → true.
  `refresh.test.ts` (mock `fetchImpl` with `vi.fn` resolving `{ access_token: "a2", refresh_token: "r2" }` after a tick):
  - `two concurrent calls with the same token make one request` — `Promise.all([refreshTokens("r1", f), refreshTokens("r1", f)])` → both equal the pair; `f` called once.
  - `a call within 10 s after settling reuses the result` — fake timers, advance 9 s → still one call; advance to 11 s → a new call.
  - `401 from backend returns null`.
  - `different tokens refresh independently`.
- [ ] **Step 2: Run** `npx vitest run lib/auth` → FAIL.
- [ ] **Step 3: Implement** the three files.
- [ ] **Step 4: Run** `npx vitest run lib/auth` → PASS.
- [ ] **Step 5: Commit** `feat: auth cookies, JWT expiry check, single-flight refresh`.

---

### Task 4: Auth route handlers, backend proxy, middleware

**Files:**
- Create: `app/api/auth/login/route.ts`, `app/api/auth/register/route.ts`, `app/api/auth/logout/route.ts`
- Create: `lib/auth/proxy.ts`, `app/api/backend/[...path]/route.ts`, `middleware.ts`
- Test: `app/api/auth/auth-routes.test.ts`, `lib/auth/proxy.test.ts`, `middleware.test.ts` (all `// @vitest-environment node`, MSW on `http://localhost:8000`)

**Interfaces:**
- Consumes: Task 3 exports; `toApiError` shape for pass-through.
- Produces:
  - `POST /api/auth/login` `{email, password}` → 204 + both cookies; backend error → same status and body.
  - `POST /api/auth/register` `{email, password}` → backend register, then login → 204 + cookies.
  - `POST /api/auth/logout` → backend `auth_logout` with the refresh cookie (ignore its failure) → 204, cookies cleared.
  - `proxyToBackend(req: NextRequest, path: string[]): Promise<NextResponse>` — forwards method, query string, body and `content-type` to `${BACKEND_URL}/${path.join("/")}` with `Authorization: Bearer <ielts_access>`; returns backend status, body, content-type. On 401 with a refresh cookie: `refreshTokens` → retry once with the new access token and set both cookies on the response; refresh `null` → 401 and clear cookies. The route file exports `GET, POST, PUT, PATCH, DELETE` delegating to it (`params` is a Promise in Next 15).
  - `middleware(req)` with matcher `["/((?!_next|api/auth|favicon.ico|.*\\..*).*)"]`. Public pages: `/login`, `/register` (signed-in users with a refresh cookie are redirected to `/tests`). Protected: everything else, including `/api/backend/*`.
    - No refresh cookie → pages: redirect `/login?next=<path+search>`; `/api/backend/*`: 401 `{"error":{"code":"unauthorized","message":"Not signed in"}}`.
    - `isExpiringSoon(access)` → `refreshTokens`. Success → `NextResponse.next({ request: { headers } })` with the updated `cookie` request header (so RSCs and the proxy see the new token) **and** `setAuthCookies` on the response. Failure → as "no refresh cookie", plus `clearAuthCookies`.

- [ ] **Step 1: Write failing tests.**
  `auth-routes.test.ts`: login success sets `ielts_access` (httpOnly, Max-Age=900) and `ielts_refresh` (Max-Age=2592000); login 401 from backend passes status and body through and sets no cookies; register posts register then login; logout clears both cookies (Max-Age=0) even when backend logout returns 500.
  `proxy.test.ts`: forwards `PUT /sessions/abc/answers?x=1` with body and Bearer header; passes 409 body through untouched; on 401 refreshes once, retries, returns 200 and `Set-Cookie` for both tokens; refresh failure → 401 and cleared cookies; backend sees exactly two requests (no loop) when the retry also returns 401.
  `middleware.test.ts`: `/tests` with no cookies → 307 to `/login?next=%2Ftests`; `/api/backend/tests` with no cookies → 401 JSON; expiring access + valid refresh → response sets both cookies and the forwarded request `cookie` header contains the new access token (`x-middleware-request-cookie` / overridden headers); `/login` with a refresh cookie → redirect `/tests`; fresh access token → passes through with no backend call.
- [ ] **Step 2: Run** `npx vitest run app/api lib/auth/proxy.test.ts middleware.test.ts` → FAIL.
- [ ] **Step 3: Implement** the handlers, `proxyToBackend`, the catch-all route, and `middleware.ts`.
- [ ] **Step 4: Run** the same command → PASS; `npx tsc --noEmit` clean.
- [ ] **Step 5: Commit** `feat: auth route handlers, backend proxy with refresh, middleware`.

---

### Task 5: Auth UI and app shell

**Files:**
- Create: `lib/auth/safe-next.ts`, `components/auth/login-form.tsx`, `components/auth/register-form.tsx`, `components/auth/logout-button.tsx`, `components/app-header.tsx`
- Create: `app/(auth)/login/page.tsx`, `app/(auth)/register/page.tsx`, `app/(auth)/layout.tsx`
- Create: `app/(app)/layout.tsx`, `app/(app)/error.tsx`, `app/(app)/loading.tsx`
- Test: `lib/auth/safe-next.test.ts`, `components/auth/login-form.test.tsx`, `components/auth/register-form.test.tsx`

**Interfaces:**
- Consumes: `/api/auth/*` (Task 4), `getServerApi` (Task 2).
- Produces: `safeNext(next: string | null | undefined): string` — returns `next` only if it starts with `/` and not `//` or `/\`, else `"/tests"`. `(app)/layout.tsx` fetches `auth_me`; on `ApiError` 401 → `redirect("/login")`; renders `<AppHeader email>` with nav links **Tests** (`/tests`), **My sessions** (`/sessions`) and the logout button.
- Form auth calls go through a tiny `lib/api/auth.ts`: `login(body)`, `register(body)`, `logout()` — POST to `/api/auth/*`, throw `ApiError` via `toApiError` on non-2xx.

- [ ] **Step 1: Write failing tests.** `safe-next.test.ts`: `"/sessions/1"` kept; `"//evil.com"`, `"https://evil.com"`, `"/\\evil.com"`, `null` → `"/tests"`.
  `login-form.test.tsx` (MSW on `/api/auth/login`): invalid email shows "Enter a valid email"; 401 shows "Incorrect email or password"; success calls `router.replace(safeNext(next))` (mock `next/navigation`) and `router.refresh()`.
  `register-form.test.tsx`: password of 7 chars shows "At least 8 characters"; 129 chars shows "At most 128 characters"; 409/422 from backend shows its `message`; success redirects to `/tests`.
- [ ] **Step 2: Run** `npx vitest run lib/auth/safe-next.test.ts components/auth` → FAIL.
- [ ] **Step 3: Implement** forms with React Hook Form + `zodResolver` (`email: z.string().email()`, register `password: z.string().min(8).max(128)`), pages, layouts, header, logout button (`logout()` then `router.replace("/login")` + `router.refresh()`).
- [ ] **Step 4: Run** → PASS; `npx tsc --noEmit` clean.
- [ ] **Step 5: Commit** `feat: login, register, logout and app shell`.

---

### Task 6: Content schemas and answer-value helpers

**Files:**
- Create: `tests/fixtures/content/reading.json`, `listening.json`, `writing.json` — the `content` object of each `../ielts-backend/seed/tests/practice-01-*.json` (no `answer_key`)
- Create: `lib/content/schema.ts`, `lib/content/gaps.ts`, `lib/content/items.ts`, `lib/answers/value.ts`
- Test: `lib/content/schema.test.ts`, `lib/content/gaps.test.ts`, `lib/content/items.test.ts`, `lib/answers/value.test.ts`

**Interfaces:**
- Produces:
  - `schema.ts` (Zod, unknown keys stripped): `Option {key: string; text: string}`; `QuestionItem {numbers: number[] (min 1); prompt: string | null; options?: Option[]}`; `QuestionGroup {type: "multiple_choice" | "fill_blank" | "matching" | "short_answer"; variant?: "true_false_not_given" | "yes_no_not_given" | "headings" | "sentence_endings"; instructions: string; title?: string; context?: string; word_limit?: string; options?: Option[]; questions: QuestionItem[]}`; `ReadingContent {passages: {number; title; paragraphs: {label: string | null; text: string}[]; question_groups}[]}`; `ListeningContent {parts: {number; title; audio: string | null; question_groups}[]}`; `WritingContent {tasks: {number; prompt; min_words; image: string | null}[]}`. Unknown `variant` strings must still parse (`z.string()` fallback) — it is only a hint.
  - `parseContent(skill: Skill, content: unknown)` → `{skill: "reading"; content: ReadingContent} | {skill: "listening"; …} | {skill: "writing"; …}`; throws `ContentError` for speaking or invalid shape.
  - `type GapToken = { kind: "text"; text: string } | { kind: "gap"; number: number }`; `parseGapContext(context: string): GapToken[]` (splits on `/\{(\d+)\}/`).
  - `itemKey(item): number` = `numbers[0]`; `itemLabel(item): string` → `"21"` or `"21–22"` (en dash, first–last); `itemMaxChoices(item): number` = `numbers.length`; `flattenItems(groups: QuestionGroup[]): { key: number; label: string }[]` in document order; `readingItems(content: ReadingContent)` = flatten across passages.
  - `type AnswerValue = string | string[] | null`; `toggleChoice(current: string[], key: string, max: number): string[]`; `isAnswered(v: AnswerValue | undefined): boolean`; `normalizeSaved(raw: Record<string, unknown>): Record<number, AnswerValue>`.

- [ ] **Step 1: Create fixtures** with a one-off node command reading each seed file and writing `JSON.stringify(seed.content, null, 1)`.
- [ ] **Step 2: Write failing tests.**
  `schema.test.ts`: each fixture parses via `parseContent`; reading has 3 passages and `readingItems` ends with key 40; `parseContent("speaking", {})` throws; `{passages: [{}]}` throws `ContentError`.
  `gaps.test.ts`: `"find {8} in them, and {9}."` → `[text "find ", gap 8, text " in them, and ", gap 9, text "."]`; context starting with `{1}` yields no empty text token.
  `items.test.ts`: `itemLabel({numbers:[21,22]})` = `"21–22"`; `itemKey` = 21; `flattenItems` on the listening fixture contains key 21 once and no key 22.
  `value.test.ts`: `toggleChoice([], "B", 1)` = `["B"]`; `toggleChoice(["B"], "C", 1)` = `["C"]` (single choice replaces); `toggleChoice(["B"], "B", 2)` = `[]`; `toggleChoice(["B","D"], "E", 2)` = `["B","D"]` (at cap: ignored); `isAnswered` false for `null`, `[]`, `""`, `"   "`, `undefined`; `normalizeSaved({"21": ["B","D"], "8": "moss"})` = `{21: ["B","D"], 8: "moss"}`.
- [ ] **Step 3: Run** `npx vitest run lib/content lib/answers/value.test.ts` → FAIL.
- [ ] **Step 4: Implement.**
- [ ] **Step 5: Run** → PASS.
- [ ] **Step 6: Commit** `feat: content schemas, gap parser, answer helpers`.

---

### Task 7: SaveQueue (autosave engine)

**Files:**
- Create: `lib/answers/save-queue.ts`
- Test: `lib/answers/save-queue.test.ts` (fake timers)

**Interfaces:**
- Consumes: `AnswerValue` (Task 6), `ApiError` (Task 2).
- Produces:
```ts
type SaveStatus = "saved" | "pending" | "saving" | "retrying" | "closed" | "failed";
interface SaveQueueOptions {
  send(answers: { question: number; value: AnswerValue }[]): Promise<Record<string, unknown>>; // returns AnswersResponse.answers
  onSaved(saved: Record<number, AnswerValue>): void;
  onStatus(status: SaveStatus): void;
  onClosed(): void;                                   // 409 session_closed
  onRejected(question: number, message: string): void; // 422 with extra.question
  onFatal(error: ApiError): void;                     // other 4xx (401/403/404)
  debounceMs?: number;                                // default 500
}
class SaveQueue {
  constructor(opts: SaveQueueOptions);
  set(question: number, value: AnswerValue, opts: { debounce: boolean }): void;
  flush(): Promise<boolean>;       // cancels the debounce and any retry wait, makes ONE immediate attempt with everything pending (awaiting an in-flight request first); resolves true if nothing is left unsaved, false otherwise (offline, closed, failed) — never hangs
  hasPending(question: number): boolean; // pending or in flight
  dispose(): void;
}
```
  Rules: at most **one** request in flight; edits arriving meanwhile accumulate (last value per question wins) and go in the next request. A non-debounced `set` sends at once unless a request is in flight. 5xx and `status 0` → keep the batch (merged under newer edits), status `retrying`, retry after 1 s, 2 s, 4 s, 8 s, then every 15 s. 409 `session_closed` → status `closed`, drop everything, `onClosed()`, ignore later `set`. 422 with `extra.question` → `onRejected`, drop that question, resend the rest immediately. 422 without it, or other 4xx → status `failed`, `onFatal`.

- [ ] **Step 1: Write failing tests.**
  - `debounced text is sent once after 500 ms with the last value` — three `set(8, …, {debounce:true})` within 400 ms → one `send([{question: 8, value: "moss"}])` at 500 ms.
  - `choice changes are sent immediately`.
  - `flush sends a pending debounced value immediately` — `set` debounced then `await flush()` before 500 ms → sent; `flush` resolves `true` after `send` resolves.
  - `flush while offline resolves false instead of hanging` — `send` rejects `ApiError(0, "network")` → `flush()` resolves `false` after one attempt; the value is still pending and retried later.
  - `one request in flight; edits during flight are coalesced into the next` — first `send` held open; two more `set`s → `send` called once until the first resolves, then once with both items.
  - `hasPending is true for in-flight and queued questions and false after save`.
  - `5xx retries with backoff and keeps newer values` — first `send` rejects `ApiError(503)`; `set(8,"new")` while waiting; at +1 s second `send` contains `8: "new"`; status went `retrying`.
  - `409 session_closed stops everything` — `onClosed` once, no retry after 60 s, later `set` is ignored, `flush()` resolves.
  - `422 with extra.question drops only that item` — `send([{1},{2}])` rejects 422 `{question: 2}` → `onRejected(2, msg)`, next `send` has only question 1.
  - `401 is fatal and not retried`.
  - `onSaved receives normalized numeric keys`.
- [ ] **Step 2: Run** `npx vitest run lib/answers/save-queue.test.ts` → FAIL.
- [ ] **Step 3: Implement `SaveQueue`.**
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat: SaveQueue with debounce, coalescing, retry and flush`.

---

### Task 8: Test list and start dialog

**Files:**
- Create: `lib/tests/skills.ts`, `lib/session/queries.ts` (start mutation only here; extended in Task 11)
- Create: `components/tests/skill-filter.tsx`, `components/tests/test-card.tsx`, `components/tests/start-test-dialog.tsx`
- Create: `app/(app)/tests/page.tsx`, `app/(app)/tests/loading.tsx`, `app/(app)/tests/error.tsx`
- Test: `components/tests/start-test-dialog.test.tsx`, `components/tests/test-card.test.tsx`

**Interfaces:**
- Consumes: `getServerApi` (`list_tests`), browser `api` + `unwrap` (`start_session`), `ApiError`.
- Produces:
  - `SKILLS: Skill[] = ["reading","listening","writing","speaking"]`, `SKILL_LABELS: Record<Skill,string>`, `PLAYABLE_SKILLS: ReadonlySet<Skill> = new Set(["reading"])`.
  - `useStartSession()` → `useMutation<SessionDetail, ApiError, {test_id: string; mode: SessionMode}>`; on success `router.push("/sessions/" + id)` (no cache seeding: the session screen refetches so it gets a fresh `server_time` offset).
  - `sessionKey(id: string) = ["session", id] as const`.
  - `/tests?skill=reading` — RSC; filter via `<SkillFilter>` links (`All`, then each skill); `list_tests` with `limit: 100`; empty state "No published tests yet".
  - `<TestCard test>`: title, skill badge, "Exam: {n} min"; playable → **Start** opens `<StartTestDialog>`; not playable → disabled "Coming soon" badge.
  - `<StartTestDialog test open onOpenChange>`: radio **Practice** ("No timer. Submit when you're ready.") / **Exam** ("{n}-minute countdown. Submitted automatically when time runs out."), default Practice; **Start test** button. Errors: 409 → "This test can't be started yet."; 404 → "This test is no longer available."; 429 → "You've reached today's limit. It resets at {local time of extra.resets_at}."; network/5xx → "Couldn't start the test. Try again."

- [ ] **Step 1: Write failing tests** (MSW on `/api/backend/sessions`, mocked router):
  - `starts in practice mode by default` — click Start test → request body `{test_id, mode: "practice"}`; `router.push("/sessions/<id>")`.
  - `starts in exam mode when chosen`.
  - `shows the 429 reset time` — `resets_at: "2026-10-25T00:00:00Z"` → text contains "today's limit".
  - `shows the 409 message`.
  - `button is disabled while starting` (no double start).
  - `test-card`: reading card has an enabled Start button; speaking and writing cards show "Coming soon" and no Start button.
- [ ] **Step 2: Run** `npx vitest run components/tests` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS; `npx tsc --noEmit` clean.
- [ ] **Step 5: Commit** `feat: test list with skill filter and start dialog`.

---

### Task 9: Server-corrected clock and countdown

**Files:**
- Create: `lib/session/clock.ts`, `components/session/countdown.tsx`
- Test: `lib/session/clock.test.ts`, `components/session/countdown.test.tsx`

**Interfaces:**
- Produces:
  - `clockOffset(serverTime: string, receivedAt: number): number` = `Date.parse(serverTime) − receivedAt`.
  - `remainingMs(deadline: string, offsetMs: number, now = Date.now()): number` = `max(0, Date.parse(deadline) − (now + offsetMs))`.
  - `formatRemaining(ms: number): string` → `"mm:ss"` under an hour, `"h:mm:ss"` otherwise; rounds **up** to the second.
  - `<Countdown deadline offsetMs onExpire />` — ticks every 1 s; `role="timer"`, `aria-live="off"`; amber under 5 min, red under 1 min; calls `onExpire` exactly once when it reaches 0 (also on mount if already past).

- [ ] **Step 1: Write failing tests.**
  `clock.test.ts`: server 5 min ahead of the client (`server_time = receivedAt + 300_000`) and deadline = server time + 10 min → `remainingMs` = 600 000 at `now = receivedAt`; deadline in the past → 0; `formatRemaining(61_001)` = `"01:02"`; `formatRemaining(3_600_000)` = `"1:00:00"`; `formatRemaining(0)` = `"00:00"`.
  `countdown.test.tsx` (fake timers): shows `"00:03"`, advances to `"00:00"`, `onExpire` called once after further ticks; past deadline on mount → `onExpire` once.
- [ ] **Step 2: Run** `npx vitest run lib/session/clock.test.ts components/session/countdown.test.tsx` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat: server-corrected countdown`.

---

### Task 10: Question group components

**Files:**
- Create: `components/questions/question-group.tsx`, `multiple-choice-group.tsx`, `matching-group.tsx`, `gap-fill-group.tsx`, `short-answer-group.tsx`
- Test: `components/questions/question-groups.test.tsx` (groups taken from `tests/fixtures/content/reading.json` and `listening.json`)

**Interfaces:**
- Consumes: Task 6 types and helpers.
- Produces: every component takes
```ts
type GroupProps = {
  group: QuestionGroup;
  answers: Record<number, AnswerValue>;
  onChange(question: number, value: AnswerValue, opts: { debounce: boolean }): void;
};
```
  - `<QuestionGroup>` renders `title`, `instructions` and `word_limit` as written, then dispatches: `multiple_choice` → `MultipleChoiceGroup`; `matching` → `MatchingGroup`; `fill_blank` with `context` → `GapFillGroup`; `fill_blank` without context and `short_answer` → `ShortAnswerGroup`.
  - Every item's wrapper has `id="q-<itemKey>"` (for navigation) and shows `itemLabel`.
  - `MultipleChoiceGroup`: options = item `options` ?? group `options`. `itemMaxChoices === 1` → radio-like buttons (`role="radio"`); `> 1` → checkboxes with hint "Choose {n}". Changes call `onChange(key, toggleChoice(...), {debounce:false})`. The value is always an array.
  - `MatchingGroup`: one native `<select aria-label="Question {n}">` per item over group `options` (shown once as a list above the items: "A  text"); value is a string; a "Clear" option sends `null`; `{debounce:false}`.
  - `GapFillGroup`: renders `parseGapContext(context)` inline; each gap is an `<input aria-label="Question {n}" maxLength={200}>` → `onChange(n, text, {debounce:true})`.
  - `ShortAnswerGroup`: prompt then `<input maxLength={200}>`, debounced.

- [ ] **Step 1: Write failing tests.**
  - TFNG group (reading group 1): clicking "TRUE" on Q1 calls `onChange(1, ["TRUE"], {debounce:false})`; clicking "FALSE" next with answers `{1: ["TRUE"]}` → `["FALSE"]`.
  - Choose-two (listening, numbers `[21,22]`): label "21–22"; picking B then D sends `["B"]` then `["B","D"]` with key **21**; a third option is not added; no call ever uses 22.
  - Matching (headings): selecting option `"iii"` sends `"iii"` (string, not array).
  - Gap fill (reading group 2): renders 6 inputs labelled "Question 8"…"Question 13" in the text flow; typing calls `onChange(8, "m", {debounce:true})`; `maxLength` is 200.
  - Saved answers render: `{1: ["NOT GIVEN"], 8: "moss"}` shows NOT GIVEN selected and "moss" in the Q8 input.
  - `instructions` and `word_limit` text appear verbatim.
- [ ] **Step 2: Run** `npx vitest run components/questions` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat: question group components`.

---

### Task 11: Reading session screen — autosave, timer, submit, timeout, resume

**Files:**
- Modify: `lib/session/queries.ts` (add `useSessionQuery`, `useSubmitSession`)
- Create: `lib/session/use-session-answers.ts`
- Create: `components/session/session-screen.tsx`, `reading-screen.tsx`, `question-nav.tsx`, `submit-dialog.tsx`, `submitted-view.tsx`, `save-status.tsx`
- Create: `app/(app)/sessions/[sessionId]/page.tsx`, `loading.tsx`, `error.tsx`
- Create: `tests/fixtures/session.ts`
- Test: `lib/session/use-session-answers.test.tsx`, `components/session/session-screen.test.tsx`

**Interfaces:**
- Consumes: Tasks 2, 6, 7, 9, 10.
- Produces:
  - `makeSession(overrides?: Partial<SessionDetail>): SessionDetail` — reading fixture content, `mode: "practice"`, `status: "in_progress"`, `answers: {}`, `server_time` = now.
  - `useSessionQuery(id)` → `useQuery<{ session: SessionDetail; offsetMs: number }, ApiError>`; the `queryFn` records `receivedAt = Date.now()` after the response and computes `clockOffset`. `refetchInterval`: `10_000` once `expired && status === "in_progress"`, else `false`. `refetchOnWindowFocus: false` (focus refetch would reset local answers).
  - `useSubmitSession(id: string, flush: () => Promise<boolean>)` → mutation: `await flush()` **first**; if it returns `false`, throw `UnsavedAnswersError` and do **not** call submit (save gating, not timer gating); otherwise `submit_session`. 409 `session_closed` is treated as success (refetch session); on success refetch `sessionKey(id)`.
  - `useSessionAnswers(session: SessionDetail, handlers: { onClosed(): void })` → `{ answers: Record<number, AnswerValue>; setAnswer(q, v, {debounce}): void; flush(): Promise<boolean>; status: SaveStatus }`. Initial state = `normalizeSaved(session.answers)`. The `SaveQueue` is created **and** disposed inside one `useEffect` keyed by session id (StrictMode-safe); handlers are kept in refs; `send` = `save_answers` via proxy. `onSaved` merges server values only for questions where `!queue.hasPending(q)`. `onRejected` shows a toast "Answer to question {n} wasn't saved: {message}". `onFatal` 401 → `router.replace("/login?next=…")`. Adds a `beforeunload` prompt while status is `pending | saving | retrying`. Disposes the queue on unmount.
  - `/sessions/[sessionId]` page (RSC) awaits `params` and renders `<SessionScreen sessionId>`.
  - `<SessionScreen>`: loading skeleton; 404 → "Session not found"; `status === "submitted"` → `<SubmittedView>`; `parseContent` fails or skill not in `PLAYABLE_SKILLS` → "This test type isn't available yet"; reading → `<ReadingScreen>`.
  - `<ReadingScreen>`: header with title, mode badge, `<SaveStatus>` ("Saved" / "Saving…" / "Offline — retrying" / "Not saved"), `<Countdown>` when `deadline` (exam only), **Submit** button. Two panes on ≥ lg (passage left, scrollable; that passage's question groups right), stacked on mobile; passage tabs "Passage 1/2/3". `<QuestionNav>` bottom bar: one button per `readingItems` entry, styled answered/unanswered, click switches tab and scrolls to `#q-<key>`.
  - `<SubmitDialog>`: "Submit your answers?" + "{k} of {n} questions unanswered." (only when k > 0); confirm runs `useSubmitSession`. On `UnsavedAnswersError`: "Your answers aren't saved yet — check your connection and try again." (dialog stays open).
  - Expiry: `onExpire` → `flush()`, set `expired = true` (enables polling); inputs stay **enabled**; banner "Time's up — submitting your answers…". `onClosed` from the queue → refetch session.
  - `<SubmittedView session>`: `submit_reason === "timeout"` → heading "Time's up — submitted"; otherwise "Submitted". Body: "Results aren't available yet." Link "Back to tests" and "My sessions". No scores.

- [ ] **Step 1: Write failing tests.**
  `use-session-answers.test.tsx` (MSW on `PUT /api/backend/sessions/:id/answers`, fake timers):
  - `initial answers come from session.answers with numeric keys`.
  - `server echo does not clobber a field edited during the request` — hold the first PUT; `setAnswer(8, "mo", debounce)`, flush, then `setAnswer(8, "moss")` while in flight; first response echoes `{"8": "mo"}` → `answers[8]` stays `"moss"`.
  - `409 calls onClosed`.
  - `works under StrictMode` — render inside `<StrictMode>`; `setAnswer(1, ["TRUE"], {debounce:false})` after mount → one PUT is sent.
  `session-screen.test.tsx` (MSW for GET/PUT/POST, `makeSession`):
  - `renders passages and resumes saved answers` — `answers: {"1": ["TRUE"], "8": "moss"}` → TRUE selected, Q8 shows "moss", nav marks 1 and 8 answered.
  - `submit flushes pending text first` — type in Q8, immediately Submit → confirm; recorded request order is `PUT answers` (containing Q8's text) then `POST submit`; then "Submitted" appears.
  - `offline submit is blocked with a message` — PUT fails with a network error → after confirm, the dialog shows "aren't saved yet" and no `POST submit` is recorded.
  - `second submit 409 is treated as already submitted` — POST returns 409 `session_closed`, GET returns submitted → "Submitted" shown, no error.
  - `exam countdown uses server time and never disables inputs` — `server_time` 5 min ahead of client, `deadline` = server_time + 2 s; advance 3 s → banner "Time's up" visible and Q8 input still enabled; PUT still sent on typing.
  - `late save shows time's up` — PUT returns 409 `session_closed`; GET then returns `status: "submitted", submit_reason: "timeout"` → heading "Time's up — submitted".
  - `practice mode shows no timer` — no `role="timer"`.
  - `unanswered count in submit dialog` — 2 of 40 answered → "38 of 40 questions unanswered."
  - `submitted session opens straight to the submitted view` (resume after submit).
  - `writing session shows "This test type isn't available yet"`.
- [ ] **Step 2: Run** `npx vitest run lib/session components/session` → FAIL.
- [ ] **Step 3: Implement** hooks, then components, then the route files.
- [ ] **Step 4: Run** → PASS; `npm test`, `npx tsc --noEmit`, `npm run lint` all clean.
- [ ] **Step 5: Commit** `feat: Reading session screen with autosave, timer, submit and resume`.

---

### Task 12: My sessions

**Files:**
- Create: `components/sessions/sessions-table.tsx`, `app/(app)/sessions/page.tsx`, `loading.tsx`, `error.tsx`
- Test: `components/sessions/sessions-table.test.tsx`

**Interfaces:**
- Consumes: `getServerApi` (`list_sessions`), `SKILL_LABELS`.
- Produces: `/sessions?page=N` (RSC, page size 20, `offset = (N−1)·20`; invalid or < 1 → 1). `<SessionsTable items total page>` columns: Test (title), Skill, Mode, Status, Started (local date-time), Submitted. In-progress rows: "Resume" link to `/sessions/{id}`; exam rows also show the deadline. Submitted rows: "Submitted" or "Time's up" (timeout), linked to the submitted view. Previous/Next links; empty state "No attempts yet — start a test" linking `/tests`.

- [ ] **Step 1: Write failing tests:** in-progress row has a Resume link to `/sessions/<id>`; timeout row shows "Time's up"; with `total = 45, page = 3` there is no Next link and Previous points to `?page=2`; empty list shows the empty state.
- [ ] **Step 2: Run** `npx vitest run components/sessions` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat: My sessions list`.

---

### Task 13: End-to-end check against the real backend

**Files:**
- Create: `.claude/launch.json` (dev server config: `npm run dev`, port 3000)
- Modify: `CLAUDE.md` (anything learned while verifying)

- [ ] **Step 1: Start the backend** in `../ielts-backend` on `feat/tests-and-sessions`: `docker compose up -d`, `uv run alembic upgrade head`, `uv run uvicorn api.main:app --reload`. Confirm `practice-01-reading` is published (`GET /tests` through the app).
- [ ] **Step 2: Refresh types** — `npm run api:snapshot && npm run gen:api`; `git diff types/` must be empty (or regenerate, re-run `npx tsc --noEmit`, and commit).
- [ ] **Step 3: Walk the flows in the browser** with a test account created for this check (record its email in `.env.local` as `E2E_EMAIL`/`E2E_PASSWORD`, never in chat): register → `/tests` → Start Reading in **practice** → answer TFNG, a gap and a heading → reload the tab (answers persist) → Submit → "Submitted". Then start in **exam** mode, confirm the countdown and that `PUT …/answers` goes through `/api/backend`. In DevTools, delete `ielts_access` and act again → the request succeeds and a new cookie is set (refresh path). Stop the backend briefly while typing → status "Offline — retrying" → restart → "Saved".
- [ ] **Step 4: Timeout path** — load a copy of the reading test with a short time limit if the CLI supports it; otherwise skip and note it (covered by Task 11 tests).
- [ ] **Step 5: Run** `npm test`, `npx tsc --noEmit`, `npm run lint`, `npm run build` → all pass. The build also confirms the middleware bundle is Edge-safe (nothing it imports pulls in `server-only` or Node APIs).
- [ ] **Step 6: Commit** `chore: dev launch config and CLAUDE.md updates`.

---

## Follow-up plans (not in this milestone)

1. **Writing** — essay editor (debounced, ≤ 20 000 chars, `question` = task number), live word count vs `min_words`, Task 1 chart (`image` signed URL; needs MinIO), "Request manual grading" toggle (`PATCH`), the 429 screen. The daily limit has **no pre-check endpoint**: decide between counting today's (UTC) Writing sessions from `GET /sessions` and a static warning before start. Add `"writing"` to `PLAYABLE_SKILLS`.
2. **Listening** — per-part `<audio>`, once-per-part playback in exam mode (frontend-only rule; replay allowed in practice), built against a mocked session or a locally loaded test with audio (handoff §8). Reuses Tasks 6, 7, 10, 11.
3. **Speaking, results, dashboard** — wait for the next backend handoff.
