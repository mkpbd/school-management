# Backend Module Catalogue

What each module owns and does: the use-case classes behind each endpoint, the events it publishes and consumes, and
the public API it offers other modules. The permission codes are the ones in `db/seeds/0001_permissions.sql`. Table
names are the ones in `db/migrations`.

**Notation**
* **Command** = state-changing use case (`UseCase<I,O>`, primary DB, one transaction).
* **Query** = read use case (`Query<I,O>`, replica unless marked *primary*).
* `↑ event` = published via the outbox. `↓ event` = consumed by a subscriber.
* Every endpoint is under `/api/v1`. Only permission codes are listed, because the data scope comes from the role grant.

## Contents

[CORE](#core--platform) · [IAM](#iam--identity--access) · [WF](#wf--approval-workflows) · [AUDIT / SEARCH](#audit--search) ·
[SIS](#sis--student-information) · [ADM](#adm--admission) · [ACA](#aca--academic-structure--timetable) ·
[ATT](#att--attendance--leave) · [LRN](#lrn--teaching--learning) · [EXM](#exm--examinations) · [FEE](#fee--fees--payments) ·
[ACC](#acc--accounts--procurement) · [HRM](#hrm--staff-hr--payroll) · [COM](#com--communication) ·
[PRT](#prt--portals) · [DOC](#doc--documents) · [WEB](#web--public-website-api) · [BI](#bi--dashboards--reports) ·
[TRN](#trn--transport) · [LIB](#lib--library) · [INV](#inv--inventory) · [HLT](#hlt--health--pastoral) ·
[CCA](#cca--co-curricular) · [SEC](#sec--security--pick-up)

---

## CORE — platform

**Owns:** `core.*` · **Features:** CORE-01, 02, 06, 07, 09, 13; ACA-06 calendar

| Command | Permission | Effect |
|---|---|---|
| `CreateCampus`, `UpdateCampus` | `core.master.create/edit` | `core.campus` |
| `CreateAcademicYear`, `DefineTerms`, `OpenAcademicYear`, `LockAcademicYear` | `core.year.*` | `core.academic_year`, `core.term` (exclusion constraints prevent overlaps) |
| `PreviewRollover` → `CommitRollover` | `core.year.approve` | Orchestrates SIS promotion, ACA section copy, FEE structure copy, job-based; ↑ `core.academic_year_rolled_over.v1` |
| `UpsertRoom`, `UpsertShift` | `core.master.*` | `core.room`, `core.shift` |
| `CreateCalendarEvent`, `UpdateCalendarEvent`, `DeleteCalendarEvent` | `core.calendar.*` | `core.calendar_event`; ↑ `core.calendar_changed.v1` (ATT, WEB, COM) |
| `SetHijriAdjustment` | `core.calendar.edit` | `core.hijri_adjustment` |
| `UpdateSetting` | `core.settings.edit` | `core.setting`; ↑ `core.setting_changed.v1` (cache bust) |
| `UpdateNumberFormat` | `core.settings.edit` | `core.number_sequence.format` |
| `UploadImport` → `ValidateImport` (job) → `CommitImport` (job) | `core.import.create/approve` | `sys.import_batch`; commit calls the target module's public bulk API |
| `RequestExport` (job) | `<module>.*.export` | `sys.job_run`, audited |

**Queries:** `ListCampuses`, `GetAcademicCalendar(range, campus)`, `GetSettings`, `GetJob(id)`, `GetImportReport(id)`.
**Endpoints:** `/core/campuses`, `/core/academic-years`, `/core/academic-years/{id}/rollover:preview|commit`,
`/core/terms`, `/core/rooms`, `/core/shifts`, `/core/calendar-events`, `/core/calendar.ics?token=`, `/core/settings/{key}`,
`/core/number-sequences`, `/imports`, `/exports`, `/jobs/{id}`.
**Public API (`CoreModuleApi`):** `getCurrentYear()`, `getYear(id)`, `getTermFor(date)`, `schoolCalendar(campusId, range)`,
`getSetting<T>(key, campusId?)`, `nextNumber({campusId, key, periodKey})`, `isModuleEnabled(code)`.
**Jobs:** `ValidateImportJob`, `CommitImportJob`, `ExportJob`, `PartitionMaintenanceJob`, `PurgeJob`.

---

## IAM — identity & access

**Owns:** `iam.*` · **Features:** CORE-03 RBAC, CORE-10 2FA/SSO, CORE-11 privacy

| Command | Permission | Effect |
|---|---|---|
| `LoginWithPassword` | public | Verify argon2id → MFA challenge or session; `iam.refresh_token`; audit `LOGIN`/`LOGIN_FAILED` |
| `RequestOtp`, `VerifyOtp` | public (rate-limited) | `iam.otp_challenge`; guardian session |
| `VerifyMfa`, `EnrolTotp`, `DisableMfa` | self | `iam.user_account.mfa_*` (secret encrypted) |
| `RefreshSession` | cookie/bearer | Rotate token; reuse → revoke family |
| `Logout`, `LogoutAllDevices` | self | Revoke family / all |
| `RequestPasswordReset`, `ResetPassword`, `ChangePassword` | public / self | Bump `authz_version` |
| `CreateUser`, `InviteUser`, `DisableUser` | `iam.user.*` | `iam.user_account`; ↑ `iam.user_created.v1` |
| `AssignRole`, `RevokeRole` | `iam.role.edit` | `iam.role_assignment`; bump `authz_version`; ↑ `iam.authz_changed.v1` |
| `CreateRole`, `SetRolePermissions` | `iam.role.*` | `iam.role`, `iam.role_permission` (system roles: permissions editable, not deletable) |
| `LinkSsoIdentity` (P2) | self | `iam.external_identity` |
| `RecordConsent`, `RevokeConsent` | guardian self / `sis.guardian.edit` | `iam.consent_record` |
| `ReviewBreakGlass` | `audit.event.view` | `iam.break_glass_access.reviewed_*` |

**Queries:** `GetMe`, `GetMyGrants`, `ListUsers`, `ListRoles`, `GetPermissionMatrix`, `ListBreakGlass`.
**Endpoints:** `/auth/login`, `/auth/otp/request`, `/auth/otp/verify`, `/auth/mfa/verify`, `/auth/refresh`, `/auth/logout`,
`/auth/password/*`, `/me`, `/me/permissions`, `/me/sessions`, `/iam/users`, `/iam/users/{id}/roles`, `/iam/roles`,
`/iam/roles/{id}/permissions`, `/iam/break-glass`.
**Public API (`IamModuleApi`):** `ensureGuardianAccount(phone, name, locale)`, `ensureStudentAccount(studentId, username)`,
`ensureStaffAccount(staffId, email)`, `usersWithRole(roleCode, campusId)`, `disableAccount(userId)`.
**↓ events:** `sis.student_enrolled` (student account for senior years), `hrm.staff_joined/left`, `sis.student_withdrawn`.

---

## WF — approval workflows

**Owns:** `wf.*` · **Features:** CORE-03 approvals (see [cross-cutting §11](cross-cutting.md#11-approval-workflow-engine))

| Command | Permission | Effect |
|---|---|---|
| `SubmitApproval` (public API only) | caller's | `wf.approval_request`, `wf.approval_task`; ↑ `wf.request_submitted.v1` |
| `ActOnApproval` (approve/reject/return/delegate/comment) | `wf.approval.approve` + assignee | `wf.approval_action`, next step tasks; final → ↑ `wf.request_decided.v1` |
| `CancelApproval` | requester | status `cancelled` |
| `SetDelegation` | self | `wf.delegation` |
| `UpdateWorkflowDefinition` | `wf.definition.edit` | new `version` of definition + steps (in-flight requests keep their version) |

**Queries:** `GetInbox`, `GetRequest(id)` (with history), `ListMyRequests`.
**Jobs:** `EscalationJob` (15 min).
**Endpoints:** `/wf/inbox`, `/wf/requests/{id}`, `/wf/requests/{id}/actions`, `/wf/delegations`, `/wf/definitions`.

---

## AUDIT · SEARCH

* **AUDIT** — `GET /audit/events?entity=&id=&actor=&from=&to=` (`audit.event.view`, replica), `GET /audit/events/export`
  (`audit.event.export`, job). `AuditSealJob` (every minute), `AuditVerifyJob` (nightly). App-level events are written
  through `AuditLogger.record(action, details)`.
* **SEARCH** — `GET /search?q=&types=` (grant-filtered). Subscribers: `sis.*_changed`, `hrm.staff_changed`,
  `fee.invoice_issued`, `fee.payment_received`, `adm.application_submitted`. `RebuildSearchIndexJob`.

---

## SIS — student information

**Owns:** `sis.*` · **Features:** SIS-01…10, PRT-07 profile updates

| Command | Permission | Effect / rules |
|---|---|---|
| `CreateStudent` (manual / import) | `sis.student.create` | Family match by guardian phone / NID blind index; `admission_no` from sequence; ↑ `sis.student_changed.v1` |
| `UpdateStudentProfile` | `sis.student.edit` | `If-Match` required; encrypted fields via `FieldCipher` |
| `UpsertGuardian`, `LinkGuardian`, `SetPrimaryContact` | `sis.guardian.*` | `sis.guardian`, `sis.student_guardian` (one primary contact) |
| `MergeFamilies` | `sis.guardian.edit` | Moves students/guardians, re-points open invoices via FEE API |
| `EnrolStudent` (public API for ADM, rollover) | `sis.enrolment.edit` | `sis.enrolment` (exclusion constraint); roll number rule; ↑ `sis.student_enrolled.v1` |
| `AllocateSections` (bulk, balancing by gender/score) | `sis.enrolment.edit` | Preview → commit |
| `TransferSection` / `TransferCampus` | `sis.enrolment.approve` | Close enrolment + new one (`previous_enrolment_id`); ↑ `sis.student_transferred.v1` |
| `GenerateRollNumbers` | `sis.enrolment.edit` | Rule: alphabetical / by admission / by score |
| `PreviewPromotion` → `CommitPromotion` | `sis.promotion.approve` | `PromotionPolicy` (results, attendance, conditions) → next-year enrolments |
| `UploadStudentDocument`, `VerifyDocument` | `sis.document.*` | Only `clean` files |
| `RecordSenNeeds` | `sis.sen.create/edit` (sensitive) | `sis.sen_record` (encrypted); ↑ `sis.access_arrangements_changed.v1` → EXM |
| `RequestWithdrawal` → `RecordClearance` → `CompleteWithdrawal` | `sis.withdrawal.*` | Clearance asks FEE/LIB/TRN/INV public APIs; TC via DOC; ↑ `sis.student_withdrawn.v1` |
| `IssueIdCards` (batch) | `sis.id_card.create` | `sis.id_card_issue`; PDF job; reissue fee via FEE |
| `RequestProfileChange` (guardian) → `DecideProfileChange` | `prt` / `sis.profile_change.approve` | `sis.profile_change_request` |
| `ConvertToAlumni` | `sis.student.edit` | `sis.alumni_profile` |

**Queries:** `SearchStudents` (keyset, scoped), `GetStudent360` (profile + enrolment history + guardians + flags; timeline
via other modules' APIs, SIS-09), `GetFamily`, `ListSectionRoster`, `StrengthReport`, `MissingDocumentsReport`.
**Endpoints:** `/sis/students`, `/sis/students/{id}`, `/sis/students/{id}/guardians`, `/sis/students/{id}/documents`,
`/sis/families/{id}`, `/sis/enrolments:bulk-allocate`, `/sis/enrolments/{id}/transfer`, `/sis/sections/{id}/rolls:generate`,
`/sis/promotions:preview|commit`, `/sis/withdrawals`, `/sis/id-cards:batch`, `/sis/profile-change-requests`.
**Public API (`SisModuleApi`):** `getActiveEnrolment(studentId, on?)`, `getEnrolmentsForSection(sectionId, on)`,
`createStudentWithFamily(snapshot)`, `enrol(cmd)`, `getPrimaryContact(studentId)`, `getFeePayerContact(familyId)`,
`getGuardiansForStudents(ids)`, `isGuardianOf(guardianId, studentId)`, `childrenOfGuardian(guardianId)`,
`studentIdsForAudience(spec)`, `accessArrangements(studentId)`.
**↓ events:** `wf.request_decided` (transfers), `adm.offer_accepted` is *not* consumed (ADM calls SIS synchronously).

---

## ADM — admission

**Owns:** `adm.*` · **Features:** ADM-01…10, WEB-02

| Command | Permission | Effect / rules |
|---|---|---|
| `CaptureEnquiry` (staff / website API) | `adm.enquiry.create` / API key | `adm.enquiry` (source, UTM); spam: captcha + rate limit |
| `LogEnquiryActivity`, `MoveEnquiryStage`, `AssignCounsellor` | `adm.enquiry.edit` | `adm.enquiry_activity` |
| `StartApplication` (guardian) | public + OTP | Guardian account via IAM; `adm.application` draft |
| `SaveApplicationDraft`, `UploadApplicationDocument`, `SubmitApplication` | applicant / `adm.application.edit` | `application_no` on submit; application-fee invoice via FEE; ↑ `adm.application_submitted.v1` |
| `ScheduleTestSession`, `AssignCandidates`, `RecordTestScores`, `RecordInterview` | `adm.test.*` | `adm.test_session`, `adm.test_candidate`; admit cards via DOC |
| `GenerateMeritList` → `ApproveMeritList` | `adm.merit.create/approve` | `SelectionPolicy` (age cut-off, scores, sibling/staff bonus, seats) → `adm.merit_list(_entry)` |
| `IssueOffers` | `adm.offer.create` | `adm.offer` + letter (DOC); ↑ `adm.offer_issued.v1` |
| `AcceptOffer` / `DeclineOffer` (guardian) | applicant | Admission invoice (FEE API); decline → promote waitlist |
| `EnrolApplicant` | `adm.enrolment.create` or auto on payment | One transaction: SIS `createStudentWithFamily` + `enrol`, IAM accounts, FEE `assignFeePlan` + auto concessions; `adm.enrolment_conversion` makes it idempotent; ↑ `adm.applicant_enrolled.v1` |
| `ExpireOffers` (job) | system | `issued` past expiry → `expired`; promote waitlist |

**Queries:** `EnquiryPipeline`, `ApplicationList`, `SeatAvailability`, `AdmissionFunnelReport`, `SourceRoi`.
**↓ events:** `fee.payment_received` (if the admission invoice is paid and setting `adm.enrol_on_payment` → `EnrolApplicant`).
**Public API:** `getApplicationSummary(id)` (for FEE invoices / portal).

---

## ACA — academic structure & timetable

**Owns:** `aca.*` · **Features:** ACA-01…09

| Command | Permission | Effect / rules |
|---|---|---|
| `UpsertProgramme`, `UpsertYearGroup`, `UpsertSubject`, `UpsertSubjectGroup`, `SetCurriculum` | `aca.structure.*` | Curriculum per year |
| `CreateSections`, `CopySectionsFromYear` | `aca.structure.create` | `aca.class_section` |
| `AssignClassTeacher` | `aca.allocation.edit` | ↑ `aca.allocation_changed.v1` (scope cache bust) |
| `CreateTeachingGroups` (auto from sections + electives), `AllocateTeacher`, `SetGroupMembers` | `aca.allocation.edit` | `aca.teaching_group(_teacher/_member)` |
| `DefineBellSchedule` (regular / Ramadan) | `aca.timetable.edit` | `aca.period_definition` |
| `EditTimetableSlots` (bulk), `AutoGenerateTimetable` (job, P2) | `aca.timetable.edit` | DB uniqueness prevents teacher/room/group clashes |
| `ValidateTimetable` → `PublishTimetable` | `aca.timetable.approve` | `TimetableClashChecker`: student clashes, max periods/day, consecutive limits; ↑ `aca.timetable_published.v1` |
| `SuggestCover` (query) → `AssignCover` | `aca.substitution.*` | Candidates = free + qualified + not on leave (ATT API); `aca.substitution`; ↑ `aca.cover_assigned.v1` |
| `ReportSyllabusCoverage`, `ReviewCoverage` | `aca.syllabus.*` | `aca.syllabus_coverage` |

**Queries:** `TeacherLoadReport`, `TimetableView(class|teacher|room)`, `MyDay` (class-teacher dashboard), `FreeTeachersAt(slot, date)`.
**Public API (`AcaModuleApi`):** `sectionsOfClassTeacher(staffId)`, `teachingGroupsOfTeacher(staffId)`, `membersOf(groupId, on)`,
`slotsFor(date, campusId)`, `periodsOfDay(campusId, date)`, `sectionInfo(id)`.
**↓ events:** `att.staff_leave_decided` (open substitutions for affected slots), `core.calendar_changed`.

---

## ATT — attendance & leave

**Owns:** `att.*` · **Features:** ATT-01…08

| Command | Permission | Effect / rules |
|---|---|---|
| `GetRegisterSheet` (query, *primary*) | `att.daily.view` | Roster + approved leave + device arrivals pre-filled |
| `MarkDailyAttendance` (whole section) | `att.daily.edit` (own_classes) | Upsert `att.student_daily_attendance` (one row per student/day); edit window from settings; changed absent/late → ↑ `att.student_marked_absent/late.v1`; idempotent |
| `MarkPeriodAttendance` | `att.period.edit` | `att.period_attendance` |
| `SyncOfflineAttendance` | `att.daily.edit` | Batch of the two above with per-item idempotency keys |
| `CorrectAttendance` (after window) | `att.correction.create` → approve | `source='correction'`, audited |
| `IngestDeviceEvents` (device API) | device HMAC | `att.device_event` (dedupe `bridge_seq`) → job maps credential → student/staff → arrival time / staff punch |
| `ApplyStudentLeave` (guardian) → `DecideStudentLeave` | `att.student_leave.create/approve` | Workflow `student_leave`; approved → auto-mark `leave` for those days; ↑ `att.leave_decided.v1` |
| `PunchStaffAttendance` (geo / device) | self / device | `att.staff_attendance` (late/early/overtime by shift rules) |
| `ApplyStaffLeave` → decide via WF | `att.staff_leave.create` | `LeaveDayCounter` (holiday-aware) → `att.staff_leave_balance.pending_days`; approved → `taken_days`; ↑ `att.staff_leave_decided.v1` |
| `AccrueLeaveBalances` (yearly job) | system | Entitlements + carry forward |
| `EvaluateThresholds` (nightly job) | system | Attendance % → `att.attendance_flag`; ↑ `att.threshold_breached.v1` |

**Queries:** `StudentAttendanceSummary(term)`, `SectionMonthlyRegister`, `DailyAbsentees(campus, date)`, `ChronicAbsentees`,
`StaffAttendanceReport`, `LeaveCalendar`, `LeaveBalances`.
**Public API (`AttModuleApi`):** `attendancePercent(studentId, range)`, `isStaffOnLeave(staffId, date)`, `staffOnLeave(campusId, date)`,
`attendanceSummaryForPayroll(staffId, month)`, `eligibility(studentId, examId)`.
**↓ events:** `wf.request_decided` (leave), `core.calendar_changed` (recount pending leave days).

---

## LRN — teaching & learning

**Owns:** `lrn.*` · **Features:** LRN-01…09

| Command | Permission | Effect |
|---|---|---|
| `AssignHomework`, `UpdateHomework`, `CloseHomework` | `lrn.homework.*` (own_subjects) | `lrn.homework`; ↑ `lrn.homework_assigned.v1` |
| `SubmitHomework` (student) | self | `lrn.homework_submission` (late flag by policy) |
| `GradeSubmission`, `ReturnSubmission` | `lrn.homework.edit` | score/feedback; optional gradebook link |
| `PublishClassDiary` | `lrn.diary.edit` (own_classes) | `lrn.class_diary`; ↑ `lrn.diary_published.v1` |
| `UploadResource`, `RemoveResource` | `lrn.resource.*` | `lrn.learning_resource`; download counter via event |
| `CreateGradebookItem`, `RecordGradebookScores`, `ModerateGradebook` | `lrn.gradebook.*` | `lrn.gradebook_item/score` |
| `SubmitLessonPlan` → `ReviewLessonPlan` (P2) | `lrn.lesson_plan.*` | `lrn.lesson_plan` |
| `ScheduleOnlineSession`, `ImportJoinLog` (P2) | `lrn.homework.create` | `lrn.online_session(_join)` → period attendance via ATT API |
| `AuthorQuestion`, `CreateQuiz`, `StartAttempt`, `SubmitAttempt`, `ModerateAttempt` (P2/P3) | `lrn.quiz.*` / student | auto-marking for objective types |
| `SetLearnerTargets` (P2) | `lrn.gradebook.edit` | `lrn.learner_target` |

**Public API:** `continuousAssessment(studentId, groupId, termId)` (for EXM CA components), `homeworkDue(studentIds, range)` (portal).
**Jobs:** `HomeworkDueReminderJob` (daily).

---

## EXM — examinations

**Owns:** `exm.*` · **Features:** EXM-01…12

| Command | Permission | Effect / rules |
|---|---|---|
| `UpsertGradingScheme` (new version) | `exm.grading.edit` | `exm.grading_scheme`, `exm.grade_band` (no overlaps) |
| `CreateExam`, `AddPapers`, `ScheduleDateSheet` → `ValidateDateSheet` → `PublishSchedule` | `exm.exam.*` | Elective clash check per student; ↑ `exm.schedule_published.v1` |
| `GenerateSeating` → `GenerateAdmitCards` (job) | `exm.exam.edit` | `exm.seat_allocation`; ineligible (ATT/FEE clearance) flagged; PDFs; ↑ `exm.admit_cards_ready.v1` |
| `AssignInvigilators` | `exm.exam.edit` | `exm.invigilation` |
| `EnterMarks` (grid), `UploadMarksExcel` (job with preview) | `exm.mark.edit` (own_subjects) | Append `exm.mark_entry` versions (reason required for version > 1); trigger maintains `mark_current`; locked papers rejected by DB |
| `EnterVerificationRound` (double entry) | `exm.mark.edit` | `entry_round = 2`; `VerifyDoubleEntry` lists mismatches |
| `SubmitPaper` → `ModeratePaper` / `ReturnPaper` → `LockPaper` | `exm.mark.edit` / `approve` | `exm.exam_paper.status` + `exm.paper_status_history` |
| `RequestReopen` → WF `marks_reopen` → `ReopenPaper` | `exm.mark.approve` | status `reopened` |
| `ComputeResults` (job) | `exm.result.approve` | `GradeCalculator` (component weights, CA from LRN, scheme version) → `exm.result_subject/summary`, ranks, attendance % (ATT API) |
| `GenerateReportCards` (job, batch) | `exm.report_card.create` | DOC templates per programme; `exm.report_card` (+ verification code) |
| `PublishResults` | `exm.result.approve` | Freeze results; `published_at`; embargo respected; ↑ `exm.results_published.v1` (portal cache warm, notifications in waves) |
| `RegisterCandidates`, `CreateEntries`, `ExportEntries` (P2) | `exm.external.*` | `exm.candidate`, `exm.external_entry`; entry fees via FEE; awarding-body file export |
| `ImportExternalResults` (P2) | `exm.external.edit` | `exm.external_result`; value-added analysis |
| `SubmitPredictedGrade` → approve (P2) | `exm.external.*` | `exm.predicted_grade` |

**Queries:** `MarkSheet(paperId)`, `TabulationSheet(examId, section)`, `ResultAnalysis(examId)` (replica; also `bi.exam_result_stats`),
`Transcript(studentId)`, `StudentResult(studentId, examId)` (portal — published only).
**Public API (`ExmModuleApi`):** `publishedResults(studentId)`, `termResultsForPromotion(enrolmentIds, yearId)`, `upcomingExams(studentIds)`.
**↓ events:** `sis.access_arrangements_changed`, `att.threshold_breached` (eligibility).

---

## FEE — fees & payments

**Owns:** `fee.*` · **Features:** FEE-01…11, PRT-03

| Command | Permission | Effect / rules |
|---|---|---|
| `UpsertFeeHead`, `CreateFeeStructure`, `ActivateFeeStructure`, `CopyStructuresToYear` | `fee.structure.*` | One active structure per campus/year/year group |
| `AssignFeePlan` (public API) | system / `fee.structure.edit` | Links enrolment to structure; `fee.student_fee_item` for extras |
| `RequestConcession` → WF → `ApplyConcessionDecision` | `fee.concession.create/approve` | `fee.student_concession`; auto sibling/staff-ward rules |
| `CreateBillingRun` → `PreviewBillingRun` (job) → `PostBillingRun` (job) | `fee.billing.create/approve` | `InvoiceBuilder` (structure + items + concessions + carry-forward) per enrolment, chunked; `ux_invoice_period` prevents double billing; ↑ `fee.invoice_issued.v1` per invoice |
| `CreateAdhocInvoice`, `IssueInvoice` | `fee.invoice.create` | Draft → issued (trigger guards) |
| `AddAdjustmentLine` | `fee.invoice.edit` + approval over threshold | Negative/positive adjustment line on issued invoice |
| `VoidInvoice` | `fee.invoice.delete` | Only if nothing paid (DB guard) |
| `OpenCashSession`, `CloseCashSession`, `VerifyCashSession` | `fee.cash_session.*` | Expected vs counted; variance |
| `RecordCounterPayment` | `fee.payment.create` | Lock invoices (same family/campus) → `fee.payment` + allocations (oldest due first, priority) + `fee.receipt`; credit for surplus; ↑ `fee.payment_received.v1` |
| `StartOnlinePayment` | `prt.payment.create` / pay-link token | `fee.gateway_transaction` (initiated) + provider session → redirect URL |
| `HandleGatewayCallback` (IPN) | webhook | Log raw; verify signature; server validation; idempotent → payment + allocations + receipt; mismatch → `amount_mismatch` alert |
| `SweepPendingGatewayTransactions` (job) | system | Query provider status for stuck attempts |
| `ReversePayment` (bounced cheque, error) | `fee.payment.approve` + WF | Negative allocations; payment `reversed`; ↑ `fee.payment_reversed.v1` |
| `RequestRefund` → WF → `MarkRefundPaid` (P2) | `fee.refund.*` | `fee.refund`; gateway refund via adapter when supported |
| `ApplyLateFees` (job) | system | `LateFeeCalculator` → fine lines (`source_ref` idempotent) |
| `SendFeeReminders` (job) | system | Offsets T-3/0/+7/+15 → COM; principal shortlist report |
| `ImportSettlementFile` → `MatchSettlement` (job) → `ResolveException` (P2) | `fee.reconciliation.*` | `fee.settlement_file/line` |
| `IssueFeeClearance` | `fee.invoice.view` | Clearance status for TC / admit cards (public API) |

**Queries:** `FamilyStatement(familyId)`, `OutstandingForFamily` (*primary*), `InvoiceLookup(code)` (cashier QR), `DueList`, `Aging`,
`DailyCollection(by cashier/channel/head)`, `ConcessionRegister`, `CollectionVsTarget`, `ReceiptRegister`.
**Public API (`FeeModuleApi`):** `assignFeePlan(enrolmentId)`, `addStudentFeeItem(cmd)` (TRN/CCA), `removeStudentFeeItem(sourceRef)`,
`raiseCharge({studentId, headCode, amount, sourceRef})` (LIB fines, INV POS, SIS id-card, EXM entries), `createAdmissionInvoice(offer)`,
`clearanceStatus(studentId)`, `familyDues(familyId)`.
**↓ events:** `sis.student_enrolled` (plan), `sis.student_withdrawn` (stop billing, prorate), `trn.assignment_changed`, `lib.fine_raised`,
`wf.request_decided` (concession/refund/reversal), `adm.offer_accepted`.
**Ports:** `PaymentGateway` (SSLCommerz, bKash, Nagad, aamarPay), `SettlementParser`, `ReceiptRenderer`.

---

## ACC — accounts & procurement (P2/P3)

**Owns:** `acc.*` · **Features:** ACC-01…06, FEE-11

| Command | Permission | Effect |
|---|---|---|
| `PostJournal` (manual voucher) | `acc.journal.create` (+ approval) | `acc.journal(_line)`; deferred balance trigger; period must be open |
| `ReverseJournal` | `acc.journal.approve` | New journal `reversal_of_id` |
| `LockFiscalPeriod` | `acc.journal.approve` | `acc.fiscal_period.status` |
| `AutoPostFromEvent` (subscriber) | system | `fee.payment_received` → Dr Cash/Bank/Gateway clearing, Cr Receivable; `fee.invoice_issued` → Dr Receivable, Cr Income (by fee head mapping); `hrm.payroll_locked` → salary journal; idempotent via `ux_journal_source` |
| `CreateBudget`, `ApproveBudget` (P3) | `acc.budget.*` | `acc.budget(_line)` |
| `RaiseRequisition` → WF → `CompareQuotations` → `IssuePurchaseOrder` → `ReceiveGoods` → `RecordSupplierBill` → `PayBill` (P3) | `acc.procurement.*` | Goods receipt → INV stock movement via INV API |
| `SyncToExternalPackage` (job, P2) | system | `acc.connector_mapping` → file/API export |

**Queries:** `TrialBalance`, `GeneralLedger`, `IncomeStatement`, `BalanceSheet`, `CashBook`, `BudgetVsActual`.

---

## HRM — staff, HR & payroll

**Owns:** `hrm.*` · **Features:** HRM-01…08

| Command | Permission | Effect |
|---|---|---|
| `HireStaff` / `CreateStaff`, `UpdateStaff` | `hrm.staff.*` (sensitive) | `hrm.staff` (encrypted NID/TIN/bank); IAM account; ↑ `hrm.staff_joined.v1` |
| `AddQualification`, `UploadStaffDocument` | `hrm.staff.edit` | expiry alerts |
| `CreateContract`, `SetSalaryComponents` | `hrm.payroll.create` | `hrm.contract` (no overlaps), `hrm.contract_component` |
| `CreatePayrollRun` → `ComputePayroll` (job) → `SubmitPayroll` → WF → `LockPayroll` → `MarkPaid` | `hrm.payroll.*` | `PayrollCalculator`: paid days (ATT), LWP, cover periods (ACA), overtime, loans, tax; `hrm.payslip(_line)`; bank advice file; payslip PDFs; ↑ `hrm.payroll_locked.v1` |
| `GrantLoan`, `RecordLoanRecovery` | `hrm.payroll.create` | `hrm.staff_loan` |
| `PublishVacancy`, `ReceiveApplication` (public), `MoveCandidate`, `ScheduleInterview`, `ScoreInterview`, `MakeOffer`, `HireCandidate` (P2) | `hrm.recruitment.*` | `hrm.vacancy`, `hrm.job_application`, `hrm.interview` |
| `StartOnboarding`, `CompleteTask`, `StartSeparation`, `CompleteSeparation` (P2) | `hrm.staff.edit` | `hrm.lifecycle_task`, `hrm.separation`; ↑ `hrm.staff_left.v1` |
| `OpenAppraisalCycle`, `SubmitSelfReview`, `SubmitReview`, `RecordLessonObservation` (P2) | `hrm.appraisal.*` | |
| `RecordCpd` (P3) | self / `hrm.staff.edit` | `hrm.cpd_record` |

**Queries:** `StaffDirectory`, `StaffProfile`, `MyPayslips` (self), `PayrollSheet`, `HeadcountReport`, `ContractExpiry`.
**Public API (`HrmModuleApi`):** `staffSummary(id)`, `staffOfCampus(campusId)`, `reportingManager(staffId)`, `isStaffGuardian(guardianId)`.

---

## COM — communication

**Owns:** `com.*` · **Features:** COM-01…10, CORE-07 (see [cross-cutting §12](cross-cutting.md#12-notification-hub))

| Command | Permission | Effect |
|---|---|---|
| `CreateNotice`, `PublishNotice`, `WithdrawNotice` | `com.notice.*` | `com.notice`, `com.notice_audience`; resolves audience via SIS/ACA/HRM; web flag; ↑ `com.notice_published.v1` |
| `MarkNoticeRead` | self | `com.notice_read` |
| `UpsertTemplate` (new version) → `ActivateTemplate` | `com.template.edit/approve` | `com.message_template` |
| `SendBulkMessage` (ad-hoc SMS/e-mail to an audience) | `com.notice.create` | cost estimate first; job fan-out |
| `SendEmergencyBroadcast` | `com.broadcast.create` | `com.broadcast`; priority lane |
| `NotificationService.dispatch` (internal) | system | `com.outbound_message` + channel jobs |
| `RecordDeliveryReport` (webhook) | provider | status updates |
| `RegisterPushDevice`, `UpdatePreferences` | self | `com.push_device`, `com.notification_preference` |
| `StartConversation`, `PostMessage`, `HideMessage`, `EscalateConversation` (P2) | `com.message.*` | moderated; office hours; retention |
| `PublishPtmSlots`, `BookPtmSlot`, `RecordPtmNotes` (P2) | `com.message.create` / guardian | one booking per slot (PK) |
| `CreateSurvey`, `SubmitSurveyResponse` (P2) | `com.notice.create` / respondent | anonymity via `respondent_hash` |
| `RaiseComplaint`, `AssignComplaint`, `ResolveComplaint` (P2) | guardian / `com.complaint.edit` | SLA timers |

**Queries:** `Inbox`, `NoticeList(audience)`, `NoticeReadReport`, `DeliveryReport`, `SmsUsageAndCost`.
**Public API (`ComModuleApi`):** `dispatch(notification)`, `estimateSms(text)`.
**↓ events:** almost all notification-worthy events (Appendix C catalogue).

---

## PRT — portals

**Owns:** `prt.*` (forms) and the portal **aggregator** queries. **Features:** PRT-01…10

PRT owns little data of its own. It composes other modules' public APIs into mobile-friendly payloads. Every query
checks `own_children` or `self` first.

| Query / command | Composes |
|---|---|
| `GetFamilyHome` (all children) | SIS children + ATT today + LRN due homework + FEE dues + EXM upcoming + COM unread notices |
| `GetChildDashboard(childId)` | same, one child + timetable (ACA) |
| `GetChildAttendance`, `GetChildHomework`, `GetChildResults` (published only, cached), `GetChildTimetable` | ATT, LRN, EXM, ACA |
| `GetFamilyInvoices`, `PayInvoices` | FEE (`StartOnlinePayment`) |
| `ApplyLeave` | ATT `ApplyStudentLeave` |
| `RequestProfileUpdate` | SIS |
| `ListForms`, `SubmitForm` (P2) | `prt.form_definition`, `prt.form_submission` + `iam.consent_record`; ↑ `prt.form_submitted.v1` (CCA event consent) |

Payloads are small, support `?fields=`, carry an `ETag`, and are served under `Cache-Control: private, max-age=60`.

---

## DOC — documents

**Owns:** `doc.*` · **Features:** DOC-01…05 (see [cross-cutting §14](cross-cutting.md#14-documents--pdf-rendering))

| Command | Permission | Effect |
|---|---|---|
| `UpsertTemplate`, `ActivateTemplate` | `doc.template.edit` | `doc.template` versions |
| `IssueDocument` (TC, character, bonafide, ...) | `doc.document.create` (+ WF if `requires_approval`) | serial number, `doc.issued_document` snapshot, render job; ↑ `doc.document_issued.v1` |
| `ReprintDocument`, `RevokeDocument` | `doc.document.approve` | `print_count`, `revoked_*` |
| `GenerateBulkLetters` | `doc.document.create` | mail-merge job + delivery tracking via COM |
| `VerifyDocument` (public) | none (rate-limited) | returns `public_fields` only (also report cards, receipts) |

**Public API (`DocModuleApi`):** `render(templateCode, data, locale)`, `issue(cmd)`, `verificationUrl(code)`.

---

## WEB — public website API

**Owns:** `web.*` · **Features:** WEB-01…06

Read-only, API-key protected, CDN-cached (`Cache-Control: public, s-maxage=60, stale-while-revalidate=300`):
`GET /public/v1/notices`, `/events`, `/calendar`, `/news`, `/news/{slug}`, `/gallery`, `/vacancies`, `/verify/{code}`,
`/results/lookup` (roll + DoB + OTP, P2). Write endpoints: `POST /public/v1/admission/enquiries`, `/admission/applications`
(captcha), `/careers/applications`. Admin commands: `UpsertNewsPost`, `UpsertGalleryAlbum`, `AddPhotos` (consent check: photos with
`contains_students` publish only if consent verified), `CreateApiClient`, `RotateApiKey`.
**Jobs:** `RevalidateWebsiteJob` (calls Next.js on-demand revalidation webhook after publish events).

---

## BI — dashboards & reports

**Owns:** `bi.*` · **Features:** BI-01…07, Appendix B

| Component | Design |
|---|---|
| KPI refresh | `RefreshKpiJob` every 15 min recomputes today's and yesterday's rows in `bi.campus_daily_kpi`, `bi.section_attendance_daily`, `bi.fee_aging`; `exm.results_published` → `bi.exam_result_stats` |
| Dashboards | `GET /bi/dashboards/{principal\|campus\|accounts\|admission\|hr\|teacher}`: read only `bi.*` (fast) plus a few live counters |
| Campus comparison | `GET /bi/campus-comparison?metric=&range=` |
| Standard reports | Report catalogue (Appendix B) = registered `ReportDefinition` classes: parameters (Zod), SQL on the replica, columns, Excel/PDF exporters; small → inline, large → job |
| Ad-hoc builder (P2) | Whitelisted datasets (views with RLS) + field/filter/group model → safe SQL builder; saved in `bi.saved_report`; scheduled e-mail (BI-05) |
| Early warning (P3) | Nightly scoring job (attendance decline, grade drop, fee delinquency, behaviour) → flags to heads of section |
| Board returns (P2) | Export templates per authority |

All reports run under the user's RLS context. Every export is audited.

---

## TRN — transport

**Owns:** `trn.*` · **Features:** TRN-01…06

| Command | Effect |
|---|---|
| `UpsertVehicle`, `AddVehicleDocument`, `AssignCrew` | expiry alerts job |
| `UpsertRoute`, `SetRouteStops`, `SetZoneFees` | `trn.route_stop` ordering |
| `AssignStudentTransport` / `ChangeAssignment` / `EndAssignment` | capacity check (`FOR UPDATE` on route), exclusion constraint on overlaps; FEE `addStudentFeeItem` with proration; ↑ `trn.assignment_changed.v1` |
| `IngestGpsBatch` (P3) | `trn.gps_ping` partitions; geofence/ETA/speed alerts via COM |
| `RecordBoardingScan` (P3) | `trn.boarding_event` → guardian push |
| `LogFuel`, `LogMaintenance` (P3) | cost reports |

---

## LIB — library

**Owns:** `lib.*` · **Features:** LIB-01…06

| Command | Effect |
|---|---|
| `CatalogueTitle` (ISBN lookup adapter), `AddCopies`, `PrintLabels` | `lib.book_title`, `lib.book_copy` |
| `IssueBook` | member policy limits; partial unique index = one active loan per copy |
| `ReturnBook`, `RenewLoan` | overdue fine → FEE `raiseCharge` (`source_ref = lib:{circulationId}`); ↑ `lib.fine_raised.v1` |
| `ReserveTitle`, `FulfilReservation` | queue; notifications |
| `StartStockTake`, `ScanCopy`, `CompleteStockTake` (P3) | missing/damaged report |
| `OverdueReminderJob` (daily) | COM notifications |

**Public API:** `clearanceStatus(studentId)` (withdrawal / exams).

---

## INV — inventory, POS & assets

**Owns:** `inv.*` · **Features:** INV-01…06

| Command | Effect |
|---|---|
| `UpsertItem`, `AddVariant`, `SetStockLevels` | master data |
| `ReceiveStock` (from PO or direct), `IssueStock`, `AdjustStock`, `WriteOff` | append `inv.stock_movement`; trigger maintains `inv.stock_balance` (never negative) |
| `RequestTransfer` → WF → `DispatchTransfer` → `ReceiveTransfer` | paired `transfer_out`/`transfer_in` |
| `CompletePosSale` | lock balances, movements `sale`, charge to student account (FEE `raiseCharge`) or immediate payment |
| `ReturnPosSale` | `sale_return` movements, credit via FEE adjustment |
| `RegisterAsset`, `MoveAsset`, `VerifyAsset`, `DisposeAsset`, `RunDepreciation` (P3) | `inv.asset`, `inv.asset_event` |
| `RaiseTicket`, `AssignTicket`, `CompleteTicket`, `SignOffTicket` (P3) | SLA timers |
| `LowStockAlertJob` (daily) | min levels → ↑ `inv.stock_low.v1` |

---

## HLT — health & pastoral

**Owns:** `hlt.*` · **Features:** HLT-01…07

| Command | Effect / rules |
|---|---|
| `UpdateHealthProfile` | encrypted fields; `alert_summary` is the only text visible to class teachers |
| `RecordSickbayVisit` | notify guardian (COM) on `sent_home` / `referred_hospital`; repeated-visit alert (3 in 14 days) |
| `RecordCheckup` (batch for camps) | BMI generated column |
| `RecordBehaviour` (merit/demerit/incident) | points → CCA house points via event; guardian notification by category |
| `OpenCounsellingCase`, `AddCounsellingNote`, `CloseCase` | sensitive: break-glass + encrypted notes |
| `RaiseSafeguardingConcern`, `TriageConcern`, `EscalateConcern`, `AddAction` | restricted to DSL roles; escalation chain; audit |
| `OpenBullyingCase`, `RecordInvestigationStep`, `CloseBullyingCase` | follow-up reminders |

---

## CCA — co-curricular, houses, Islamic values

**Owns:** `cca.*` · **Features:** CCA-01…08

| Command | Effect |
|---|---|
| `CreateClub`, `OpenSignup`, `JoinClub` (student/guardian), `LeaveClub`, `RecordSession` | capacity + waitlist; activity fee via FEE `addStudentFeeItem` |
| `AwardHousePoints` (manual) / subscriber on `hlt.behaviour_recorded`, results | append `cca.house_point`; leaderboard query |
| `PlanEvent`, `RequestConsents` (PRT forms), `RecordParticipation`, `RecordCompetitionResult` | consent status from `prt.form_submitted` |
| `GiveAward` | certificate via DOC |
| `DefineQuranMilestones`, `RecordQuranProgress` | per-student milestone status |
| `CreateDonationDrive`, `RecordDonation` (P3) | separate receipts (never `fee.*`) |

---

## SEC — security & safe pick-up

**Owns:** `sec.*` · **Features:** SEC-01…05

| Command | Effect / rules |
|---|---|
| `PreRegisterVisitor`, `CheckInVisitor` (photo, ID → encrypted + blind index, watch-list check), `CheckOutVisitor` | host notification (COM) |
| `AuthorisePickup` (guardian in portal: standing / ad-hoc with OTP or QR), `RevokePickup` | `sec.pickup_authorisation` |
| `ReleaseStudent` (gate app) | verifies an active authorisation for that student and time (photo/OTP/QR) → append `sec.pickup_log`; ↑ `sec.student_released.v1` → guardian push |
| `IngestGateEvents` | `sec.gate_event`; student `in` scans feed ATT arrival; late slips |
| `IssueEarlyLeavePermit` | requires a pickup authorisation |
| `ScheduleDrill`, `RecordRollCall`, `CloseDrill` (P3) | missing-student report |

---

## Cross-module call matrix (synchronous public-API calls)

| Caller ↓ / Callee → | core | iam | sis | aca | att | lrn | exm | fee | hrm | doc | wf | com |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| sis | ● | ● |  | ● |  |  |  | ● (withdrawal) |  | ● | ● |  |
| adm | ● | ● | ● | ● |  |  |  | ● |  | ● |  |  |
| aca | ● |  | ● |  | ● |  |  |  | ● |  | ● |  |
| att | ● |  | ● | ● |  |  |  |  | ● |  | ● |  |
| exm | ● |  | ● | ● | ● | ● |  | ● |  | ● | ● |  |
| fee | ● |  | ● |  |  |  |  |  |  | ● | ● |  |
| hrm | ● | ● |  | ● | ● |  |  |  |  | ● | ● |  |
| prt | ● |  | ● | ● | ● | ● | ● | ● |  |  |  | ● |
| trn/lib/inv/cca |  |  | ● |  |  |  |  | ● | ● | ● | ● |  |

Everything not marked here happens through events.
