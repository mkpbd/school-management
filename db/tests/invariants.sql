-- Invariant tests. Run as the RUNTIME role so RLS and grants are enforced:
--   psql -U sms_app -d school_platform -v ON_ERROR_STOP=1 -f db/tests/invariants.sql
-- Requires seeds (organisation + campuses + reference data). Everything runs in one transaction and is ROLLED BACK.
-- Each check prints "PASS ..." ; any failure aborts with an error.
\encoding UTF8

\set ON_ERROR_STOP on
\set QUIET on
BEGIN;

SELECT id AS org_id FROM core.organisation ORDER BY created_at LIMIT 1 \gset
SELECT set_config('app.org_id', :'org_id', true), set_config('app.campus_ids', '*', true),
       set_config('app.user_id', '00000000-0000-7000-8000-0000000000aa', true),
       set_config('app.request_id', 'test-invariants', true) \gset
SELECT id AS dhn FROM core.campus WHERE code = 'DHN' \gset
SELECT id AS gul FROM core.campus WHERE code = 'GUL' \gset
SELECT y.id AS y7 FROM aca.year_group y JOIN aca.programme p ON p.id = y.programme_id WHERE p.org_id = :'org_id' AND y.code = 'Y7' \gset
SELECT id AS tuition FROM fee.fee_head WHERE org_id = :'org_id' AND code = 'TUITION' \gset
SELECT id AS gpa5 FROM exm.grading_scheme WHERE org_id = :'org_id' AND code = 'GPA_5' \gset
SELECT id AS mid FROM exm.exam_type WHERE org_id = :'org_id' AND code = 'MID' \gset

-- ---------- fixtures ----------
INSERT INTO core.academic_year (org_id, code, starts_on, ends_on, status) VALUES (:'org_id', 'T-2090', '2090-07-01', '2091-06-30', 'open')
RETURNING id AS yr \gset
INSERT INTO aca.class_section (org_id, campus_id, academic_year_id, year_group_id, name, display_name, capacity)
VALUES (:'org_id', :'dhn', :'yr', :'y7', 'A', 'Year 7 - A', 30) RETURNING id AS sec \gset
INSERT INTO sis.family (org_id, family_code) VALUES (:'org_id', 'T-FAM-1') RETURNING id AS fam \gset
INSERT INTO sis.student (org_id, campus_id, family_id, admission_no, first_name_en, last_name_en, full_name_bn, gender, date_of_birth, admitted_on)
VALUES (:'org_id', :'dhn', :'fam', 'T-DHN-0001', 'Ayaan', 'Rahman', 'আয়ান রহমান', 'male', '2078-03-01', '2090-07-01')
RETURNING id AS stu \gset
INSERT INTO sis.enrolment (org_id, campus_id, academic_year_id, student_id, class_section_id, year_group_id, roll_no, starts_on)
VALUES (:'org_id', :'dhn', :'yr', :'stu', :'sec', :'y7', 1, '2090-07-01') RETURNING id AS enr \gset

-- ---------- 1. Campus isolation (RLS) ----------
SELECT set_config('app.campus_ids', :'gul', true) \gset
DO $$ BEGIN
  IF (SELECT count(*) FROM sis.student WHERE admission_no = 'T-DHN-0001') <> 0 THEN
    RAISE EXCEPTION 'FAIL rls: Gulshan user can see a Dhanmondi student';
  END IF;
  RAISE NOTICE 'PASS rls: other campus rows are invisible';
END $$;
DO $$ BEGIN
  INSERT INTO sis.family (org_id, family_code) VALUES (current_setting('app.org_id')::uuid, 'T-FAM-X');
  INSERT INTO sis.student (org_id, campus_id, family_id, admission_no, first_name_en, gender, date_of_birth, admitted_on)
  SELECT current_setting('app.org_id')::uuid, c.id, f.id, 'T-X', 'X', 'male', '2080-01-01', '2090-07-01'
    FROM core.campus c, sis.family f WHERE c.code = 'DHN' AND f.family_code = 'T-FAM-X';
  RAISE EXCEPTION 'FAIL rls: cross-campus insert allowed';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'PASS rls: cross-campus insert rejected (WITH CHECK)';
END $$;
SELECT set_config('app.campus_ids', :'dhn', true) \gset
DO $$ BEGIN
  IF (SELECT count(*) FROM sis.student WHERE admission_no = 'T-DHN-0001') <> 1 THEN RAISE EXCEPTION 'FAIL rls: own campus row hidden'; END IF;
  RAISE NOTICE 'PASS rls: own campus rows visible';
END $$;

-- ---------- 2. Enrolment history: no overlapping placements ----------
DO $$ BEGIN
  INSERT INTO sis.enrolment (org_id, campus_id, academic_year_id, student_id, class_section_id, year_group_id, starts_on)
  SELECT org_id, campus_id, academic_year_id, student_id, class_section_id, year_group_id, '2090-09-01'
    FROM sis.enrolment WHERE roll_no = 1 AND starts_on = '2090-07-01';
  RAISE EXCEPTION 'FAIL enrolment overlap allowed';
EXCEPTION WHEN exclusion_violation THEN RAISE NOTICE 'PASS enrolment: overlapping placement rejected';
END $$;

-- ---------- 3. Fees: totals, allocation, over-allocation, immutability ----------
INSERT INTO fee.invoice (org_id, campus_id, academic_year_id, invoice_no, family_id, student_id, enrolment_id, issue_date, due_date)
VALUES (:'org_id', :'dhn', :'yr', 'T-INV-1', :'fam', :'stu', :'enr', '2090-11-01', '2090-11-10') RETURNING id AS inv \gset
INSERT INTO fee.invoice_line (invoice_id, org_id, campus_id, fee_head_id, description, amount_paisa, discount_paisa, source, source_ref)
VALUES (:'inv', :'org_id', :'dhn', :'tuition', 'Tuition Nov', 1000000, 100000, 'structure', 'tuition'),
       (:'inv', :'org_id', :'dhn', :'tuition', 'Lab Nov',      50000,      0, 'structure', 'lab');
SELECT id AS line1 FROM fee.invoice_line WHERE invoice_id = :'inv' AND source_ref = 'tuition' \gset

DO $$ DECLARE i record; BEGIN
  SELECT * INTO i FROM fee.invoice WHERE invoice_no = 'T-INV-1';
  IF (i.gross_paisa, i.discount_paisa, i.net_paisa, i.status) <> (1050000::bigint, 100000::bigint, 950000::bigint, 'draft') THEN
    RAISE EXCEPTION 'FAIL invoice totals: %', i;
  END IF;
  RAISE NOTICE 'PASS fee: invoice totals maintained from lines (net 9,500.00)';
END $$;

INSERT INTO fee.payment (org_id, campus_id, payment_no, family_id, channel, amount_paisa)
VALUES (:'org_id', :'dhn', 'T-PAY-1', :'fam', 'cash', 600000) RETURNING id AS pay \gset

DO $$ BEGIN
  INSERT INTO fee.payment_allocation (org_id, campus_id, payment_id, invoice_id, invoice_line_id, amount_paisa)
  SELECT l.org_id, l.campus_id, p.id, l.invoice_id, l.id, 100000
    FROM fee.invoice_line l, fee.payment p WHERE l.source_ref = 'tuition' AND p.payment_no = 'T-PAY-1';
  RAISE EXCEPTION 'FAIL allocation to draft invoice allowed';
EXCEPTION WHEN check_violation THEN RAISE NOTICE 'PASS fee: cannot pay a draft invoice';
END $$;

UPDATE fee.invoice SET status = 'issued' WHERE id = :'inv';
INSERT INTO fee.payment_allocation (org_id, campus_id, payment_id, invoice_id, invoice_line_id, amount_paisa)
VALUES (:'org_id', :'dhn', :'pay', :'inv', :'line1', 600000);
DO $$ BEGIN
  IF (SELECT (paid_paisa::bigint, status) FROM fee.invoice WHERE invoice_no = 'T-INV-1') <> (600000::bigint, 'partially_paid'::text) THEN
    RAISE EXCEPTION 'FAIL allocation trigger';
  END IF;
  RAISE NOTICE 'PASS fee: allocation updates paid amount and status';
END $$;

DO $$ BEGIN
  INSERT INTO fee.payment_allocation (org_id, campus_id, payment_id, invoice_id, invoice_line_id, amount_paisa)
  SELECT l.org_id, l.campus_id, p.id, l.invoice_id, l.id, 400000
    FROM fee.invoice_line l, fee.payment p WHERE l.source_ref = 'tuition' AND p.payment_no = 'T-PAY-1';
  RAISE EXCEPTION 'FAIL over-allocation allowed';
EXCEPTION WHEN check_violation THEN RAISE NOTICE 'PASS fee: over-allocation beyond line net rejected (I-5)';
END $$;

DO $$ BEGIN
  UPDATE fee.invoice_line SET amount_paisa = 1 WHERE source_ref = 'lab' AND description = 'Lab Nov';
  RAISE EXCEPTION 'FAIL issued invoice line edited';
EXCEPTION WHEN check_violation THEN RAISE NOTICE 'PASS fee: lines of issued invoice are immutable';
END $$;

DO $$ BEGIN
  UPDATE fee.invoice SET status = 'void', void_reason = 'test' WHERE invoice_no = 'T-INV-1';
  RAISE EXCEPTION 'FAIL void of paid invoice allowed';
EXCEPTION WHEN check_violation THEN RAISE NOTICE 'PASS fee: invoice with payments cannot be voided';
END $$;

DO $$ BEGIN
  DELETE FROM fee.payment_allocation WHERE amount_paisa = 600000;
  RAISE EXCEPTION 'FAIL allocation deleted';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'PASS fee: allocations are append-only (no DELETE grant)';
END $$;

-- reversal (negative allocation) restores the outstanding amount
INSERT INTO fee.payment_allocation (org_id, campus_id, payment_id, invoice_id, invoice_line_id, amount_paisa, reverses_allocation_id)
SELECT org_id, campus_id, payment_id, invoice_id, invoice_line_id, -amount_paisa, id FROM fee.payment_allocation WHERE invoice_id = :'inv';
DO $$ BEGIN
  IF (SELECT (paid_paisa::bigint, status) FROM fee.invoice WHERE invoice_no = 'T-INV-1') <> (0::bigint, 'issued'::text) THEN
    RAISE EXCEPTION 'FAIL reversal';
  END IF;
  RAISE NOTICE 'PASS fee: reversal allocation restores outstanding';
END $$;

-- duplicate online payment for one gateway transaction
INSERT INTO fee.gateway_transaction (org_id, campus_id, provider, merchant_tran_id, family_id, initiated_by, amount_paisa, expires_at, status)
VALUES (:'org_id', :'dhn', 'sslcommerz', 'T-MTI-1', :'fam', '00000000-0000-7000-8000-0000000000aa', 950000, now() + interval '30 minutes', 'validated')
RETURNING id AS gtx \gset
INSERT INTO fee.payment (org_id, campus_id, payment_no, family_id, channel, amount_paisa, gateway_transaction_id)
VALUES (:'org_id', :'dhn', 'T-PAY-2', :'fam', 'bkash', 950000, :'gtx');
DO $$ BEGIN
  INSERT INTO fee.payment (org_id, campus_id, payment_no, family_id, channel, amount_paisa, gateway_transaction_id)
  SELECT org_id, campus_id, 'T-PAY-3', family_id, 'bkash', amount_paisa, id FROM fee.gateway_transaction WHERE merchant_tran_id = 'T-MTI-1';
  RAISE EXCEPTION 'FAIL duplicate gateway payment allowed';
EXCEPTION WHEN unique_violation THEN RAISE NOTICE 'PASS fee: one payment per gateway transaction (I-4)';
END $$;

-- ---------- 4. Marks: versions, lock, append-only ----------
INSERT INTO aca.subject (org_id, code, name_en, kind) VALUES (:'org_id', 'T-MATH', 'Mathematics', 'core') RETURNING id AS math \gset
INSERT INTO exm.exam (org_id, campus_id, academic_year_id, exam_type_id, name_en, starts_on, ends_on, status)
VALUES (:'org_id', :'dhn', :'yr', :'mid', 'Mid-term', '2090-12-01', '2090-12-10', 'marking') RETURNING id AS exam \gset
INSERT INTO exm.exam_paper (org_id, campus_id, exam_id, year_group_id, subject_id, max_marks, grading_scheme_id)
VALUES (:'org_id', :'dhn', :'exam', :'y7', :'math', 100, :'gpa5') RETURNING id AS paper \gset
INSERT INTO exm.assessment_component (exam_paper_id, code, name_en, max_marks, weight_pct)
VALUES (:'paper', 'W', 'Written', 100, 100) RETURNING id AS comp \gset
INSERT INTO exm.mark_entry (org_id, campus_id, exam_paper_id, component_id, student_id, version, marks, entered_by)
VALUES (:'org_id', :'dhn', :'paper', :'comp', :'stu', 1, 72, :'stu'),
       (:'org_id', :'dhn', :'paper', :'comp', :'stu', 2, 74, :'stu');
DO $$ BEGIN
  IF (SELECT (marks, version) FROM exm.mark_current) <> (74.00::numeric, 2) THEN RAISE EXCEPTION 'FAIL mark_current'; END IF;
  RAISE NOTICE 'PASS exm: latest mark version projected into mark_current';
END $$;
DO $$ BEGIN
  UPDATE exm.mark_entry SET marks = 99;
  RAISE EXCEPTION 'FAIL mark_entry updated';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'PASS exm: mark entries are append-only';
END $$;
UPDATE exm.exam_paper SET status = 'locked' WHERE id = :'paper';
DO $$ BEGIN
  INSERT INTO exm.mark_entry (org_id, campus_id, exam_paper_id, component_id, student_id, version, marks, change_reason, entered_by)
  SELECT org_id, campus_id, exam_paper_id, component_id, student_id, 3, 99, 'late change', student_id FROM exm.mark_current;
  RAISE EXCEPTION 'FAIL locked paper accepted marks';
EXCEPTION WHEN check_violation THEN RAISE NOTICE 'PASS exm: marks rejected once the paper is locked (I-6)';
END $$;
DO $$ BEGIN
  INSERT INTO exm.grade_band (scheme_id, grade, min_percent, max_percent, is_pass, seq)
  SELECT id, 'X', 75, 85, true, 99 FROM exm.grading_scheme WHERE code = 'GPA_5';
  RAISE EXCEPTION 'FAIL overlapping grade band allowed';
EXCEPTION WHEN exclusion_violation THEN RAISE NOTICE 'PASS exm: overlapping grade bands rejected';
END $$;

-- ---------- 5. Accounting: balanced journals ----------
INSERT INTO acc.fiscal_period (org_id, code, starts_on, ends_on) VALUES (:'org_id', 'T-2090-11', '2090-11-01', '2090-11-30') RETURNING id AS fp \gset
INSERT INTO acc.account (org_id, code, name_en, kind) VALUES (:'org_id', 'T-1100', 'Cash', 'asset') RETURNING id AS cash \gset
INSERT INTO acc.account (org_id, code, name_en, kind) VALUES (:'org_id', 'T-4100', 'Tuition income', 'income') RETURNING id AS income \gset
DO $$ DECLARE j uuid; BEGIN
  INSERT INTO acc.journal (org_id, campus_id, journal_no, voucher_type, journal_date, fiscal_period_id, narration)
  SELECT org_id, (SELECT id FROM core.campus WHERE code = 'DHN'), 'T-JV-1', 'receipt', '2090-11-05', id, 'unbalanced'
    FROM acc.fiscal_period WHERE code = 'T-2090-11' RETURNING id INTO j;
  INSERT INTO acc.journal_line (journal_id, org_id, campus_id, account_id, debit_paisa)
  SELECT j, a.org_id, (SELECT id FROM core.campus WHERE code = 'DHN'), a.id, 100000 FROM acc.account a WHERE a.code = 'T-1100';
  SET CONSTRAINTS ALL IMMEDIATE;
  RAISE EXCEPTION 'FAIL unbalanced journal accepted';
EXCEPTION WHEN check_violation THEN RAISE NOTICE 'PASS acc: unbalanced journal rejected';
END $$;
SET CONSTRAINTS ALL DEFERRED;

-- ---------- 6. Inventory: no negative stock ----------
INSERT INTO inv.item (org_id, sku, name_en, category) VALUES (:'org_id', 'T-SHIRT', 'School shirt', 'uniform') RETURNING id AS item \gset
INSERT INTO inv.item_variant (item_id, code) VALUES (:'item', 'S-28') RETURNING id AS var \gset
INSERT INTO inv.store (org_id, campus_id, code, name, kind) VALUES (:'org_id', :'dhn', 'T-UNI', 'Uniform shop', 'uniform_shop') RETURNING id AS store \gset
INSERT INTO inv.stock_movement (org_id, campus_id, store_id, item_variant_id, movement_type, qty_delta, unit_cost_paisa, moved_by)
VALUES (:'org_id', :'dhn', :'store', :'var', 'receipt', 5, 45000, :'stu');
DO $$ BEGIN
  INSERT INTO inv.stock_movement (org_id, campus_id, store_id, item_variant_id, movement_type, qty_delta, moved_by)
  SELECT org_id, campus_id, store_id, item_variant_id, 'sale', -6, moved_by FROM inv.stock_movement WHERE movement_type = 'receipt' LIMIT 1;
  RAISE EXCEPTION 'FAIL negative stock allowed';
EXCEPTION WHEN check_violation THEN RAISE NOTICE 'PASS inv: sale beyond stock on hand rejected (I-9)';
END $$;
DO $$ DECLARE q numeric; BEGIN
  INSERT INTO inv.stock_movement (org_id, campus_id, store_id, item_variant_id, movement_type, qty_delta, moved_by)
  SELECT org_id, campus_id, store_id, item_variant_id, 'sale', -2, moved_by FROM inv.stock_movement WHERE movement_type = 'receipt' LIMIT 1;
  SELECT b.qty_on_hand INTO q FROM inv.stock_balance b JOIN inv.store s ON s.id = b.store_id WHERE s.code = 'T-UNI';
  IF q <> 3 THEN RAISE EXCEPTION 'FAIL sale within stock left % on hand (expected 3)', q; END IF;
  RAISE NOTICE 'PASS inv: sale within stock reduces the balance';
END $$;

-- ---------- 7. Attendance + audit of corrections ----------
INSERT INTO att.student_daily_attendance (org_id, campus_id, attendance_date, student_id, enrolment_id, class_section_id, status, source, marked_by)
VALUES (:'org_id', :'dhn', '2090-11-03', :'stu', :'enr', :'sec', 'absent', 'teacher', :'stu');
UPDATE att.student_daily_attendance SET status = 'late', source = 'correction' WHERE student_id = :'stu';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM audit.audit_event WHERE table_name = 'student_daily_attendance' AND action = 'UPDATE'
                   AND actor_user_id = '00000000-0000-7000-8000-0000000000aa' AND 'status' = ANY (changed_cols)) THEN
    RAISE EXCEPTION 'FAIL attendance correction not audited';
  END IF;
  RAISE NOTICE 'PASS audit: attendance correction audited with actor and changed columns';
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM audit.audit_event WHERE table_name = 'student' AND after ? 'birth_cert_no_enc') THEN
    RAISE EXCEPTION 'FAIL encrypted column leaked into audit';
  END IF;
  RAISE NOTICE 'PASS audit: encrypted columns redacted from audit payloads';
END $$;
DO $$ BEGIN
  DELETE FROM audit.audit_event;
  RAISE EXCEPTION 'FAIL audit deletable';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'PASS audit: audit trail is append-only';
END $$;

-- ---------- 8. Library: one active loan per copy ----------
INSERT INTO lib.book_title (org_id, title) VALUES (:'org_id', 'T-Book') RETURNING id AS bt \gset
INSERT INTO lib.book_copy (org_id, campus_id, book_title_id, accession_no, barcode) VALUES (:'org_id', :'dhn', :'bt', 'T-ACC-1', 'T-BC-1') RETURNING id AS copy \gset
INSERT INTO lib.circulation (org_id, campus_id, book_copy_id, borrower_type, borrower_id, due_on, issued_by)
VALUES (:'org_id', :'dhn', :'copy', 'student', :'stu', '2090-11-20', :'stu');
DO $$ BEGIN
  INSERT INTO lib.circulation (org_id, campus_id, book_copy_id, borrower_type, borrower_id, due_on, issued_by)
  SELECT org_id, campus_id, book_copy_id, 'student', borrower_id, '2090-11-25', issued_by FROM lib.circulation LIMIT 1;
  RAISE EXCEPTION 'FAIL double loan allowed';
EXCEPTION WHEN unique_violation THEN RAISE NOTICE 'PASS lib: a copy cannot be on two active loans';
END $$;

-- ---------- 9. Optimistic concurrency columns ----------
UPDATE sis.student SET preferred_name = 'Ayu' WHERE id = :'stu';
DO $$ BEGIN
  IF (SELECT row_version FROM sis.student WHERE admission_no = 'T-DHN-0001') <> 2 THEN RAISE EXCEPTION 'FAIL row_version'; END IF;
  RAISE NOTICE 'PASS core: row_version / updated_at maintained by trg_touch';
END $$;

ROLLBACK;
\echo 'ALL INVARIANT TESTS PASSED (transaction rolled back)'
