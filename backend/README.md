# backend/ — School Management Platform API

Node.js 24 · TypeScript (strict, ESM) · Express 5 · **Drizzle ORM** · PostgreSQL 18 (RLS) · awilix DI · BullMQ · Zod 4 · pino

This is a modular monolith built with Clean Architecture, with class-based controllers and use cases. This folder
implements the **cross-cutting design** in [`docs/backend/cross-cutting.md`](../docs/backend/cross-cutting.md) and the
business modules `core`, `hrm`, `aca`, `sis`, `att`, `fee`, `lib`, `trn`, `acc` and `hst` on top of `platform`, `iam` and `com`. The database schema lives in
[`../db`](../db/README.md), and the SQL migrations there are the source of truth.

## Status

| Gate                  | Result                                                                                         |
| --------------------- | ---------------------------------------------------------------------------------------------- |
| `npm run typecheck`   | ✔ strict TypeScript, 0 errors                                                                  |
| `npm run lint`        | ✔ ESLint 10 + typescript-eslint, 0 problems                                                    |
| `npm run boundaries`  | ✔ dependency-cruiser: 0 violations (module internals, layer rules)                             |
| `npm test`            | ✔ 230 tests: 78 unit, 152 integration against PostgreSQL 18, running as runtime role `sms_app` |
| `npm run build` + run | ✔ API and worker boot; `/health/ready` reports DB and schema version                           |

## What is implemented (cross-cutting.md §)

| §   | Concern                                                                                                                                                                | Where                                                                                                         |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| 1   | Composition root, lifetimes, graceful shutdown                                                                                                                         | `src/bootstrap/container.ts`, `main.http.ts`, `main.worker.ts`, `shutdown.ts`                                 |
| 2   | Zod-validated configuration (fails fast; production requires keys + Redis)                                                                                             | `src/bootstrap/config.ts`, `.env.example`                                                                     |
| 3   | HTTP: middleware order, class controllers, typed `defineRoute`, envelope, OpenAPI 3.1 generated from routes                                                            | `src/shared/http/*`, `src/bootstrap/http-app.ts`                                                              |
| 4   | Authentication: argon2id passwords, lockout, TOTP MFA, guardian SMS OTP, EdDSA JWT, rotating refresh tokens with **reuse detection**, web cookies + double-submit CSRF | `src/modules/iam/*`, `shared/infrastructure/crypto/*`                                                         |
| 5   | Authorization: route permission → `ScopePolicy` (data scopes, resolvers, 404 for guardians) → PostgreSQL RLS                                                           | `shared/http/middleware.ts`, `shared/application/ScopePolicy.ts`, `iam/infrastructure/IamIdentityProvider.ts` |
| 6   | Persistence: Drizzle, `UnitOfWork` (AsyncLocalStorage transaction + `app.*` RLS settings, retries, `afterCommit`), PG error mapping, gap-free `NumberAllocator`        | `shared/infrastructure/db/*`                                                                                  |
| 7   | Domain kernel: `Money` (paisa), `LocalDate` (Asia/Dhaka), `AggregateRoot`, errors                                                                                      | `src/shared/domain/*`                                                                                         |
| 8   | Idempotency-Key (DB-backed lock + replay)                                                                                                                              | `shared/infrastructure/idempotency/*`, `mountController.ts`                                                   |
| 9   | Transactional outbox → relay (LISTEN/NOTIFY + poll, `SKIP LOCKED`) → BullMQ / inline → subscribers with inbox dedupe                                                   | `shared/infrastructure/events/*`                                                                              |
| 10  | Jobs: registry, runner, BullMQ or inline queue, leader election, schedules                                                                                             | `shared/infrastructure/queue/*`, `bootstrap/worker-app.ts`                                                    |
| 12  | Notification hub: rules, preferences, quiet hours, bilingual templates, dedupe, SMS segments (UCS-2), providers                                                        | `src/modules/com/*`                                                                                           |
| 13  | Files: purpose policies, presigned S3 upload/download, ClamAV scan job                                                                                                 | `src/modules/platform/*`, `shared/infrastructure/storage/*`                                                   |
| 16  | Cache (Redis or memory), rate limiting (login, OTP, global)                                                                                                            | `shared/infrastructure/cache/*`                                                                               |
| 17  | RFC 9457 problem+json, stable error codes, localised titles                                                                                                            | `shared/http/problem.ts`, `shared/domain/errors.ts`                                                           |
| 18  | pino logs with request correlation + PII redaction, Prometheus metrics (`/metrics`, token)                                                                             | `shared/infrastructure/observability/*`                                                                       |
| 19  | AES-256-GCM field encryption with key versions, HMAC blind index, helmet/CORS, SSRF-safe defaults                                                                      | `shared/infrastructure/crypto/*`, `http-app.ts`                                                               |
| 20  | Bangla digits, lakh grouping, Hijri dates                                                                                                                              | `shared/infrastructure/i18n/format.ts`                                                                        |

## Business modules

| Module | Base path | What works                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ------ | --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CORE   | `/core`   | Campuses, academic years (make current), terms, shifts, rooms, calendar events, lookups, settings; `GET /today` (school day / weekend / holiday)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ADM    | `/adm`    | **Website forms** (public, no login): enquiry and online application with draft-save link; spam protection (signed form token with minimum fill time, honeypot, per-IP rate limits, optional Cloudflare Turnstile, content scoring, duplicate merge; spam stored but hidden, bots told nothing); **campaign tracking** (campaign codes for QR / ads, UTM, referrer, landing page, source classification); enquiry inbox and pipeline (stages, counsellor, follow-ups, call notes, tasks, spam review); application review; funnel per source and campaign with cost per enquiry; acknowledgement SMS / e-mail                                                                                                                             |
| IAM    | `/iam`    | **RBAC**: the 12 specified roles (and more) seeded; permission catalogue per module / resource / action (view, create, edit, approve, export, delete); role matrix with a data scope per grant (org, campus, section, own classes / subjects / children, self); custom roles (copy, edit matrix); assignments org-wide or per campus, time-limited; access check; disable account; changes apply on the next request                                                                                                                                                                                                                                                                                                                      |
| HRM    | `/hrm`    | Staff (NID encrypted, searchable by blind index), departments, designations, staff logins; **payroll**: salary components, contracts (no overlaps, mid-month revision), encrypted bank accounts, loans / advances, monthly runs (inputs, compute, maker-checker approval, lock, bank advice CSV, paid), payslips + self-service, "salary processed" SMS; unpaid days and overtime pulled from attendance; **automatic TDS** from per-year tax tables (verify before use); **payslip PDFs**; **CPD**: course catalogue, sessions (capacity, self-registration, attendance), certificates (PDF), external training with HR verification, hours vs yearly target                                                                             |
| ACA    | `/aca`    | Programmes, year groups, subjects, sections, curriculum, teaching groups (generate, teachers, members), periods, timetables (clash check, publish, view), teacher load                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| SIS    | `/sis`    | Student registration (family re-use by guardian phone, duplicate birth-certificate check, guardian accounts), enrolment (capacity, roll numbers), transfer, documents, 360°, roster                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ATT    | `/att`    | Daily register (school-day check, change-only upsert, **quick mark**: only exceptions sent, the rest present / on leave); **period-wise** registers for senior years from the timetable (cover teacher, elective groups, pre-filled from the day, missed-lesson SMS); teacher's day screen; class day grid; **edit window** then **corrections** (maker-checker) and an audited mark history; absent/late SMS to guardians, student leave apply/decide, attendance summary; **staff**: leave with yearly balances and carry-forward (school-day counting, eligibility, approval marks attendance, cancel returns days), HR register, check-in / out with late / overtime and campus geofence, monthly unpaid-day summary for payroll      |
| FEE    | `/fee`    | Fee heads, structures (activate/retire), student items, concessions (stacking, caps, approval), billing preview/run (no double-billing), ad-hoc invoices, void rules, counter payments (allocation, receipts, family credit), cash sessions, family statement                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| LIB    | `/lib`    | Catalogue search (title/author/ISBN, availability per campus), accessioning with barcodes, issue/return/renew by member policy, fines (overdue, lost, damage) billed to the family through FEE, reservations with hold + SMS, overdue reminders, reader accounts and self-service, stock-take, e-library                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| TRN    | `/trn`    | Vehicles (documents with expiry, crew with licence, GPS device key), stops, routes, student seats (capacity), trips, **live GPS tracking**: tracker / gateway ingest, Traccar Client (OsmAnd) phones, driver app, live fleet + SSE stream, next stop + ETA, history polyline, overspeed alerts, "bus near your stop" SMS to guardians, parent view of the child's bus                                                                                                                                                                                                                                                                                                                                                                     |
| ACC    | `/acc`    | Chart of accounts, manual vouchers (balanced, postable accounts), reversal, trial balance, ledger with running balance, monthly fiscal periods with lock; payroll lock posts the salary journal, payment posts Dr payable / Cr bank; **budgets** (annual per campus and cost centre, maker-checker approval, revisions) with budget vs actual and commitments; **procurement**: requisition -> approval with budget check (overrun approval) -> quotation comparison -> PO at the quoted price -> goods receipt -> supplier bill (three-way match, VAT / TDS withheld, journal) -> payment, payables aging; **vendors** with TIN / BIN, deduction rates, terms and performance; PO PDF; goods receipts put stock items into a store (INV) |
| INV    | `/inv`    | Items with variants (sizes / colours), stores per campus, append-only stock ledger (opening, receipt, issue note, transfer at average cost, stock count), weighted average cost, no negative stock, reorder levels with low-stock filter, ledger with balance after each movement                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| CCA    | `/cca`    | Houses (master data): students are placed in a house (`houseId` on the student), notices can target a house                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| HST    | `/hst`    | Hostels / rooms / beds, allocation (gender, no double booking; rent + meals billed monthly via FEE), transfer / vacate, occupancy map, morning / night roll call (absence SMS), out-passes (guardian request, warden approval, gate out / in, overdue alert), visitor log, parent view; **mess**: weekly menu (English / Bangla), diets, meal opt-outs (guardian / student until the cutoff, warden any time), kitchen headcount per meal (meal plan, away on an out-pass, opted out, diets), servings vs expected, month report                                                                                                                                                                                                          |
| COM    | `/com`    | **Notice board and circulars** (audiences: campus, class, section, house, role, staff, guardians, students, individual; attachments; scheduling; numbered circulars; website listing; read receipts); **e-mail and push** for every event (HTML layout, SMS-text fallback), per-user preferences and quiet hours, push devices, in-app inbox, template versions / preview; event subscribers for every module; notice attachments downloadable by recipients; decision notices to requesters (attendance corrections, requisitions, budgets) and cancelled CPD sessions; Bangla HTML e-mail templates and layout                                                                                                                          |

Modules talk only through `public-api/` interfaces registered in DI (`coreApi`, `iamApi`, `hrmApi`, `acaApi`,
`sisApi`, `feeApi`, `libApi`, `attApi`, `filesApi`) and through outbox events. Next batches: ADM, EXM, LRN, COM notices, PRT, DOC, WEB, BI.

Not built yet: the PDF renderer (§14) and global search (§15). They arrive with the DOC and SEARCH modules; the ports
and queues are already in place.

## Getting started

```bash
# 1. infrastructure (or use an existing PostgreSQL 18 + Redis)
docker compose up -d postgres redis minio clamav mailpit

# 2. database schema + seeds + invariant tests (from repo root)
DB=school_platform_dev PGHOST=localhost PGPORT=5432 bash db/tools/rebuild-and-test.sh

#    integration tests use their own database (never the dev one: a running dev worker would drain its outbox)
DB=school_platform_test PGHOST=localhost PGPORT=5432 bash db/tools/rebuild-and-test.sh

# 3. backend
cd backend
cp .env.example .env && npm run keys:dev >> .env   # then edit DATABASE_URL etc.
npm install
npm run dev            # API on :8080  ->  http://localhost:8080/api/v1/docs.json
npm run dev:worker     # outbox relay, jobs, schedules
```

Without `REDIS_URL` everything runs in one process: in-memory cache and rate limits, inline jobs, and in-process
event delivery. This is for development only.

## Swagger UI (API testing)

Open **http://localhost:8080/api/docs** (OpenAPI JSON: `/api/v1/docs.json`). The assets are self-hosted under a strict
CSP. It is on by default outside production; control it with `SWAGGER_ENABLED`.

1. `POST /api/v1/auth/login` → **Try it out** → body `{"identifier":"admin","password":"…","client":"staff_app"}`.
   The returned access token is applied to **Authorize** automatically and kept across reloads.
2. Call any endpoint. For `Idempotency-Key`, leave `auto` and a fresh UUID is generated per request.
3. With `client: "web"` the browser stores the session cookies and the CSRF header is added for you.
4. Parents: `POST /auth/otp/request` → read the code from `com.outbound_message` (development SMS) →
   `POST /auth/otp/verify`.

Create a login first: `npm run user:create -- --username admin --password 'Admin-Pass-2026' --role PRINCIPAL`.

## Scripts

| Script                                      | Purpose                                                                    |
| ------------------------------------------- | -------------------------------------------------------------------------- |
| `dev` / `dev:worker`                        | Watch mode (tsx) for API / worker                                          |
| `build`, `start`, `start:worker`            | Compile to `dist/` and run                                                 |
| `typecheck`, `lint`, `format`, `boundaries` | Quality gates                                                              |
| `test`, `test:unit`, `test:integration`     | Vitest (integration uses `school_platform_test`, see `test/setup-env.ts`)  |
| `db:test-rebuild`                           | Drop and rebuild `school_platform_test` (migrations, seeds, invariants)    |
| `db:schema`                                 | Regenerate Drizzle tables from a migrated DB (`DATABASE_OWNER_URL`)        |
| `db:migrate`                                | Run `../db/tools/migrate.sh`                                               |
| `db:studio`                                 | drizzle-kit studio (browse data)                                           |
| `openapi`                                   | Write `openapi.json`                                                       |
| `trn:simulate`                              | DEV: drive a fake GPS tracker along a Dhaka path (`--device --key --loop`) |
| `keys:dev`                                  | Print development JWT/field/blind-index keys                               |

## Drizzle usage

- `npm run db:schema` → `src/shared/infrastructure/db/schema/<schema>.ts` (one file per module schema).
  These files are generated: never edit them, and never run `drizzle-kit push/generate/migrate`.
- Status columns are typed from the database CHECK constraints:
  `fee.invoice.status: 'draft' | 'issued' | 'partially_paid' | 'paid' | 'void'`.
- Money columns (`core.paisa`) are `number` (integer paisa). `date` columns are `'YYYY-MM-DD'` strings.
  `bytea` columns are `Buffer`.
- Repositories always use `uow.tx()`, the current transaction with the RLS context. There is no way to query
  outside a `UnitOfWork`.

```ts
import { and, eq, inArray } from 'drizzle-orm';
import * as fee from '../../../shared/infrastructure/db/schema/fee.js';

const rows = await this.uow
  .tx()
  .select()
  .from(fee.invoice)
  .where(and(eq(fee.invoice.familyId, familyId), inArray(fee.invoice.status, ['issued', 'partially_paid'])))
  .orderBy(fee.invoice.id)
  .for('update');
```

## Adding a module (pattern)

```
src/modules/<name>/
  domain/          entities, value objects, domain services, repository interfaces (pure TS)
  application/     one class per use case (extends UseCase / Query), ports
  infrastructure/  Drizzle repositories, adapters
  presentation/    controllers (BaseController + defineRoute), job handlers, event subscribers
  public-api/      the only thing other modules may import
  <name>.module.ts ModuleDefinition: register DI, jobs, schedules, subscriptions, controllers
```

Register the module in `src/bootstrap/modules.ts`. A route looks like this:

```ts
defineRoute({
  method: 'post', path: '/counter', summary: 'Record a counter payment',
  permission: 'fee.payment.create', idempotent: true,
  schema: { body: RecordCounterPaymentSchema, response: PaymentResultSchema },
  handler: async ({ body }, req) => this.created(await this.resolve<RecordCounterPayment>(req, 'recordCounterPayment').execute(body)),
}),
```

## Tests

- `test/unit`: pure kernel (Money, dates, crypto, SMS segments, quiet hours, ScopePolicy, error mapping).
- `test/integration`: real PostgreSQL as `sms_app`, so RLS, triggers and grants are enforced. Covered:
  - campus isolation and WITH CHECK
  - read-only transactions
  - gap-free numbering
  - outbox exactly-once delivery
  - login (web cookies + CSRF, app bearer), lockout counter commit
  - MFA, OTP via the notification hub
  - refresh reuse detection, logout
  - campus header scope
  - file policies, idempotent replay
  - OpenAPI, metrics, health
  - `academic.flow`: calendar, staff + login, sections/curriculum/teaching groups, campus scope, registration
    (family, duplicates, capacity), class-teacher scope, attendance with SMS alerts, leave
  - `fee.flow`: structure, concessions (auto / approval), billing preview + run + re-run, invoice SMS, cash session,
    allocation order, over-payment credit, void rules, family statement, cash variance
  - `lib.flow`: cataloguing, issue limits, reservations, renewal rules, late return fine billed through FEE, held copy +
    SMS, overdue reminders, lost book, reader account, teacher self-service, stock-take, e-library
  - `trn.flow`: vehicle + documents + crew, route stops, seat limit, device auth, trip, geofence SMS once, live fleet,
    driver-app overspeed alert, Traccar/OsmAnd, guardian-only parent view, history, offline status, SSE stream
  - `payroll.flow`: contracts + overlap, encrypted bank account, loan, festival-bonus run, inputs, exact paisa
    totals, maker-checker, lock (loan recovered, DB-frozen payslips, SMS), bank advice CSV, paid, own payslips only,
    tax table save / verify, payslip PDFs, salary + payment journals, balanced trial balance
  - `staffatt.flow`: leave balances / eligibility / overlap / approval, check-in late + overtime, geofence, HR
    register, month summary, payroll pull from attendance, cancel returns days
  - `hst.flow`: rooms / beds, gender + double booking, fee items, roll call SMS, out-pass lifecycle with overdue alert,
    visitors, transfer / vacate, parent view
  - `notice.flow`: audience validation, class targeting, board + read receipts, urgent SMS, scheduling, circular
    numbers, website listing, withdrawal
  - `messaging.flow`: preferences (mandatory events), personal quiet hours, push devices, HTML e-mail escaping,
    SMS-text fallback, inbox, template versions / preview / activation
  - `cpd.flow`: capacity, registration window, attendance, completion + certificate PDF, external training, summary
  - `rbac.flow`: catalogue, the specified roles, custom role matrix, campus assignment applied at once (stale token
    refused), access check, self-assignment / account type / duplicate / system-role guards, disabling an account
  - `attendance.flow`: quick marking, teacher's day, lesson registers from the timetable (cover teacher, electives,
    senior years only, not before the bell), missed-lesson SMS, class day grid, audited edit inside the window,
    corrections after it (maker-checker, self-approval refused), mark history
  - `acc.flow`: chart, unbalanced / group-account refusals, ledger running balance, reversal once, period lock
  - `inv.flow`: items / variants, stores, opening, issue (no negative stock), transfer at cost, count, reorder level,
    ledger balances, campus isolation, PO -> goods receipt into a store (average cost), PO PDF
  - `mess.flow`: menu, diets, opt-out cutoff (guardian) vs warden, out-pass absence, headcount with diets, servings,
    month report, parent view
  - `files.flow`: local storage presigned PUT / GET (type, size, tampered token), notice attachment for recipients only
  - `adm.flow`: form token, campaign link, enquiry with campaign source and SMS, honeypot / forged token / too-fast spam
    hidden and released, repeat merge, rate limit, draft application with resume link, direct application linking
    the enquiry, pipeline rules, review, funnel
  - `procurement.flow`: budget approval (not by the submitter) and revision, vendors, requisition with budget check,
    quotation comparison, PO price match, partial / late receipts, bills with VAT / TDS journals, payments, aging,
    budget vs actual, overrun approval, vendor performance
- Fixtures are created with the owner role and removed after each file (`test/helpers/testApp.ts`). Flow tests use a
  fixed clock in the 2091 - 2095 test years, so they can be re-run against the same database.

## GPS tracking (TRN)

1. Transport desk: `POST /trn/vehicles`, then `POST /trn/vehicles/{id}/device-key` with the tracker's id. The key is
   shown once (stored as SHA-256).
2. Send fixes in one of three ways:
   - **GPS tracker / gateway**: `POST /api/v1/trn/gps/ingest` with headers `X-Device-Id` and `X-Device-Key`, and a
     batch of up to 500 `{recordedAt, lat, lng, speedKmh, heading}`.
   - **Any phone**: install Traccar Client (Android / iOS). Set the server URL to `https://<host>/api/v1/trn/gps/osmand`
     and the device identifier to `<deviceId>.<deviceKey>`.
   - **Driver app**: `POST /trn/vehicles/{id}/pings`, signed in as the vehicle's crew (role DRIVER).
3. The driver starts the run: `POST /trn/trips/start {routeId, direction}`. While a trip runs, the first fix within
   `trn.near_stop_meters` (default 500) of a stop texts the guardians of the students at that stop, once.
4. Watch it:
   - `GET /trn/tracking/live`, or `/trn/tracking/stream` (SSE).
   - Parents: `GET /trn/students/{id}/bus` (+ `/stream`).
   - History: `GET /trn/vehicles/{id}/track`.

Settings (`core.setting`, per campus): `trn.near_stop_meters`, `trn.arrived_meters` (60), `trn.speed_limit_kmh` (60),
`trn.offline_after_sec` (120), `trn.idle_below_kmh` (3).

## Payroll (HRM-04)

| Step                                                                                      | Who                     | Endpoint                                                         |
| ----------------------------------------------------------------------------------------- | ----------------------- | ---------------------------------------------------------------- |
| Contract: basic + components (HOUSE 50 %, MEDICAL, PF 10 %, TAX, OT rate, FEST_BONUS ...) | HR                      | `POST /hrm/staff/{id}/contracts`, `/contracts/{id}/revise`       |
| Salary account (encrypted), loan / advance                                                | HR                      | `PUT /hrm/staff/{id}/bank-account`, `POST /hrm/staff/{id}/loans` |
| Monthly run (+ `includeComponents: ["FEST_BONUS"]` in Eid months)                         | HR                      | `POST /hrm/payroll-runs`                                         |
| Inputs: unpaid leave days, overtime minutes, cover periods, adjustments                   | HR                      | `PUT /hrm/payroll-runs/{id}/inputs`                              |
| Compute (repeatable) and submit                                                           | HR                      | `POST .../compute`, `.../submit`                                 |
| Approve / reject: never the submitter (API and DB check)                                  | Principal / campus head | `POST .../decision`                                              |
| Lock: payslips frozen by a DB trigger, loan installments taken, staff SMS                 | Approver                | `POST .../lock`                                                  |
| Bank advice CSV, then record the transfer                                                 | Accounts / approver     | `GET .../bank-advice`, `POST .../paid`                           |
| My payslips                                                                               | Every staff member      | `GET /hrm/me/payslips`, `GET /hrm/payslips/{id}`                 |

Calculation (`src/modules/hrm/domain/payroll.ts`) works on calendar days and integer paisa:

- Joiners, leavers and mid-month revisions are pro-rated by contract segment.
- Unpaid leave deducts the daily rate of the fixed earnings.
- Festival bonus is paid once, in full.
- Loans are deducted last and never push net pay below zero.

## Staff attendance, tax, payslip PDFs, accounts

- **Unpaid days for payroll**: `POST /hrm/payroll-runs/{id}/inputs/from-attendance` (before compute) fills each staff
  member's unpaid-leave days and overtime from `/att`. Unpaid days = unpaid leave + absences + ½ per half day, plus
  one per N late days when `att.lates_per_lwp_day` is set. Cover periods and adjustments already entered are kept.
- **Staff day settings** (per campus): `att.staff_start_time` (08:00), `att.staff_end_time` (15:00),
  `att.staff_grace_minutes` (10), `att.staff_min_overtime_minutes` (30), `att.staff_geofence` `{lat, lng, radiusMeters}`,
  `att.absent_is_lwp`, `att.half_day_is_lwp`.
- **TDS**: every income year is a row of `hrm.tax_year` with thresholds, slabs, salary exemption, rebate and minimum
  tax. Edit it with `PUT /hrm/tax-years/{code}`, then confirm it with `POST /hrm/tax-years/{code}/verify`.
  - The seeded **2025-26** and **2026-27** tables are **unverified** and come from press summaries; check them against
    the NBR / Finance Act text first.
  - Each month: project the annual taxable salary (year to date + this month + regular salary × months left), compute
    the annual tax, subtract the tax already deducted, divide by the months left.
  - A fixed TAX amount on a contract overrides the calculation. `hrm.auto_tds=false` switches it off.
  - Staff category and declared investment: `PUT /hrm/staff/{id}/tax-profile`.
- **Payslip PDF**: `GET /hrm/payslips/{id}/pdf` (the staff member or payroll staff) and
  `GET /hrm/payroll-runs/{id}/payslips-pdf`. A4 with the amount in words (lakh / crore) and a DRAFT watermark until
  the payroll is locked. Text is English only; Bangla needs an embedded font and shaping.
- **Accounts**: payroll lock → salary journal (`acc.payroll_accounts` maps components to accounts); payroll paid →
  Dr Salaries payable / Cr Bank. Fee auto-posting is next.

## E-mail and push providers

| Channel | Development | Production                                                                        |
| ------- | ----------- | --------------------------------------------------------------------------------- |
| SMS     | console     | BTRC-licensed gateway adapter (`SMS_PROVIDER`)                                    |
| E-mail  | console     | `SMTP_URL=smtps://user:pass@host:465` (SES, Mailgun, Postmark, ...), `MAIL_FROM`  |
| Push    | console     | Firebase service account: `FCM_PROJECT_ID`, `FCM_CLIENT_EMAIL`, `FCM_PRIVATE_KEY` |

- A permanent failure (SMTP 5xx, FCM "unregistered") is not retried, and a dead push token is revoked.
- Users manage channels and quiet hours under `/com/me/notification-preferences`. OTP, emergency and hostel safety
  messages cannot be switched off.

## Attendance: period-wise, edit window, audit

| Step                                                           | API                                                                                                           |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Teacher's day (registers + lessons, progress, still editable?) | `GET /att/my-registers?date=`                                                                                 |
| Daily register, only exceptions                                | `PUT /att/sections/:id/daily` `{ "markRest": true, "entries": [{ "studentId": "...", "status": "absent" }] }` |
| Lesson register (senior years)                                 | `GET` / `PUT /att/teaching-groups/:id/periods/:periodId?date=` (same body)                                    |
| Class day grid (daily + every lesson, missed lessons)          | `GET /att/sections/:id/day?date=`                                                                             |
| Correction after the window                                    | `POST /att/corrections`, `GET /att/corrections`, `POST /att/corrections/:id/decide` / `cancel`                |
| Who changed what, when                                         | `GET /att/students/:id/history?date=`                                                                         |

- Period-wise year groups: setting `attendance.period_wise_year_groups` (default `["Y10","Y11","AS","A2"]`, `["*"]` =
  all). A lesson can be marked by its timetabled teacher, or the cover teacher when a substitution is assigned, from
  the start of the period.
- Edit window: the day and until `attendance.edit_window_hours` (default 12) after the next midnight. Later changes go
  through a correction that someone other than the requester approves; the mark is then written with
  `source = correction`.
- Every change to a mark is in `audit.audit_event` (before / after, actor, time). Migration `0041` fixes the audit
  trigger: tables audited without redacted columns stored empty before / after images until then.

## Budget & procurement (ACC-03, ACC-04, ACC-05)

| Step                                                                         | API                                                                                       | Who (default roles)                       |
| ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ----------------------------------------- |
| Cost centres, budgets, lines, submit                                         | `/acc/cost-centres`, `POST /acc/budgets`, `PUT /acc/budgets/:id/lines`, `POST .../submit` | Accountant                                |
| Approve / reject budget (not the submitter)                                  | `POST /acc/budgets/:id/decide`                                                            | Principal, Vice-Principal                 |
| Budget vs actual (YTD budget, actual, committed, left, variance)             | `GET /acc/budgets/:id/vs-actual?asOf=`                                                    | Accountant, Principal                     |
| Requisition                                                                  | `POST /acc/requisitions` (`submit: true`), `GET /acc/requisitions[/:id]`                  | Head of Section, Librarian, Transport, IT |
| Approve requisition (budget check; overrun needs a reason + budget approval) | `POST /acc/requisitions/:id/decide`                                                       | Principal, Accountant                     |
| Quotations, comparison, choice                                               | `POST /acc/requisitions/:id/quotations`, `POST .../quotations/:qid/select`                | Accountant; choice: Principal             |
| Purchase order                                                               | `POST /acc/requisitions/:id/purchase-order`, `GET /acc/purchase-orders[/:id]`             | Accountant                                |
| Goods receipt, supplier bill                                                 | `POST /acc/purchase-orders/:id/receipts`, `POST /acc/purchase-orders/:id/bills`           | Accountant                                |
| Payment, payables                                                            | `POST /acc/supplier-bills/:id/payments`, `GET /acc/payables/aging`                        | Principal / Accountant                    |
| Vendors                                                                      | `/acc/vendors` (`GET /acc/vendors/:id` includes performance)                              | Accountant                                |

- Settings: `acc.quotation_threshold_paisa` (default Tk 25,000; below it one quotation is enough), `acc.min_quotations`
  (3), `acc.procurement_accounts` (payable 2300, VAT 2130, TDS 2120, bank 1110, cash 1100, mobile 1120).
- Supplier bill journal: Dr expense (PO line account, requisition cost centre), Cr accounts payable (net), Cr VAT and
  TDS payable. Payment: Dr accounts payable, Cr bank / cash / mobile.
- VAT and TDS rates per vendor are set by finance; the seeded accounts are a starting chart, not a tax opinion.
- A requisition / PO line may name a stock item (`itemVariantId`); its goods receipt needs `storeId` and posts a receipt
  movement at the PO price. `GET /acc/purchase-orders/:id/pdf` prints the order for the supplier.
- The requester is told (push, e-mail, in-app) when a requisition or budget is decided.

## File storage without MinIO

`STORAGE_DRIVER=local` (default when `S3_ENDPOINT` is not set, refused in production) keeps files under
`LOCAL_STORAGE_DIR` (default `var/storage`) and serves them from the API at `/api/v1/files/blob/:token`. Tokens are
signed (HMAC), expire within minutes and name the object, operation, content type and size, so clients use the same
presigned PUT / GET flow as with S3. Set `STORAGE_DRIVER=s3` once MinIO or S3 is available. Notice attachments are
downloaded through `GET /com/notices/:id/attachments/:fileId/url` (recipients of the notice only).

## Salary tax tables (HRM-04)

The seeded tables follow the Finance Act 2026 as summarised by KPMG-RRH, PwC Worldwide Tax Summaries and the press
(income years 2025-26 and 2026-27: Tk 4 lakh general threshold, slabs 10 / 15 / 20 / 25 / 30%, salary exemption one
third up to Tk 5 lakh, minimum tax Tk 5,000 or Tk 1,000 for a new taxpayer, Tk 50,000 more per disabled child).
They are **not verified** against the gazette: HR must check them and `POST /hrm/tax-years/{code}/verify`. Open points
are written in each year's `source_note` (the 2025-26 investment rebate; whether July Warriors share the Tk 5.5 lakh
row). Re-seeding updates unverified years only. The staff tax profile takes `disabledChildren` and `newTaxpayer`.

## Fixed in this round

- `0041`: the audit trigger stored empty before / after images for tables audited without redacted columns.
- `0046`: the stock-balance trigger rejected every outward movement (the CHECK ran on the proposed insert row before
  ON CONFLICT); balances are now updated first and inserted only when missing.

## Local PostgreSQL (this machine)

The development cluster lives in `C:\Users\PC\pgdata\school-sms` (outside Windows Temp and OneDrive, which would
clean or sync it) and listens on port 55432:

```bash
PG="/c/Program Files/PostgreSQL/18/bin"
"$PG/pg_ctl" start -D "C:/Users/PC/pgdata/school-sms" -o "-p 55432" -l "C:/Users/PC/pgdata/school-sms.log" -w
"$PG/pg_ctl" stop  -D "C:/Users/PC/pgdata/school-sms" -m fast
```

It is not a Windows service: start it after a reboot, or register it once from an administrator shell with
`pg_ctl register -N school-sms -D "C:/Users/PC/pgdata/school-sms" -o "-p 55432"`.

## Website admission forms (WEB-06)

- Public pages: `/admissions/enquire` and `/admissions/apply` (frontend). Link the school website and ads to them;
  add `?campaign=CODE` (from **Admissions → Campaigns**, which also prints the QR code) and / or `utm_*` parameters.
- API: `GET /adm/public/form`, `POST /adm/public/enquiries`, `POST /adm/public/applications`,
  `GET | PUT /adm/public/applications/:token` (no login; per-IP limits: 5 enquiries / 10 min, 10 applications / hour).
- Spam: a submission scoring at or above `adm.spam_threshold` (default 50) is stored with `isSpam` and its reasons,
  hidden from the inbox, and answered exactly like a real one. Settings: `adm.form_min_seconds` (4),
  `adm.duplicate_window_days` (30).
- Captcha (optional): set `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET` (Cloudflare Turnstile). If the captcha service
  is unreachable, the submission is not lost; the other checks still apply.
- Another website posting to the API directly needs its origin in `CORS_ORIGINS`.
