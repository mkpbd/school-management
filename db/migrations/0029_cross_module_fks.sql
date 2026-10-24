-- 0029_cross_module_fks: foreign keys that point across module schemas.
-- Added after all modules exist (modules are created in dependency order, but some references are circular).
-- Rule (ADR-008): code never QUERIES another module's tables; FKs only protect integrity.

-- ---------- explicit references ----------
ALTER TABLE aca.class_section        ADD FOREIGN KEY (class_teacher_staff_id)   REFERENCES hrm.staff(id),
                                     ADD FOREIGN KEY (head_of_section_staff_id) REFERENCES hrm.staff(id);
ALTER TABLE aca.teaching_group_teacher ADD FOREIGN KEY (staff_id)      REFERENCES hrm.staff(id);
ALTER TABLE aca.teaching_group_member  ADD FOREIGN KEY (enrolment_id)  REFERENCES sis.enrolment(id);
ALTER TABLE aca.timetable_slot       ADD FOREIGN KEY (staff_id)        REFERENCES hrm.staff(id);
ALTER TABLE aca.substitution         ADD FOREIGN KEY (absent_staff_id) REFERENCES hrm.staff(id),
                                     ADD FOREIGN KEY (cover_staff_id)  REFERENCES hrm.staff(id);

ALTER TABLE sis.student              ADD FOREIGN KEY (house_id)        REFERENCES cca.house(id);
ALTER TABLE sis.guardian             ADD FOREIGN KEY (is_staff_id)     REFERENCES hrm.staff(id);
ALTER TABLE sis.withdrawal           ADD FOREIGN KEY (tc_document_id)  REFERENCES doc.issued_document(id);
ALTER TABLE sis.id_card_issue        ADD FOREIGN KEY (invoice_line_id) REFERENCES fee.invoice_line(id);

ALTER TABLE adm.application          ADD FOREIGN KEY (staff_ward_staff_id)        REFERENCES hrm.staff(id),
                                     ADD FOREIGN KEY (application_fee_invoice_id) REFERENCES fee.invoice(id);
ALTER TABLE adm.offer                ADD FOREIGN KEY (admission_invoice_id) REFERENCES fee.invoice(id),
                                     ADD FOREIGN KEY (letter_document_id)   REFERENCES doc.issued_document(id);

ALTER TABLE att.student_daily_attendance ADD FOREIGN KEY (student_id)       REFERENCES sis.student(id),
                                         ADD FOREIGN KEY (enrolment_id)     REFERENCES sis.enrolment(id),
                                         ADD FOREIGN KEY (class_section_id) REFERENCES aca.class_section(id),
                                         ADD FOREIGN KEY (leave_request_id) REFERENCES att.student_leave_request(id);
ALTER TABLE att.period_attendance    ADD FOREIGN KEY (student_id)           REFERENCES sis.student(id),
                                     ADD FOREIGN KEY (teaching_group_id)    REFERENCES aca.teaching_group(id),
                                     ADD FOREIGN KEY (period_definition_id) REFERENCES aca.period_definition(id);
ALTER TABLE att.device_event         ADD FOREIGN KEY (device_id)  REFERENCES att.device(id);
ALTER TABLE att.staff_attendance     ADD FOREIGN KEY (staff_id)   REFERENCES hrm.staff(id);
ALTER TABLE att.staff_leave_balance  ADD FOREIGN KEY (staff_id)   REFERENCES hrm.staff(id);
ALTER TABLE att.staff_leave_request  ADD FOREIGN KEY (staff_id)   REFERENCES hrm.staff(id);
ALTER TABLE att.attendance_flag      ADD FOREIGN KEY (student_id) REFERENCES sis.student(id),
                                     ADD FOREIGN KEY (term_id)    REFERENCES core.term(id);
ALTER TABLE att.student_leave_request ADD FOREIGN KEY (enrolment_id) REFERENCES sis.enrolment(id);

ALTER TABLE lrn.homework             ADD FOREIGN KEY (set_by_staff_id) REFERENCES hrm.staff(id),
                                     ADD FOREIGN KEY (subject_id)      REFERENCES aca.subject(id);
ALTER TABLE lrn.homework_submission  ADD FOREIGN KEY (student_id) REFERENCES sis.student(id);
ALTER TABLE lrn.gradebook_score      ADD FOREIGN KEY (student_id) REFERENCES sis.student(id);
ALTER TABLE lrn.lesson_plan          ADD FOREIGN KEY (author_staff_id) REFERENCES hrm.staff(id);
ALTER TABLE lrn.quiz_attempt         ADD FOREIGN KEY (student_id) REFERENCES sis.student(id);
ALTER TABLE lrn.learner_target       ADD FOREIGN KEY (student_id) REFERENCES sis.student(id);

ALTER TABLE exm.mark_entry           ADD FOREIGN KEY (student_id) REFERENCES sis.student(id);
ALTER TABLE exm.mark_current         ADD FOREIGN KEY (student_id) REFERENCES sis.student(id),
                                     ADD FOREIGN KEY (component_id)  REFERENCES exm.assessment_component(id),
                                     ADD FOREIGN KEY (exam_paper_id) REFERENCES exm.exam_paper(id);
ALTER TABLE exm.result_subject       ADD FOREIGN KEY (student_id)   REFERENCES sis.student(id),
                                     ADD FOREIGN KEY (enrolment_id) REFERENCES sis.enrolment(id),
                                     ADD FOREIGN KEY (scheme_id)    REFERENCES exm.grading_scheme(id);
ALTER TABLE exm.result_summary       ADD FOREIGN KEY (student_id)   REFERENCES sis.student(id),
                                     ADD FOREIGN KEY (enrolment_id) REFERENCES sis.enrolment(id);
ALTER TABLE exm.seat_allocation      ADD FOREIGN KEY (student_id) REFERENCES sis.student(id);
ALTER TABLE exm.invigilation         ADD FOREIGN KEY (staff_id)   REFERENCES hrm.staff(id);
ALTER TABLE exm.report_card          ADD FOREIGN KEY (student_id)  REFERENCES sis.student(id),
                                     ADD FOREIGN KEY (template_id) REFERENCES doc.template(id);
ALTER TABLE exm.candidate            ADD FOREIGN KEY (student_id) REFERENCES sis.student(id);
ALTER TABLE exm.external_entry       ADD FOREIGN KEY (student_id)      REFERENCES sis.student(id),
                                     ADD FOREIGN KEY (subject_id)      REFERENCES aca.subject(id),
                                     ADD FOREIGN KEY (invoice_line_id) REFERENCES fee.invoice_line(id);
ALTER TABLE exm.external_result      ADD FOREIGN KEY (import_batch_id) REFERENCES sys.import_batch(id);
ALTER TABLE exm.predicted_grade      ADD FOREIGN KEY (student_id) REFERENCES sis.student(id),
                                     ADD FOREIGN KEY (subject_id) REFERENCES aca.subject(id);

ALTER TABLE fee.invoice              ADD FOREIGN KEY (application_id) REFERENCES adm.application(id),
                                     ADD FOREIGN KEY (academic_year_id) REFERENCES core.academic_year(id);
ALTER TABLE fee.fee_structure        ADD FOREIGN KEY (academic_year_id) REFERENCES core.academic_year(id);
ALTER TABLE fee.billing_run          ADD FOREIGN KEY (academic_year_id) REFERENCES core.academic_year(id);

ALTER TABLE com.ptm_slot             ADD FOREIGN KEY (staff_id)   REFERENCES hrm.staff(id);
ALTER TABLE com.ptm_booking          ADD FOREIGN KEY (student_id) REFERENCES sis.student(id),
                                     ADD FOREIGN KEY (guardian_user_id) REFERENCES iam.user_account(id);
ALTER TABLE com.conversation         ADD FOREIGN KEY (student_id) REFERENCES sis.student(id);
ALTER TABLE com.complaint            ADD FOREIGN KEY (student_id) REFERENCES sis.student(id);

ALTER TABLE iam.consent_record       ADD FOREIGN KEY (guardian_id) REFERENCES sis.guardian(id),
                                     ADD FOREIGN KEY (student_id)  REFERENCES sis.student(id);
ALTER TABLE aca.teaching_group       ADD FOREIGN KEY (campus_id) REFERENCES core.campus(id);
ALTER TABLE cca.event                ADD FOREIGN KEY (consent_form_id) REFERENCES prt.form_definition(id);
ALTER TABLE inv.pos_sale_line        ADD CONSTRAINT pos_sale_line_discount_chk CHECK (discount_paisa <= qty * unit_price_paisa);
ALTER TABLE acc.purchase_requisition_line ADD FOREIGN KEY (item_id) REFERENCES inv.item(id);
ALTER TABLE acc.purchase_order_line  ADD FOREIGN KEY (item_id) REFERENCES inv.item(id);


-- ---------- convention-based references (added only where no FK exists yet) ----------
-- org_id -> core.organisation, campus_id -> core.campus, approval_request_id -> wf.approval_request,
-- *_file_id -> sys.stored_file. Audit and search read models are excluded on purpose.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT c.table_schema, c.table_name, c.column_name,
           CASE
             WHEN c.column_name = 'org_id'              THEN 'core.organisation'
             WHEN c.column_name = 'campus_id'           THEN 'core.campus'
             WHEN c.column_name = 'approval_request_id' THEN 'wf.approval_request'
             WHEN c.column_name LIKE '%\_file\_id'      THEN 'sys.stored_file'
           END AS target
      FROM information_schema.columns c
      JOIN pg_class t     ON t.relname = c.table_name
      JOIN pg_namespace n ON n.oid = t.relnamespace AND n.nspname = c.table_schema
     WHERE c.table_schema NOT IN ('audit','search','pg_catalog','information_schema','public')
       AND c.data_type = 'uuid'
       AND t.relkind IN ('r','p') AND NOT t.relispartition
       AND (c.column_name IN ('org_id','campus_id','approval_request_id') OR c.column_name LIKE '%\_file\_id')
       AND NOT (c.table_schema = 'core' AND c.table_name IN ('organisation','std_cols'))
       AND NOT (c.table_schema = 'sys' AND c.table_name = 'outbox_event')
       AND NOT EXISTS (                                         -- skip if an FK on exactly this column exists
             SELECT 1 FROM pg_constraint k
              WHERE k.conrelid = t.oid AND k.contype = 'f'
                AND k.conkey = ARRAY[(SELECT attnum FROM pg_attribute
                                       WHERE attrelid = t.oid AND attname = c.column_name)]::smallint[])
  LOOP
    EXECUTE format('ALTER TABLE %I.%I ADD FOREIGN KEY (%I) REFERENCES %s(id)',
                   r.table_schema, r.table_name, r.column_name, r.target);
  END LOOP;
END $$;
