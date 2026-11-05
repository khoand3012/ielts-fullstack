# Glossary

Domain terms shared by `ielts-backend/` and `ielts-frontend/`. Use these names in code, docs and reviews.

## Writing feedback

**Writing comment** — one piece of AI feedback on a Writing task, filed under one criterion (Task Response/Achievement, Coherence and Cohesion, Lexical Resource, Grammatical Range and Accuracy). It has comment text, an optional quote from the essay, an optional suggestion and a kind.

**Comment kind** — `strength` (praises something) or `improvement` (points to a way to improve). Set by grading prompt v2. The backend drops a strength's suggestion.

**Legacy comment** — a Writing comment graded before kinds existed (`kind` is null). It is treated as an improvement. If it has no suggestion, the UI says "No change suggested for these words".

**Highlight** — a marked span of the essay that carries one or more placed comments whose quotes overlap. It is identified by a **highlight key** (`<paragraph>-<index>`). Keys don't change with the criterion filter.

**Placed comment / unplaced comment** — a comment whose quote was found in the essay is placed on a highlight. One with no quote, or whose quote wasn't found, is unplaced and listed under "Other comments on this task".

**Lead comment** — the first comment on a highlight that passes the current criterion filter. It decides the highlight's colour and whether it shows as a strength.

**Display variant** — how a Writing comment is shown, resolved once and used everywhere (the essay panel and Other comments):
- **strength** — "What works", green mark. A suggestion is never shown.
- **fix** — an improvement or legacy comment with a non-blank suggestion. The quoted words are struck out and a "Better" line is shown.
- **mark only** — an improvement with no suggestion. The words are marked in the criterion colour.
- **legacy no change** — a legacy comment with no suggestion. Shown as mark only, plus "No change suggested".

**Writing feedback view model** — the frontend module that turns a `WritingTask`, a criterion filter and a selected highlight key into everything the result screen renders:
- the visible highlights with their lead comments;
- the Previous/Next order and position;
- the placed and unplaced comment groups;
- each comment's display variant and its before / quote / after sentence slices.

Components render what it returns and keep only DOM work (focus, scrolling, the bottom sheet).
