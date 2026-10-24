# School Management Platform

- `backend/` — Node.js + Express 5 API (modules in `backend/src/modules/<m>`, HTTP contract in `presentation/*Controller.ts`)
- `frontend/` — Next.js UI (`frontend/README.md`); API layer in `frontend/src/lib/api`
- `db/` — SQL migrations

## Rule: backend API change ⇒ frontend UI change in the same task

Any time a backend endpoint, request/response field, query param, enum or validation rule is added, changed or
removed (anything under `backend/src/modules/*/presentation`, `backend/src/shared/http`), finish the matching UI work
before calling the task done:

1. `cd frontend && npm run api:sync` — regenerates `backend/openapi.json` and `frontend/src/lib/api/schema.d.ts`
   (never hand-edit `schema.d.ts`). Needs the backend `.env` and database; if it can't run, say so.
2. Update `frontend/src/lib/api/services/<module>.ts` — add/rename/remove the endpoint wrapper (or a `resource(...)`
   entry for plain CRUD), following the existing style.
3. Update the UI:
   - new field → add it to the page's table columns and form fields (`src/components/crud/*`)
   - new endpoint/feature → add or extend the page under `src/app/dashboard/<group>/...` and its sidebar entry in
     `src/lib/nav.ts` (with the right permission)
   - renamed/removed field or endpoint → fix every usage
4. `npm run typecheck` (and `npm run lint`) in `frontend/` must pass. `npm run api:coverage -- <module>` must not
   list the endpoints you touched (it lists backend endpoints no frontend code references).
5. Mention in the summary which pages changed. Keep the Pages table in `frontend/README.md` current.

Every backend module has a frontend service now (except `platform` beyond files / health): keep them in step.
