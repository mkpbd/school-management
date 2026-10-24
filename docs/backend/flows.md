# Backend Flows

Sequence diagrams for the critical journeys. Participants are modules or components. "DB" means one transaction with
the RLS context set (see [cross-cutting §6](cross-cutting.md#6-persistence-transactions--rls)).

## Contents

1. [Staff login with MFA](#1-staff-login-with-mfa)
2. [Guardian OTP login & refresh rotation](#2-guardian-otp-login--refresh-rotation)
3. [Monthly billing run](#3-monthly-billing-run)
4. [Online payment (gateway)](#4-online-payment-gateway)
5. [Counter payment & cash session](#5-counter-payment--cash-session)
6. [Late fees & reminders](#6-late-fees--reminders)
7. [Daily attendance & absence alert](#7-daily-attendance--absence-alert)
8. [Device ingest (biometric / RFID)](#8-device-ingest-biometric--rfid)
9. [Leave with approval workflow](#9-leave-with-approval-workflow)
10. [Marks → moderation → lock → results → report cards](#10-marks--moderation--lock--results--report-cards)
11. [Admission → enrolment](#11-admission--enrolment)
12. [Academic-year rollover](#12-academic-year-rollover)
13. [Notification dispatch](#13-notification-dispatch)
14. [File upload](#14-file-upload)
15. [Teacher cover (substitution)](#15-teacher-cover-substitution)
16. [Payroll](#16-payroll)

---

## 1. Staff login with MFA

```mermaid
sequenceDiagram
  autonumber
  participant W as Web app
  participant API as IAM LoginWithPassword
  participant R as Redis
  participant DB as PostgreSQL
  W->>API: POST /auth/login {username, password, captcha?}
  API->>R: rate-limit check (identity + IP)
  API->>DB: SELECT user_account (org from host), check status / locked_until
  API->>API: argon2id verify (constant-time path for unknown users)
  alt wrong password
    API->>DB: failed_login_count+1, maybe locked_until, audit LOGIN_FAILED
    API-->>W: 401 INVALID_CREDENTIALS
  else needs MFA (role.requires_mfa)
    API-->>W: 200 {mfaRequired: true, mfaToken (5 min, signed)}
    W->>API: POST /auth/mfa/verify {mfaToken, totp}
    API->>API: verify TOTP (window ±1, replay cache in Redis)
  end
  API->>DB: INSERT refresh_token (family), reset counters, last_login_at, audit LOGIN
  API->>R: load grants → authz:user:version
  API-->>W: Set-Cookie __Host-access, __Host-refresh, csrf, body {user, grants summary}
```

## 2. Guardian OTP login & refresh rotation

```mermaid
sequenceDiagram
  autonumber
  participant P as Parent app
  participant API as IAM
  participant DB as PostgreSQL
  participant Q as notify.sms
  P->>API: POST /auth/otp/request {phone}
  API->>DB: guardian account exists for phone? (answer is the same either way)
  API->>DB: INSERT otp_challenge (hash, 5 min)
  API->>Q: high-priority SMS "Your code is 482913"
  API-->>P: 202 {sent: true}
  P->>API: POST /auth/otp/verify {phone, code, deviceName}
  API->>DB: check attempts / expiry / hash, consume
  API->>DB: INSERT refresh_token (client parent_app, 90 days)
  API-->>P: {accessToken, refreshToken}
  Note over P,API: later, access token expired
  P->>API: POST /auth/refresh {refreshToken}
  API->>DB: SELECT by sha256 FOR UPDATE
  alt token already rotated (reuse)
    API->>DB: revoke whole family (reason reuse), audit, alert
    API-->>P: 401 REFRESH_REUSED (must log in again)
  else valid
    API->>DB: mark rotated, INSERT successor (same family)
    API-->>P: new access + refresh
  end
```

## 3. Monthly billing run

```mermaid
sequenceDiagram
  autonumber
  participant A as Accountant (web)
  participant FEE as FEE use cases
  participant Q as billing queue
  participant J as BillingRunJob
  participant SIS as SisModuleApi
  participant DB as PostgreSQL
  A->>FEE: POST /fee/billing-runs {campus, period 2026-11, scope}
  FEE->>DB: INSERT billing_run draft (unique campus+period)
  A->>FEE: POST /fee/billing-runs/{id}/preview
  FEE->>Q: preview job (sys.job_run)
  J->>SIS: active enrolments for campus at period start
  loop chunks of 200 enrolments
    J->>J: InvoiceBuilder: structure lines for billing month + student_fee_items + concessions + carry-forward note
  end
  J->>DB: preview totals + Excel exceptions file (no invoices yet)
  A->>FEE: review preview, POST /fee/billing-runs/{id}/post (Idempotency-Key)
  FEE->>Q: post job (flow: parent + chunk children)
  loop each chunk (own transaction)
    J->>DB: INSERT invoice (draft) + lines → trigger totals
    J->>DB: UPDATE invoice status issued (number from sequence, pay_token)
    J->>DB: outbox fee.invoice_issued.v1 per invoice
  end
  Note over J,DB: ux_invoice_period guarantees a re-run chunk never double-bills an enrolment
  J->>DB: billing_run posted, totals
  DB-->>Q: relay → COM sends SMS/push with pay link (quiet hours respected)
```

## 4. Online payment (gateway)

```mermaid
sequenceDiagram
  autonumber
  participant P as Parent (app or SMS link)
  participant API as FEE StartOnlinePayment
  participant DB as PostgreSQL
  participant GW as Gateway (SSLCommerz / bKash)
  participant WH as FEE HandleGatewayCallback
  participant SW as GatewaySweeperJob
  P->>API: POST /fee/payments/online/start {invoiceIds, provider} + Idempotency-Key
  API->>DB: tx1 - lock invoices (own family), compute outstanding, INSERT gateway_transaction initiated (merchant_tran_id, expires 30 min)
  API->>GW: create checkout session (amount, ipn_url, return urls) - outside tx
  API->>DB: tx2 - status redirected, init_response
  API-->>P: {redirectUrl}
  P->>GW: pay (bKash / Nagad / card on hosted page)
  GW->>WH: POST /webhooks/payments/sslcommerz (IPN)
  WH->>DB: INSERT gateway_webhook_log (raw)
  WH->>WH: verify signature / hash and timestamp
  WH->>GW: validation API (server-to-server)
  GW-->>WH: VALID, amount, currency, provider txn id
  WH->>DB: tx - SELECT gateway_transaction FOR UPDATE
  alt already validated (duplicate IPN)
    WH-->>GW: 200 OK (no-op)
  else amount or currency mismatch
    WH->>DB: status amount_mismatch, alert accounts
    WH-->>GW: 200 OK
  else valid
    WH->>DB: status validated, INSERT payment (UNIQUE gateway_transaction_id)
    WH->>DB: allocations per invoice line → triggers update paid/status
    WH->>DB: receipt (number), outbox fee.payment_received.v1, COMMIT
    WH-->>GW: 200 OK
  end
  GW-->>P: browser redirect /pay/return → page reads status from DB (never trusts query params)
  Note over SW,GW: every 5 min the sweeper re-queries transactions stuck in initiated/redirected/callback_received and applies the same validated path
```

## 5. Counter payment & cash session

```mermaid
sequenceDiagram
  autonumber
  participant C as Cashier
  participant FEE as FEE
  participant DB as PostgreSQL
  C->>FEE: POST /fee/cash-sessions (opening float)
  C->>FEE: GET /fee/invoices/lookup?code=QR → family outstanding (primary DB)
  C->>FEE: POST /fee/payments/counter {invoiceIds, amount, channel, instrument} + Idempotency-Key
  FEE->>DB: lock invoices ORDER BY id, verify same family + campus, open session for cash
  FEE->>FEE: AllocationPolicy (oldest due first, then head priority: fines first)
  FEE->>DB: payment + allocations + receipt, surplus stays as family credit, outbox
  FEE-->>C: 201 {receiptNo, allocations, creditPaisa} → receipt PDF job / thermal print
  C->>FEE: POST /fee/cash-sessions/{id}/close {countedCash}
  FEE->>DB: expected = float + Σ cash payments of session, variance stored
  Note over C,FEE: cheque payments start as pending_clearance, bounce → ReversePayment (negative allocations + WF)
```

## 6. Late fees & reminders

```mermaid
sequenceDiagram
  autonumber
  participant S as Scheduler (leader)
  participant LF as LateFeeJob 00:30
  participant RM as FeeReminderJob 10:00
  participant DB as PostgreSQL
  participant COM as Notification hub
  S->>LF: run (Asia/Dhaka business date)
  LF->>DB: open invoices with due_date + grace_days < today (per late_fee_rule)
  LF->>DB: INSERT fine line source fine, source_ref late:rule:stage (UNIQUE makes reruns safe)
  S->>RM: run
  RM->>DB: invoices due in 3 days, due today, overdue 7, overdue 15 (settings offsets)
  RM->>COM: dispatch fee.invoice_due / fee.invoice_overdue (dedupe key invoice:stage)
  RM->>DB: principal follow-up shortlist (overdue 15+) as report job
```

## 7. Daily attendance & absence alert

```mermaid
sequenceDiagram
  autonumber
  participant T as Teacher app
  participant ATT as ATT MarkDailyAttendance
  participant DB as PostgreSQL
  participant R as Outbox relay
  participant COM as COM subscriber
  participant SMS as SMS provider
  T->>ATT: GET /att/sections/{id}/daily?date=today
  ATT-->>T: roster pre-filled (approved leave, device arrivals)
  T->>ATT: PUT /att/sections/{id}/daily {entries} + Idempotency-Key
  ATT->>ATT: scope own_classes, school day check (SchoolCalendar), edit window
  ATT->>DB: INSERT ... ON CONFLICT (student_id, attendance_date) DO UPDATE (changed rows only)
  ATT->>DB: outbox att.student_marked_absent.v1 / late.v1 for rows whose status changed to absent/late
  ATT-->>T: 200 summary
  DB-->>R: NOTIFY outbox → relay within ~1 s
  R->>COM: job events.com
  COM->>COM: primary contact, preferences, template bn/en, dedupe att.absent:student:date
  COM->>SMS: send (UCS-2 for Bangla)
  SMS-->>COM: DLR webhook → outbound_message delivered
  Note over T,SMS: Re-saving the sheet does not re-send (status unchanged, plus dedupe key)
```

## 8. Device ingest (biometric / RFID)

```mermaid
sequenceDiagram
  autonumber
  participant D as ZKTeco / Hikvision
  participant B as device-bridge (campus)
  participant API as /devices/v1/events:batch
  participant DB as PostgreSQL
  participant J as DeviceIngestJob
  B->>D: poll logs (SDK / push protocol)
  B->>B: store locally (SQLite) with bridge_seq
  B->>API: POST batch (HMAC signature, timestamp)
  API->>DB: INSERT device_event ON CONFLICT (device_id, bridge_seq, event_time) DO NOTHING
  API-->>B: 200 {ackSeq} → bridge deletes acknowledged rows
  API->>J: queue (group by device)
  J->>DB: map credential → student (rfid_uid) or staff (rfid_uid / biometric_pin)
  J->>DB: student first in-scan → arrived_at on daily attendance (status present/late by cut-off)
  J->>DB: staff → att.staff_attendance check_in/check_out, late minutes
  J->>DB: processed_at, unknown credentials → exceptions list
```

## 9. Leave with approval workflow

```mermaid
sequenceDiagram
  autonumber
  participant G as Guardian
  participant ATT as ATT ApplyStudentLeave
  participant WF as WF engine
  participant CT as Class teacher
  participant SUB as ATT subscriber
  G->>ATT: POST /att/student-leaves {child, from, to, reason, attachment}
  ATT->>ATT: own_children scope, attachment must be clean
  ATT->>WF: submit(student_leave, subject att.student_leave_request)
  WF->>WF: steps whose condition matches payload, resolve class teacher
  WF-->>CT: approval_task + push
  CT->>WF: POST /wf/requests/{id}/actions {approve}
  WF->>WF: last step → outbox wf.request_decided.v1
  WF-->>SUB: event
  SUB->>SUB: leave approved → mark leave for school days in range (source leave_auto)
  SUB-->>G: notification att.leave_decided
```

## 10. Marks → moderation → lock → results → report cards

```mermaid
sequenceDiagram
  autonumber
  participant ST as Subject teacher
  participant HOS as Head of section
  participant EO as Exam officer
  participant EXM as EXM
  participant DB as PostgreSQL
  participant PDF as pdf.render workers
  ST->>EXM: PUT /exm/papers/{id}/marks (grid, autosave, Idempotency-Key)
  EXM->>DB: INSERT mark_entry versions → trigger updates mark_current (rejects if paper locked)
  ST->>EXM: POST /exm/papers/{id}/submit (every student has mark or absence code, double entry matches)
  HOS->>EXM: POST /exm/papers/{id}/moderate (or return with comment)
  EO->>EXM: POST /exm/papers/{id}/lock
  EO->>EXM: POST /exm/exams/{id}/results:compute (job)
  EXM->>EXM: GradeCalculator - component weights, CA from LRN, scheme version, ranks, attendance from ATT
  EXM->>DB: result_subject + result_summary
  EO->>EXM: POST /exm/exams/{id}/report-cards:generate (job flow, 50 per child job)
  EXM->>PDF: render bilingual templates (Chromium, Bangla fonts, QR)
  PDF->>DB: report_card + stored_file
  EO->>EXM: POST /exm/exams/{id}/publish {embargoUntil}
  EXM->>DB: published_at, outbox exm.results_published.v1
  Note over EXM,DB: portal shows results only when published_at is set and now >= result_embargo_until
  DB-->>EXM: subscribers warm portal cache, refresh bi.exam_result_stats, notify guardians in throttled waves
```

## 11. Admission → enrolment

```mermaid
sequenceDiagram
  autonumber
  participant G as Applicant guardian
  participant ADM as ADM
  participant FEE as FeeModuleApi
  participant SIS as SisModuleApi
  participant IAM as IamModuleApi
  participant DB as PostgreSQL
  G->>ADM: POST /public/v1/admission/applications (OTP-verified phone)
  ADM->>IAM: ensureGuardianAccount(phone)
  G->>ADM: save drafts, upload documents, submit
  ADM->>FEE: application fee invoice → G pays (flow 4)
  ADM->>ADM: test session, scores, merit list approved, offers issued
  G->>ADM: POST /adm/offers/{id}/accept
  ADM->>FEE: createAdmissionInvoice(offer.fee_schedule)
  G->>FEE: pays admission invoice
  FEE-->>ADM: event fee.payment_received.v1 (invoice linked to offer)
  ADM->>DB: EnrolApplicant tx - INSERT adm.enrolment_conversion first (PK makes it idempotent)
  ADM->>SIS: createStudentWithFamily (sibling match by phone / NID blind index)
  ADM->>SIS: enrol(section, roll rule)
  ADM->>IAM: ensureStudentAccount (senior years)
  ADM->>FEE: assignFeePlan + auto concessions (sibling, staff-ward → WF)
  ADM->>DB: application enrolled, outbox adm.applicant_enrolled.v1
  DB-->>G: SMS with admission number and portal link
```

## 12. Academic-year rollover

```mermaid
sequenceDiagram
  autonumber
  participant P as Principal / IT admin
  participant CORE as CORE rollover orchestrator (job)
  participant ACA as AcaModuleApi
  participant SIS as SisModuleApi
  participant FEE as FeeModuleApi
  participant DB as PostgreSQL
  P->>CORE: create next year + terms (planned)
  P->>CORE: POST rollover:preview
  CORE->>ACA: copy sections, curriculum, teaching groups (draft)
  CORE->>FEE: copy fee structures as drafts (new amounts editable)
  CORE->>SIS: promotion preview via PromotionPolicy (results + attendance + conditions)
  CORE-->>P: review screen (exceptions: repeat, hold, conditional, graduate)
  P->>CORE: POST rollover:commit (Idempotency-Key)
  loop per campus and year group (resumable chunks)
    CORE->>SIS: close current enrolments (promoted/repeated/graduated) and create next-year enrolments
  end
  CORE->>FEE: activate structures, open balances stay as old-year invoices (never rewritten)
  CORE->>DB: old year status locked, new year open + is_current, outbox core.academic_year_rolled_over.v1
```

## 13. Notification dispatch

```mermaid
sequenceDiagram
  autonumber
  participant SRC as Any module (event or use case)
  participant NS as NotificationService
  participant DB as PostgreSQL
  participant R as Redis
  participant Q as channel queues
  participant PRV as Providers
  SRC->>NS: dispatch {eventCode, recipients, data, dedupeKey, priority}
  NS->>DB: notification_rule → channels, notification_preference, push_device
  NS->>NS: quiet hours → scheduled_for (unless high/emergency)
  NS->>DB: active template for (event, channel, locale) → render Handlebars
  NS->>R: SETNX dedupe (30 days) + com.message_dedupe
  NS->>DB: INSERT outbound_message queued (segments + cost for SMS)
  NS->>Q: job per message (priority lane), delay = scheduled_for
  Q->>PRV: send (rate-limited per provider)
  alt provider error
    Q->>Q: retry with back-off, after 2 failures switch to fallback provider
  end
  PRV-->>DB: DLR / response → status sent / delivered / failed
```

## 14. File upload

```mermaid
sequenceDiagram
  autonumber
  participant C as Client
  participant API as Files
  participant S3 as Object storage
  participant J as ScanJob
  C->>API: POST /files/uploads {purpose, mimeType, size, name}
  API->>API: purpose policy (types, max size, permission)
  API->>API: INSERT stored_file pending + presigned PUT (5 min, content-type and length locked)
  API-->>C: {fileId, uploadUrl}
  C->>S3: PUT bytes
  C->>API: POST /files/{id}/complete
  API->>S3: HEAD (size, etag)
  API->>J: queue files.scan
  J->>S3: stream to ClamAV, magic-byte check, sharp re-encode for images (EXIF stripped)
  J->>API: scan_status clean / infected (object deleted, audit)
  Note over C,API: business use cases accept only clean files, downloads via presigned GET after permission check
```

## 15. Teacher cover (substitution)

```mermaid
sequenceDiagram
  autonumber
  participant HR as HR / HOS
  participant ATT as ATT
  participant ACA as ACA
  participant COM as COM
  HR->>ATT: staff leave approved (event att.staff_leave_decided.v1)
  ATT-->>ACA: subscriber creates open substitutions for affected timetable slots
  HR->>ACA: GET /aca/substitutions/{slotId}/candidates?date=
  ACA->>ACA: free in that period, qualified for subject, not on leave (AttModuleApi), lowest cover load
  HR->>ACA: POST /aca/substitutions {coverStaffId}
  ACA->>ACA: status assigned, outbox aca.cover_assigned.v1
  ACA-->>COM: push + SMS to substitute teacher
  Note over ACA: payable cover periods are counted by HRM ComputePayroll
```

## 16. Payroll

```mermaid
sequenceDiagram
  autonumber
  participant HR as HR officer
  participant HRM as HRM
  participant ATT as AttModuleApi
  participant ACA as AcaModuleApi
  participant WF as WF
  participant DB as PostgreSQL
  HR->>HRM: POST /hrm/payroll-runs {campus, month}
  HR->>HRM: POST /hrm/payroll-runs/{id}/compute (job)
  HRM->>ATT: paid days, LWP, late/overtime per staff
  HRM->>ACA: payable cover periods per staff
  HRM->>HRM: PayrollCalculator (contract components, loans, festival bonus, tax)
  HRM->>DB: payslip + lines (recompute replaces while status computed)
  HR->>HRM: submit → WF payroll (accountant, principal)
  WF-->>HRM: approved → lock (no more changes), bank advice file, payslip PDFs
  HRM->>DB: outbox hrm.payroll_locked.v1 → ACC journal (P2), COM payslip notifications
```
