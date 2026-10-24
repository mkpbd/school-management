"""Generate db/migrations/0090_comments.sql: COMMENT ON TABLE / COLUMN for the whole schema.

Sources:
  * TABLE_DESC below (one-line purpose of every table)            -> table comment
  * inline '-- text' after a CREATE TABLE line (feature ids etc.)  -> appended to the table comment
  * inline '-- text' after a column definition                     -> column comment
Run:  python db/tools/gen_comments.py   (then migrate; 0090_comments is a repeatable migration)
"""
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parents[1]
MIG = ROOT / "migrations"

TABLE_DESC = {
    # core
    "core.organisation": "Top-level tenant (the school group); future sister schools are separate organisations.",
    "core.campus": "Physical campus (Dhanmondi, Gulshan, Lalmatia, ...); first-class scope on every transactional row.",
    "core.org_module": "Feature switch per organisation and module (ships P2/P3 modules dark).",
    "core.academic_year": "School year with lifecycle planned > open > closing > locked > archived; no overlaps per organisation.",
    "core.term": "Term/semester inside an academic year; no overlapping terms.",
    "core.shift": "Campus shift (morning/day) with start and end time.",
    "core.room": "Classroom, lab, hall or other room with capacity; used by timetable, exams and bookings.",
    "core.calendar_event": "Academic calendar: holidays (national/Islamic/school), exam windows, PTMs and events.",
    "core.hijri_adjustment": "Moon-sighting offsets applied to the computed Hijri calendar per month.",
    "core.lookup_value": "School-configurable dropdown lists (lead sources, document types, reasons, categories).",
    "core.setting": "Key/value settings; campus rows override organisation defaults.",
    "core.number_sequence": "Gap-free counters for admission, invoice, receipt, certificate numbers (row-locked).",
    "core.std_cols": "Template only (no rows): standard audit and optimistic-concurrency columns.",
    # iam
    "iam.user_account": "Login identity for staff, guardians, students and system users.",
    "iam.external_identity": "Linked Google/Microsoft SSO identity of a user.",
    "iam.role": "Role (Principal, Class Teacher, Accountant, Parent, ...); system roles are seeded.",
    "iam.permission": "Global permission catalogue: module.resource.action.",
    "iam.role_permission": "Permission granted to a role, with its data scope (org/campus/section/own classes/own children/self).",
    "iam.role_assignment": "Role held by a user, scoped to the organisation or one campus, with validity dates.",
    "iam.refresh_token": "Rotating refresh tokens grouped by login family for reuse detection.",
    "iam.otp_challenge": "One-time passwords (hashed) for login, MFA, password reset and verification.",
    "iam.consent_record": "Guardian consents (data processing, photo/media, medical, trips) with policy version.",
    "iam.break_glass_access": "Logged access to confidential records (SEN, counselling, safeguarding) with reason and review.",
    # audit / wf / sys / search
    "audit.audit_event": "Append-only audit trail of sensitive changes (before/after, actor, request) - monthly partitions.",
    "audit.audit_seal": "Hash-chained seals over audit batches for tamper evidence.",
    "wf.workflow_definition": "Configurable approval workflow (leave, concession, refund, marks re-open, payroll, ...).",
    "wf.workflow_step": "Ordered approval step with approver rule, condition and escalation timer.",
    "wf.approval_request": "One approval instance for a business object (subject_type/subject_id).",
    "wf.approval_task": "Approver inbox item for the current step.",
    "wf.approval_action": "Append-only history of approval actions (approve/reject/return/delegate/escalate).",
    "wf.delegation": "Temporary delegation of approvals from one user to another.",
    "sys.outbox_event": "Transactional outbox: domain events written in the business transaction, relayed to the queue.",
    "sys.processed_event": "Inbox de-duplication: event already handled by a consumer.",
    "sys.idempotency_key": "Stored responses for Idempotency-Key requests (payments, attendance sync, billing runs).",
    "sys.stored_file": "Metadata of every file in object storage (uploads and generated PDFs) with virus-scan status.",
    "sys.import_batch": "Excel/CSV import with dry-run validation report before commit.",
    "sys.job_run": "User-visible background job (exports, PDF batches, billing runs) with progress and result file.",
    "sys.schema_migration": "Applied database migrations (version + checksum).",
    "search.document": "Global search read model (students, guardians, staff, invoices, receipts) fed by events.",
    # aca
    "aca.programme": "Curriculum stage: Early Years, Primary, Lower Secondary, IGCSE, IAL.",
    "aca.year_group": "Year group within a programme with promotion order and admission age limits.",
    "aca.class_section": "Registration class for a campus/year (e.g. Year 7 - A) with class teacher and capacity.",
    "aca.subject": "Subject catalogue (core, elective, language, religious) with Edexcel spec code.",
    "aca.subject_group": "Elective choice group with min/max choices and combination rules.",
    "aca.curriculum_subject": "Subjects studied by a year group in a given academic year.",
    "aca.teaching_group": "Instructional group for one subject: a whole section or an elective set spanning sections.",
    "aca.teaching_group_teacher": "Teacher allocation to a teaching group with periods per week.",
    "aca.teaching_group_member": "Explicit student membership of an elective teaching group.",
    "aca.period_definition": "Bell schedule per campus/shift (regular or Ramadan), including prayer and break periods.",
    "aca.timetable": "Versioned weekly timetable per campus and year (draft/published).",
    "aca.timetable_slot": "One timetable cell; unique teacher, room and group per period (clash-free).",
    "aca.substitution": "Cover assignment for an absent teacher's period; feeds cover-period pay.",
    "aca.syllabus_topic": "Term-wise syllabus topic with Edexcel spec reference.",
    "aca.syllabus_coverage": "Coverage reported by teachers per teaching group and topic.",
    # sis
    "sis.family": "Household grouping siblings and guardians across campuses (one login, combined fees).",
    "sis.student": "Authoritative student record (profile, status, current campus).",
    "sis.student_address": "Present and permanent address of a student.",
    "sis.guardian": "Parent/guardian with contact details and portal account.",
    "sis.student_guardian": "Relationship between student and guardian with contact, payer and pick-up flags.",
    "sis.enrolment": "Placement of a student in a class section for a period - full history across years and transfers.",
    "sis.student_subject": "Elective subjects chosen for an enrolment.",
    "sis.student_document": "Document vault entry (birth certificate, reports, vaccination card) with verification.",
    "sis.sen_record": "Confidential special-educational-needs record and exam access arrangements.",
    "sis.profile_change_request": "Guardian-requested profile change awaiting office approval.",
    "sis.withdrawal": "Withdrawal workflow with dues clearance and transfer certificate.",
    "sis.id_card_issue": "Student ID card issue/reissue log with RFID number.",
    "sis.alumni_profile": "Graduate destination and alumni contact consent.",
    # adm
    "adm.enquiry": "Admission enquiry/lead with source, stage and follow-up.",
    "adm.enquiry_activity": "Calls, visits, notes and stage changes on an enquiry.",
    "adm.application": "Online admission application (draft to enrolled) with form snapshot.",
    "adm.application_document": "Documents uploaded with an application.",
    "adm.test_session": "Admission test or interview session per campus/year group.",
    "adm.test_candidate": "Applicant seated in a test session with scores and interview notes.",
    "adm.selection_rule": "Shortlisting rules: age cut-off, minimum score, sibling/staff-ward weights, seats.",
    "adm.merit_list": "Generated merit list (per round) awaiting approval/publication.",
    "adm.merit_list_entry": "Ranked applicant with decision offer/waitlist/reject.",
    "adm.offer": "Offer letter with fee schedule and expiry; accepted offers trigger enrolment.",
    "adm.enrolment_conversion": "Idempotent record of converting an application into a student and enrolment.",
    # att
    "att.student_daily_attendance": "Daily student attendance (one row per student per day) - yearly partitions.",
    "att.period_attendance": "Period-wise attendance per teaching group for senior years - yearly partitions.",
    "att.device": "Biometric/RFID/QR device registered for attendance or gate scans.",
    "att.device_event": "Raw punch/scan from devices via the on-campus bridge - monthly partitions.",
    "att.student_leave_request": "Leave applied by a guardian, approved by the class teacher.",
    "att.attendance_rule": "Minimum attendance % and warning thresholds (exam eligibility).",
    "att.attendance_flag": "Warning/ineligibility flag raised for a student by the threshold job.",
    "att.staff_attendance": "Daily staff attendance with late/early/overtime minutes - yearly partitions.",
    "att.staff_leave_type": "Staff leave types with quota, carry-forward and paid flag.",
    "att.staff_leave_balance": "Leave balance per staff, type and year; cannot be overdrawn.",
    "att.staff_leave_request": "Staff leave request with holiday-aware day count and approval.",
    # lrn
    "lrn.homework": "Homework/assignment set for a teaching group.",
    "lrn.homework_submission": "Student submission, grade and feedback for a homework.",
    "lrn.class_diary": "Daily class diary shown in the parent app.",
    "lrn.learning_resource": "Notes, slides, videos and past papers with visibility control.",
    "lrn.gradebook_item": "Continuous-assessment item (classwork, project, quiz) with weight.",
    "lrn.gradebook_score": "Student score on a gradebook item.",
    "lrn.lesson_plan": "Lesson plan aligned to syllabus topics, approved by the head of department.",
    "lrn.online_session": "Online class (Meet/Teams/Zoom) linked to the timetable.",
    "lrn.online_session_join": "Join log of an online session (feeds attendance).",
    "lrn.question": "Question bank item (MCQ, short, structured) tagged by subject/topic.",
    "lrn.quiz": "Quiz or online test for a teaching group.",
    "lrn.quiz_question": "Question included in a quiz with marks.",
    "lrn.quiz_attempt": "Student attempt with answers and scores.",
    "lrn.learner_target": "Baseline, target and working-at grade per student and subject.",
    # exm
    "exm.grading_scheme": "Configurable grading scheme (Edexcel 9-1, A*-E, GPA 5.0, descriptors), versioned.",
    "exm.grade_band": "Percentage band to grade/grade point; bands cannot overlap.",
    "exm.exam_type": "Exam type (class test, mid-term, final, mock).",
    "exm.exam": "Internal examination with lifecycle up to embargoed publication.",
    "exm.exam_paper": "One subject sitting of an exam for a year group; lockable after moderation.",
    "exm.assessment_component": "Paper component (written, practical, oral, CA) with weight.",
    "exm.seat_allocation": "Seat and room of a student per exam day; admit card number.",
    "exm.invigilation": "Invigilator assignment per paper and room.",
    "exm.mark_entry": "Append-only versioned mark entries (with double-entry round).",
    "exm.mark_current": "Latest mark per component and student - trigger-maintained projection.",
    "exm.paper_status_history": "Submit / moderate / lock / reopen history of a paper.",
    "exm.result_subject": "Computed subject result (percent, grade, rank) frozen at publication.",
    "exm.result_summary": "Computed overall result per student and exam with remarks.",
    "exm.report_card": "Generated report-card PDF with QR verification code.",
    "exm.external_series": "Awarding-body exam series (e.g. Edexcel June 2027).",
    "exm.candidate": "Awarding-body candidate number of a student.",
    "exm.external_entry": "Subject/unit entry for an external series with entry fee.",
    "exm.external_result": "Imported external result for an entry.",
    "exm.predicted_grade": "Teacher-predicted grade with evidence and approval.",
    # fee
    "fee.fee_head": "Fee head (tuition, admission, transport, fine, ...) with allocation priority.",
    "fee.fee_structure": "Fee structure per campus, year and year group (versioned).",
    "fee.fee_structure_line": "Amount and billing months of a fee head inside a structure.",
    "fee.student_fee_item": "Extra recurring/conditional fee for an enrolment (transport, club, lab).",
    "fee.concession_type": "Concession definition (sibling, staff-ward, merit, need) with stacking rules.",
    "fee.student_concession": "Concession granted to a student with validity and approval.",
    "fee.billing_run": "Bulk invoice generation for a period with preview and post steps.",
    "fee.invoice": "Invoice to a family/student; totals and paid amounts are trigger-maintained.",
    "fee.invoice_line": "Invoice line per fee head; immutable after issue (adjustments are new lines).",
    "fee.cash_session": "Cashier session with opening float, day-end count and handover.",
    "fee.gateway_transaction": "Online payment attempt with gateway (SSLCommerz/bKash/Nagad) and validation state.",
    "fee.gateway_transaction_invoice": "Invoices settled by one online payment.",
    "fee.gateway_webhook_log": "Raw inbound gateway callbacks for forensics and replay protection.",
    "fee.payment": "Money received (counter or online); one payment per gateway transaction.",
    "fee.payment_allocation": "Append-only allocation of a payment to invoice lines; reversals are negative rows.",
    "fee.receipt": "Numbered receipt for a payment with verification code.",
    "fee.late_fee_rule": "Late-fee rule (grace days, flat/per-day/percent, cap).",
    "fee.refund": "Refund request with approval and payout details.",
    "fee.settlement_file": "Imported gateway/bank settlement file.",
    "fee.settlement_line": "Settlement row matched to a payment or queued as an exception.",
    # acc
    "acc.account": "Chart of accounts (tree).",
    "acc.cost_centre": "Cost centre/campus dimension for postings.",
    "acc.fiscal_period": "Accounting period with open/locked status.",
    "acc.journal": "Voucher (receipt/payment/journal/contra); posted journals are reversed, never edited.",
    "acc.journal_line": "Debit or credit line; journals must balance at commit.",
    "acc.budget": "Annual budget per campus.",
    "acc.budget_line": "Monthly budget amount per account/cost centre.",
    "acc.vendor": "Supplier master with tax fields and payment terms.",
    "acc.purchase_requisition": "Departmental purchase requisition with approval.",
    "acc.purchase_requisition_line": "Requested item/quantity.",
    "acc.quotation": "Vendor quotation for a requisition (one selected).",
    "acc.purchase_order": "Purchase order to a vendor.",
    "acc.purchase_order_line": "Ordered item with received quantity.",
    "acc.supplier_bill": "Supplier bill with VAT/TDS and payment status.",
    "acc.connector_mapping": "Mapping of fee heads/channels/components to accounts or an external package.",
    # hrm
    "hrm.department": "Department (academic or administrative).",
    "hrm.designation": "Job title/grade.",
    "hrm.staff": "Staff master record (teaching and non-teaching).",
    "hrm.staff_campus": "Additional campuses a staff member works at.",
    "hrm.staff_document": "Staff document with expiry alerts.",
    "hrm.qualification": "Degrees, teaching credentials, certifications and experience.",
    "hrm.salary_component": "Earning/deduction component with calculation rule.",
    "hrm.contract": "Employment contract with basic pay; no overlapping contracts.",
    "hrm.contract_component": "Salary components of a contract (amount or percent).",
    "hrm.payroll_run": "Monthly payroll per campus with approval and lock.",
    "hrm.payslip": "Payslip per staff in a payroll run.",
    "hrm.payslip_line": "Component line of a payslip.",
    "hrm.staff_loan": "Staff loan/advance recovered through payroll.",
    "hrm.vacancy": "Job vacancy (published to the website careers page).",
    "hrm.job_application": "Candidate application through the recruitment pipeline.",
    "hrm.interview": "Interview with panel scores and recommendation.",
    "hrm.lifecycle_task": "Onboarding/exit checklist task.",
    "hrm.separation": "Resignation/termination with clearance and experience certificate.",
    "hrm.appraisal_cycle": "Appraisal cycle and form definition.",
    "hrm.appraisal": "Appraisal of a staff member in a cycle.",
    "hrm.lesson_observation": "Lesson observation record.",
    "hrm.cpd_course": "Training/CPD course catalogue.",
    "hrm.cpd_record": "CPD hours completed by a staff member.",
    # com
    "com.message_template": "Versioned bilingual message template per event and channel.",
    "com.notification_rule": "Which event goes to which recipient on which channels.",
    "com.notification_preference": "Per-user channel opt-outs and quiet hours.",
    "com.push_device": "Registered push token of a user's device.",
    "com.outbound_message": "Every message sent on any channel with delivery status - monthly partitions.",
    "com.message_dedupe": "Cross-partition de-duplication key for messages.",
    "com.notice": "Notice/circular with targeting, priority and website publishing.",
    "com.notice_audience": "Target audience of a notice.",
    "com.notice_read": "Read receipt of a notice.",
    "com.broadcast": "Emergency broadcast with delivery stats.",
    "com.sms_provider_balance": "SMS provider balance for low-balance alerts.",
    "com.conversation": "Moderated parent-teacher or class conversation.",
    "com.conversation_member": "Participant of a conversation.",
    "com.chat_message": "Message in a conversation (moderated, never hard-deleted).",
    "com.ptm_event": "Parent-teacher meeting day.",
    "com.ptm_slot": "Teacher slot in a PTM.",
    "com.ptm_booking": "Guardian booking of a PTM slot with notes.",
    "com.survey": "Survey (optionally anonymous).",
    "com.survey_question": "Question of a survey.",
    "com.survey_response": "One response per respondent.",
    "com.complaint": "Ticketed complaint with SLA.",
    "com.complaint_note": "Note on a complaint (internal or shared).",
    # doc / web / bi / prt
    "doc.template": "Bilingual document template (certificate, letter, report card, receipt).",
    "doc.issued_document": "Issue register of certificates/letters with serial number and QR verification.",
    "web.api_client": "API key for the public website and partners.",
    "web.news_post": "News post for the public website.",
    "web.gallery_album": "Photo album for the public website.",
    "web.gallery_photo": "Photo with student-consent flags.",
    "bi.campus_daily_kpi": "Pre-aggregated daily KPIs per campus (refreshed every 15 minutes).",
    "bi.section_attendance_daily": "Daily attendance counts per class section.",
    "bi.fee_aging": "Outstanding fee aging buckets per campus.",
    "bi.exam_result_stats": "Result statistics per paper and section.",
    "bi.saved_report": "Saved/scheduled ad-hoc report definition.",
    "prt.form_definition": "Online form/consent definition for the portal.",
    "prt.form_submission": "Submitted form with e-signature.",
    # trn
    "trn.vehicle": "School vehicle with capacity and devices.",
    "trn.vehicle_document": "Vehicle paper (fitness, insurance, tax token) with expiry.",
    "trn.route": "Bus route per campus/shift.",
    "trn.stop": "Pick-up/drop stop with fee zone.",
    "trn.route_stop": "Ordered stop on a route with times.",
    "trn.zone_fee": "Monthly transport fee per zone and year.",
    "trn.crew_assignment": "Driver/helper assigned to a vehicle.",
    "trn.transport_assignment": "Student assigned to route and stop; no overlapping assignments.",
    "trn.gps_ping": "GPS position of a vehicle - daily partitions.",
    "trn.trip": "One run of a route on a date.",
    "trn.boarding_event": "Boarding/alighting scan with parent notification.",
    "trn.fuel_log": "Fuel fill-up record.",
    "trn.maintenance_log": "Vehicle service/repair record.",
    # lib
    "lib.book_title": "Catalogue title (ISBN, authors, category).",
    "lib.book_copy": "Physical copy with accession number and barcode.",
    "lib.member_policy": "Loan limits and fines per member type.",
    "lib.circulation": "Loan of a copy; one active loan per copy.",
    "lib.reservation": "Title reservation queue.",
    "lib.stock_take": "Library stock verification session.",
    "lib.stock_take_scan": "Copy scanned during stock-take.",
    "lib.digital_item": "E-book or past paper with class-based access.",
    # inv
    "inv.item": "Inventory item master.",
    "inv.item_variant": "Variant of an item (size/colour) with sale price.",
    "inv.store": "Store per campus (central, uniform shop, lab).",
    "inv.stock_level_rule": "Min/max reorder levels per store and variant.",
    "inv.stock_balance": "Current quantity on hand; never negative (trigger-maintained).",
    "inv.stock_movement": "Append-only stock ledger (receipt, issue, transfer, sale, adjustment).",
    "inv.transfer": "Inter-store/campus transfer with approval.",
    "inv.pos_sale": "Uniform/book-shop sale (cash or student account).",
    "inv.pos_sale_line": "Line of a POS sale.",
    "inv.bundle": "Uniform/book set per year group.",
    "inv.asset": "Fixed asset with QR tag, custodian and depreciation.",
    "inv.asset_event": "Asset movement/verification/maintenance history.",
    "inv.maintenance_ticket": "Facility/IT ticket with SLA and sign-off.",
    # hlt
    "hlt.health_profile": "Student health profile (encrypted details, alert summary, consent).",
    "hlt.immunisation": "Immunisation record.",
    "hlt.sickbay_visit": "Sick-bay visit with outcome and parent notification.",
    "hlt.health_checkup": "Annual health check (height, weight, BMI, vision, dental).",
    "hlt.behaviour_incident": "Merit, demerit or incident with points and sanction.",
    "hlt.counselling_case": "Restricted counselling case.",
    "hlt.counselling_note": "Encrypted counselling session note (append-only).",
    "hlt.safeguarding_concern": "Restricted safeguarding concern with escalation.",
    "hlt.safeguarding_action": "Append-only action log on a concern.",
    "hlt.bullying_case": "Anti-bullying case with investigation and follow-up.",
    # cca
    "cca.house": "School house.",
    "cca.house_captain": "House captain/prefect per year and campus.",
    "cca.house_point": "Append-only house points (leaderboard source).",
    "cca.club": "Club/activity with capacity, schedule and fee.",
    "cca.club_membership": "Student membership of a club.",
    "cca.activity_session": "Club session with attendance.",
    "cca.event": "Field trip, sports day, competition or event.",
    "cca.event_participant": "Student participation and consent for an event.",
    "cca.competition_result": "Heat/final result and medal.",
    "cca.award": "Award given to a student (certificate via DOC).",
    "cca.quran_milestone": "Configurable Quran recitation/memorisation milestone.",
    "cca.quran_progress": "Student progress on a Quran milestone.",
    "cca.donation_drive": "Charity/zakat/fitra drive (separate from fees).",
    "cca.donation": "Donation received with receipt.",
    # sec
    "sec.visitor": "Visitor identity (encrypted ID) and watch-list flag.",
    "sec.visit": "Visit with check-in/out, host and badge.",
    "sec.pickup_authorisation": "Who may collect a student (guardian, standing or ad-hoc with OTP).",
    "sec.pickup_log": "Append-only release log at the gate.",
    "sec.gate_event": "Gate entry/exit scan - monthly partitions.",
    "sec.early_leave_permit": "Approved early leave for a student.",
    "sec.drill": "Emergency drill.",
    "sec.drill_roll_call": "Roll call per class during a drill.",
}

SKIP_COL = re.compile(r"^\s*(CONSTRAINT|CHECK|UNIQUE|PRIMARY|EXCLUDE|LIKE|FOREIGN)\b", re.I)
COL_LINE = re.compile(r"^\s{2}([a-z_][a-z0-9_]*)\s+[A-Za-z].*?--\s*(.+)$")
TABLE_LINE = re.compile(r"^CREATE TABLE ([a-z]+\.[a-z_0-9]+)\s*\((.*)$")


def q(s: str) -> str:
    return "'" + s.strip().replace("'", "''") + "'"


def main() -> None:
    table_note: dict[str, str] = {}
    col_comments: list[tuple[str, str, str]] = []
    for f in sorted(MIG.glob("[0-9][0-9][0-9][0-9]_*.sql")):
        if f.name.startswith("0090_"):
            continue
        current = None
        for line in f.read_text(encoding="utf-8").splitlines():
            m = TABLE_LINE.match(line)
            if m:
                current = m.group(1)
                rest = m.group(2)
                if "--" in rest:
                    table_note[current] = rest.split("--", 1)[1].strip()
                continue
            if current and line.startswith(")"):
                current = None
                continue
            if current and not SKIP_COL.match(line):
                cm = COL_LINE.match(line)
                if cm:
                    col_comments.append((current, cm.group(1), cm.group(2)))

    out = ["-- 0090_comments: GENERATED by db/tools/gen_comments.py - do not edit by hand.",
           "-- Repeatable migration: table/column comments used by the data dictionary (DATABASE.md).", ""]
    for table in sorted(set(TABLE_DESC) | set(table_note)):
        desc = TABLE_DESC.get(table, "")
        note = table_note.get(table, "")
        text = desc if not note else (f"{desc} [{note}]" if desc else note)
        if text:
            out.append(f"COMMENT ON TABLE {table} IS {q(text)};")
    out.append("")
    for table, col, text in col_comments:
        out.append(f"COMMENT ON COLUMN {table}.{col} IS {q(text)};")
    (MIG / "0090_comments.sql").write_text("\n".join(out) + "\n", encoding="utf-8", newline="\n")
    print(f"tables: {len(set(TABLE_DESC) | set(table_note))}, columns: {len(col_comments)}")


if __name__ == "__main__":
    main()
