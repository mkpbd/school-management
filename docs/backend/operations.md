# Backend Operations, Testing & Decisions

## Contents

1. [Deployment topology](#1-deployment-topology)
2. [Environments & configuration](#2-environments--configuration)
3. [Scaling & capacity](#3-scaling--capacity)
4. [Performance budgets](#4-performance-budgets)
5. [CI/CD](#5-ci-cd)
6. [Testing strategy](#6-testing-strategy)
7. [Observability: dashboards & alerts](#7-observability-dashboards--alerts)
8. [Runbooks](#8-runbooks)
9. [Backend ADRs](#9-backend-adrs)
10. [Implementation order](#10-implementation-order)

---

## 1. Deployment topology

| Component | Image / service | Replicas (start) | Resources | Notes |
|---|---|---|---|---|
| API | `school-server` → `node dist/main.http.js` | 2 | 2 vCPU / 2 GB each | Behind Nginx; readiness `/health/ready`; graceful shutdown 25 s |
| Worker (general) | `school-server` → `node dist/main.worker.js --queues=events,notify,billing,imports,exports,devices,files,maintenance` | 1–2 | 2 vCPU / 2 GB | Leader election for scheduler + outbox relay |
| Worker (PDF) | same image, `--queues=pdf.render` | 1 | 2 vCPU / 4 GB | Chromium; scale out for report-card days |
| Web | Next.js | 2 | 1 vCPU / 1 GB | |
| PgBouncer | `pgbouncer` | 1 (+1 standby) | small | `pool_mode=transaction`, `max_client_conn=500`, `default_pool_size=40` |
| PostgreSQL | managed or VM | primary + replica | 4 vCPU / 16 GB / 200 GB SSD | WAL archiving (pgBackRest/WAL-G) |
| Redis | managed or VM | 1 (+replica) | 2 GB | AOF on, `noeviction` |
| ClamAV | `clamav/clamav` | 1 | 1 GB | Signature updates daily |
| Object storage | S3 / MinIO | — | 500 GB | Versioning on private bucket |

Container rules: non-root user, read-only root filesystem (tmp volume for Chromium), `NODE_OPTIONS=--max-old-space-size`
at 75 % of the memory limit, `SIGTERM` handled.

---

## 2. Environments & configuration

| Env | Database | Integrations | Data |
|---|---|---|---|
| local | Docker Compose (Postgres 18, Redis, MinIO, ClamAV, Mailpit) — schema via `db/tools/rebuild-and-test.sh` | mocks (`FakeGateway`, `ConsoleSms`) | seeds + fixtures |
| test (CI) | ephemeral Postgres per job | mocks | fixtures |
| uat | dedicated | gateway & SMS **sandboxes** | anonymised production copy |
| staging | production-like | sandboxes | anonymised |
| production | HA | live | real |

* Configuration is loaded from env vars and validated by Zod (see [cross-cutting §2](cross-cutting.md#2-configuration)).
* Secrets come from the vault. Gateway and SMS credentials differ per environment. Non-prod builds refuse live gateway
  URLs (an assertion at boot).
* The anonymiser (for uat/staging) replaces names, phones, e-mails, NIDs and addresses with deterministic fakes and keeps
  referential integrity. It runs as a job against a restored dump.

---

## 3. Scaling & capacity

| Load (spec §5.10) | Bottleneck | Design answer |
|---|---|---|
| 500 concurrent users | API CPU, DB connections | 2 API replicas × pool 20 via PgBouncer; most requests < 50 ms DB time |
| 1,500 parent logins at result publication | OTP SMS burst, portal reads | Results precomputed and cached (`portal:results:*`). Notifications sent in waves (500/min). OTP requests go to the priority SMS lane. k6 test before each publication |
| 300 payments / hour on due date | Gateway latency | Gateway calls outside DB transactions, row locks held for milliseconds only |
| 10,000 notifications / hour | Provider rate limits | BullMQ limiter per provider, failover, push preferred over SMS |
| 1,000 report cards < 10 min | Chromium | 1 PDF worker = 4 pages × ~0.6 s → ~400/min; add replicas for peaks |
| Billing run (3,000 invoices) | DB writes | Chunked 200/tx → < 2 min |
| Growth to 10,000 students / 5 campuses | Same architecture | Add API/worker replicas; DB vertical scale; partitions already in place |

---

## 4. Performance budgets

| Endpoint class | p95 target | Rule |
|---|---|---|
| Auth, portal home, register sheet | 300 ms | ≤ 5 queries, indexed; cached reference data |
| Write commands (attendance save, counter payment) | 400 ms | Single transaction; no external I/O inside |
| Lists / search | 500 ms | Keyset pagination, trigram index, `limit ≤ 200` |
| Reports (inline) | 2 s | Replica; otherwise async job |
| Webhooks | 1 s | Validation call has a 5 s timeout; heavy work queued |

`usecase_duration_seconds` histograms per use case are compared with these budgets on the Grafana "API SLO" board.
`auto_explain` logs queries over 200 ms in staging.

---

## 5. CI/CD

```
pull request
 ├─ pnpm install --frozen-lockfile
 ├─ lint (eslint) · format check · typecheck (tsc -b)
 ├─ dependency-cruiser  (module boundaries + layer rules)
 ├─ unit tests (vitest)                         ── domain & use cases with fakes
 ├─ db: rebuild-and-test.sh on Postgres 18       ── migrations + seeds + 24 invariant tests
 ├─ db:schema diff (gen-db-schema.ts)            ── generated Drizzle tables must be committed
 ├─ integration + API tests (vitest + supertest, real PG + Redis)
 ├─ OpenAPI diff vs main                          ── breaking change = fail unless labelled
 ├─ build image · Trivy scan · SBOM
 └─ ZAP baseline against ephemeral env
main
 ├─ deploy staging → migrate (sms_owner job) → rolling deploy → Playwright E2E + k6 smoke
 └─ manual approval → production (outside school hours 07:00–20:00) → migrate → rolling → post-deploy checks
```

dependency-cruiser rules (excerpt):

```js
forbidden: [
  { name: 'module-internals', severity: 'error',
    from: { path: '^src/modules/([^/]+)/' },
    to: { path: '^src/modules/([^/]+)/(?!public-api/)', pathNot: '^src/modules/$1/' } },
  { name: 'domain-purity', severity: 'error',
    from: { path: '/domain/' },
    to: { path: '(node_modules/(express|kysely|pg|ioredis|bullmq))|/infrastructure/|/presentation/' } },
  { name: 'presentation-no-infra', severity: 'error',
    from: { path: '/presentation/' }, to: { path: '/infrastructure/' } },
]
```

Release rules: migrations are backward-compatible for one release (expand → contract). The API image starts only
after `sys.schema_migration` reaches its expected version. Rollback means redeploying the previous image tag.

---

## 6. Testing strategy

| Level | Scope | Tools | Examples |
|---|---|---|---|
| Domain unit | Pure rules | Vitest | `Money` rounding, `AllocationPolicy` order, `ConcessionCalculator` stacking, `GradeCalculator` bands & weights, `LeaveDayCounter` with holidays, `TimetableClashChecker`, `PromotionPolicy` |
| Use case unit | Orchestration with fakes | Vitest + in-memory repositories | `RecordCounterPayment` rejects mixed families; `EnrolApplicant` is idempotent |
| Integration | Repositories, triggers, RLS, outbox | Vitest + real PostgreSQL (schema from `db/`) as `sms_app` | Over-allocation surfaces as `ALLOCATION_EXCEEDS_DUE`; cross-campus read returns 404; outbox row written in the same tx |
| API | HTTP contract, auth, permission matrix | Supertest | Data-driven: every role × endpoint from the §5.6 matrix → expected 2xx/403 |
| Contract | Gateway / SMS adapters | Recorded sandbox fixtures (nock) | IPN signature verification, validation API parsing |
| E2E | Critical journeys | Playwright (web) against staging | Admission → enrolment, fee cycle with sandbox gateway, marks → report card, attendance → SMS (mock provider) |
| Load | Spec §5.10 | k6 | 500 VU mixed, 1,500-login burst, 300 payments/h, notification throughput |
| Security | OWASP | ZAP, permission matrix, IDOR suite, dependency audit | Guardian A cannot read child of guardian B (404) |
| Resilience | Failures | Toxiproxy (staging) | Gateway timeout → sweeper recovers; SMS provider down → failover; Redis restart → jobs resume |

Coverage gate: ≥ 80 % branch coverage for `modules/fee`, `modules/exm`, `modules/iam`, `shared/http/authorize`
(spec §5.10 maintainability). Every test is tagged with the feature IDs it covers (e.g. `@FEE-04`), which gives the
traceability matrix of spec §5.13.

Test data builders live in `test/fixtures` (`aFamily().withStudents(2).onCampus('DHN')`). Integration tests run inside a
transaction that is rolled back, like `db/tests/invariants.sql`.

---

## 7. Observability: dashboards & alerts

| Dashboard | Panels |
|---|---|
| API SLO | Request rate, p50/p95/p99 by route, error rate, 4xx vs 5xx, slowest use cases |
| Payments | Attempts by provider/status, validation latency, stuck transactions, amount mismatches, daily collection |
| Notifications | Queue depth by channel, send rate, failure % by provider, DLR delay, SMS spend |
| Jobs | Waiting/active/failed by queue, DLQ size, outbox lag, job duration |
| Database | Connections, TPS, slow queries, replica lag, bloat, default-partition rows, RLS denials |
| Security | Failed logins, OTP rate, refresh reuse events, break-glass accesses, export volume |

| Alert | Condition | Severity |
|---|---|---|
| API error rate | 5xx > 2 % for 5 min | page |
| Payment failures | failed/amount_mismatch > 5 % in 15 min, or any webhook signature failure burst | page |
| Outbox lag | oldest unpublished > 60 s | page |
| DLQ not empty | any message in `events.dlq` / `notify.*.dlq` | ticket |
| SMS failures | > 10 % in 15 min, or provider balance < threshold | page / ticket |
| Replica lag | > 30 s | ticket |
| Default partition rows | > 0 | ticket |
| Backups | no successful base backup in 26 h or WAL archive gap | page |
| Audit chain | verification mismatch | page (security) |
| Refresh reuse | > 3 events/hour | security ticket |

---

## 8. Runbooks

| Situation | Steps |
|---|---|
| **Parent paid but invoice still unpaid** | 1. Find `fee.gateway_transaction` by family/time. 2. If `redirected`/`callback_received`, trigger the sweeper for that `merchant_tran_id` (admin action) → validation path. 3. If `amount_mismatch`, compare with the gateway portal, then refund or record a manual payment with an accounts note. 4. Never edit allocations: use a manual counter payment or reversal. |
| **Duplicate charge reported** | `fee.payment.gateway_transaction_id` is unique, so check for two gateway transactions → refund the second via `RequestRefund` (WF). |
| **SMS not arriving** | Notifications dashboard → provider failure %. Check balance (`com.sms_provider_balance`). Switch primary provider (setting). Replay failed messages from admin (re-queue `outbound_message` with status `failed`). |
| **Outbox lag growing** | Check the leader lock (`lock:leader`). Restart a worker if no leader. Check DLQ for poison events and fix the handler. Use admin replay. |
| **Marks need change after lock** | Teacher requests re-open → WF `marks_reopen` → paper `reopened` → new mark versions with a reason → re-lock → recompute results → republish (new report-card version, old one `superseded_at`). |
| **Wrong attendance after edit window** | `CorrectAttendance` with reason (audited). Never edit directly in the DB. |
| **Default partition has rows** | Run `SELECT core.ensure_partitions(...)` for the period, then move rows: detach default, create the partition, re-insert, re-attach (maintenance window). |
| **Restore drill (quarterly)** | Restore the latest base backup + WAL to a scratch server, run `db/tests/invariants.sql` and row-count checks, record RPO/RTO achieved. |
| **Key rotation** | JWT: add the new key to `JWT_PUBLIC_KEYS`, switch the private key, remove the old key after 24 h. Field KEK: KMS rotation; data keys re-wrapped by a job. |

---

## 9. Backend ADRs

| # | Decision | Alternatives | Why |
|---|---|---|---|
| B-01 | Express 5 + explicit `RouteDefinition` arrays in controller classes | NestJS decorators, routing-controllers | No reflect-metadata magic; the route list is the OpenAPI source; easy to read and test |
| B-02 | awilix PROXY injection with request scopes | tsyringe, InversifyJS, manual wiring | Constructor injection without decorators; scoped `ctx`/`uow` per request and job |
| B-03 | **Drizzle ORM as a query builder**; SQL migrations stay the source of truth; table definitions generated from the database (not `drizzle-kit pull`, which skips partitioned tables and domains) | Kysely, Prisma, TypeORM | Type-safe SQL close to PostgreSQL (`set_config`, `FOR UPDATE`, `ON CONFLICT`, CTEs); typed status unions; no migration engine fighting RLS/triggers/partitions. Revised from Kysely on 23 Oct 2026 at the team's request |
| B-04 | AsyncLocalStorage-bound UnitOfWork | Passing `trx` through every call | Repositories cannot run outside the RLS context. Nested use cases join the transaction |
| B-05 | Transactional outbox + BullMQ | Publish to queue directly; Debezium CDC | Atomic with business data; no extra infrastructure; CDC can replace the relay later |
| B-06 | Grants loaded server-side, not in the JWT | Permissions in token | Instant revocation via `authz_version`; small tokens |
| B-07 | Single image, two entrypoints | Separate services per module | Small team. Workers scale independently by queue flag |
| B-08 | Playwright HTML→PDF | PDFKit, wkhtmltopdf, react-pdf | Correct Bangla shaping; templates are HTML the school can edit |
| B-09 | Hosted gateway pages only | Direct card API | Card data never touches the system (PCI scope minimal) |
| B-10 | Push-first notifications, SMS where the rule demands | SMS for everything | Cost (Bangla SMS = 70 chars/segment) and reliability |
| B-11 | Keyset pagination | Offset | Stable under inserts; fast on large tables |
| B-12 | Database enforces financial/marks invariants too | App-only validation | Defence in depth: bugs or ad-hoc scripts cannot corrupt money or marks |

---

## 10. Implementation order

| Sprint block | Backend scope | Done when |
|---|---|---|
| 0. Skeleton (2 w) | Composition root, config, UoW + RLS, BaseController, error handler, OpenAPI, logging/metrics, outbox relay, queue base, CI with `rebuild-and-test.sh` | Health checks green. A sample use case passes integration tests as `sms_app` |
| 1. Identity (2 w) | IAM (password, OTP, MFA, refresh rotation), grants cache, ScopePolicy, WF engine, files, numbering, notification hub with SMS/push mock | Permission-matrix API tests pass |
| 2. Students (3 w) | CORE master data & calendar, ACA structure, SIS (students, guardians, families, enrolment, documents), imports | Pilot campus data imported via dry-run |
| 3. Daily ops (3 w) | ATT (daily/period, leave, staff), LRN P1, COM notices/templates, PRT aggregator | Attendance → absence SMS end-to-end < 2 min |
| 4. Admission (2 w) | ADM full funnel + EnrolApplicant | Admission → enrolment E2E |
| 5. Money (4 w) | FEE structures, billing runs, counter + online payments (sandbox), receipts, late fees, reminders, reports | One month parallel run reconciles to the paisa |
| 6. Exams (4 w) | EXM schedule, seating, marks, moderation, results, report-card PDFs, publication | Term report cards for a campus in < 10 min |
| 7. HR & docs (3 w) | HRM essentials + payroll, DOC certificates, WEB public API, BI dashboards | Spec Release 2 exit criteria |
| 8+. P2/P3 | TRN, LIB, INV, HLT, CCA, SEC, ACC, Edexcel entries, WhatsApp, devices | Per module |
