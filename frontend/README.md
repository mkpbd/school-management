# frontend/ — School Management web app

Next.js 16 (App Router, Cache Components) · TypeScript · Tailwind CSS v4 · shadcn/ui (Base UI) · daisyUI 5 · TanStack Query · openapi-fetch

## Getting started

```bash
cp .env.example .env.local   # BACKEND_URL=http://localhost:8080
npm install
npm run dev                  # http://localhost:3000  (backend must run: cd ../backend && npm run dev)
```

`/api/*` and `/health/*` are rewritten to the backend (`next.config.ts`), so the browser stays same-origin:
session cookies, CSRF and refresh work without CORS.

## API layer (`src/lib/api`)

| File            | Purpose                                                                                                                                                  |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `schema.d.ts`   | Generated from `../backend/openapi.json`. Never edit; run `npm run api:sync`                                                                             |
| `client.ts`     | Typed `openapi-fetch` client: cookies, `X-CSRF-Token`, `X-Campus-Id`, refresh-and-retry 401                                                              |
| `services/*.ts` | One file per backend module: `auth`, `system`/`files`, `core`, `hrm`, `aca`, `sis`, `att`, `fee`, `lib`, `trn`, `inv`, `acc`, `hst`, `com`, `iam`, `cca` |
| `resource.ts`   | Generic master-data CRUD (list/get/create/update/remove) typed from the contract                                                                         |
| `query.ts`      | `$api` typed TanStack Query hooks for any endpoint                                                                                                       |
| `errors.ts`     | `ApiError` from RFC 9457 problem+json (`code`, `status`, `fieldErrors`)                                                                                  |

```ts
import { api } from "@/lib/api";

const { data: me } = await api.auth.me();
const { data, meta } = await api.sis.students.search({ q: "rahim", limit: 20 }); // meta.nextCursor
const { data: campus, rowVersion } = await api.core.campuses.get(id);
await api.core.campuses.update(id, { name: "Main" }, { rowVersion }); // If-Match
await api.fee.payments.counter(body, { idempotencyKey }); // Idempotency-Key
```

Bodies and query params are type-checked against the backend contract. Most responses are not described in the
contract yet, so they default to `Row` (pass a type: `api.core.campuses.list<Campus>()`).

After backend route changes: `npm run api:sync` (needs the backend `.env` and database). While developing, run
`npm run api:watch` next to `npm run dev`: it re-syncs on every controller / zod schema change in the backend, then
`npm run typecheck` lists the services and pages that must follow.

## UI

- shadcn/ui components live in `src/components/ui` (`npx shadcn@latest add <name>`).
- daisyUI classes (`btn`, `tabs`, `alert`, `stats`, `loading`, `select`, …) work alongside them.
- Dark mode: `next-themes` sets both `.dark` (shadcn) and `data-theme` (daisyUI).

Pages (sidebar groups in `src/lib/nav.ts`, filtered by `/me` permissions):

| Group          | Pages                                                                                                                                                                                                                                                                                                                                                                                                                           |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Setup          | campuses, academic years (make current), terms, shifts, rooms, calendar, lookups, settings                                                                                                                                                                                                                                                                                                                                      |
| HR             | staff (search, create, edit, create login), departments, designations, CPD: my CPD (hours vs target, certificates, external training log), sessions (schedule, register, attendance of registered staff, complete, cancel with reason), course catalogue, verification queue, summary per staff                                                                                                                                 |
| Payroll        | runs (inputs, attendance fill, compute, submit, approve, lock, paid; payslips PDF, bank advice CSV), payslips, my payslips, salary components, staff pay (contracts, revisions, bank account, loans, tax profile (incl. disabled children, new taxpayer)), loans, income-tax tables                                                                                                                                             |
| Academics      | programmes, year groups, subjects, sections, curriculum, teaching groups, periods, timetables, teacher load                                                                                                                                                                                                                                                                                                                     |
| Students       | list, register (guardians + enrolment), student 360 (guardians, placements, documents), class roster, houses (place students on their profile)                                                                                                                                                                                                                                                                                  |
| Attendance     | daily register (quick mark, edit window, history, corrections), my day, lesson register (period-wise), section day grid, corrections (request, approve / reject, withdraw), leave requests, my attendance (check-in / out with location, month), my leave (balances, apply, cancel), staff leave approvals, staff register, staff month                                                                                         |
| Fees           | heads, concession types, structures, student items, concessions, billing, invoices, payments, cash, statement                                                                                                                                                                                                                                                                                                                   |
| Library        | catalogue, titles, copies, issue/return, loans, readers, reservations, stock-takes, policies, digital                                                                                                                                                                                                                                                                                                                           |
| Transport      | live map (SSE), vehicles (crew, documents, GPS tracker key, track history), expiring documents, stops, routes (stop order, students), trips, alerts, driver console (phone GPS), where is my bus                                                                                                                                                                                                                                |
| Inventory      | items (variants e.g. uniform sizes, add variants, deactivate), stores (keeper, close), stock per store (value, low badge, receive / opening, issue, transfer, stock count, reorder levels), stock ledger                                                                                                                                                                                                                        |
| Accounts       | chart of accounts (create, edit, deactivate), journals (manual voucher with balanced lines, detail, reverse with reason), trial balance, ledger (running balance), fiscal periods (open / soft-lock / lock), cost centres, budgets (lines per account × cost centre, annual or 12 months; submit, approve / reject, revise), budget vs actual (committed, available, variance, unbudgeted)                                      |
| Procurement    | requisitions (lines with expense account and stock item, submit, budget check, approve / reject with overrun reason, cancel), vendors (TIN, BIN, VAT / TDS %, terms; performance), quotations (comparison, select with reason), purchase orders (issue from the quote, ordered / received / billed, PDF, cancel), goods receipts (store for stock items, rating), supplier bills (VAT / TDS withheld), payments, payables aging |
| Hostel         | hostels, rooms & beds, occupancy map (allocate from a free bed), allocate, residents (transfer, vacate, diet), roll call (morning / night), out-passes (request, approve / reject, gate out / in, overdue check), visitors, student hostel view (guardians: own children), mess: weekly menu (English / Bangla), kitchen headcount, month report, meal opt-outs                                                                 |
| Communication  | notices (compose EN/BN with audiences, attachments, schedule / publish, SMS, website; edit, withdraw; read receipts), publish due now, notice board, website preview, inbox, notification preferences (channels, quiet hours, push devices), message templates (versions, preview, activate)                                                                                                                                    |
| Access control | users (search, filters; role assignments per campus with validity, assign / revoke, effective permissions, access check, disable / enable), roles (create / copy, rename, MFA, delete custom), role permission editor (module × resource × action with data scope), role matrix                                                                                                                                                 |

Maps: `components/map` (Leaflet + OpenStreetMap tiles, browser-only). Live data: `hooks/use-event-stream.ts`
(Server-Sent Events with cookie auth, refresh and reconnect). Phone GPS for the driver console needs HTTPS (or localhost).

Building blocks: `components/crud` (`ResourcePage` for master data, `FormDialog` + `FieldDef`, `DataTable`),
`lib/refs.ts` (select options), `hooks/use-action.ts` (mutation + toast + cache invalidation), `components/page.tsx`.
`/login` handles staff password + TOTP and guardian SMS OTP; `src/proxy.ts` redirects to `/login` without a refresh cookie.

## Scripts

| Script                    | Purpose                                            |
| ------------------------- | -------------------------------------------------- |
| `dev` / `build` / `start` | Next.js                                            |
| `lint`, `typecheck`       | ESLint, `tsc --noEmit`                             |
| `api:sync`                | Backend `openapi.json` → `src/lib/api/schema.d.ts` |
