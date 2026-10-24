-- 0012_exm: generated from SYSTEM_DESIGN.md section 6, then extended.
-- Run as sms_owner. Standard triggers/RLS are applied in 0030_standardize.sql.

CREATE TABLE exm.grading_scheme (                  -- EXM-04 / Appendix A
  id        uuid PRIMARY KEY DEFAULT uuidv7(),
  org_id    uuid NOT NULL,
  code      text NOT NULL,                         -- 'EDX_IGCSE_9_1','EDX_IAL_A_E','GPA_5','PRIMARY_DESC'
  name_en   text NOT NULL,
  kind      text NOT NULL CHECK (kind IN ('band','descriptor','gpa')),
  version   integer NOT NULL DEFAULT 1,
  rounding  text NOT NULL DEFAULT 'half_up' CHECK (rounding IN ('half_up','floor','none')),
  is_active boolean NOT NULL DEFAULT true,
  LIKE core.std_cols INCLUDING DEFAULTS,
  UNIQUE (org_id, code, version)
);
ALTER TABLE aca.programme ADD FOREIGN KEY (default_grading_scheme_id) REFERENCES exm.grading_scheme(id);

CREATE TABLE exm.grade_band (
  id           uuid PRIMARY KEY DEFAULT uuidv7(),
  scheme_id    uuid NOT NULL REFERENCES exm.grading_scheme(id) ON DELETE CASCADE,
  grade        text NOT NULL,                      -- '9','A*','A+','Exceeding'
  label_bn     text,
  min_percent  numeric(5,2) NOT NULL,
  max_percent  numeric(5,2) NOT NULL,
  grade_point  numeric(4,2),                       -- GPA 5.00 scale
  is_pass      boolean NOT NULL,
  seq          smallint NOT NULL,
  UNIQUE (scheme_id, grade),
  CHECK (max_percent >= min_percent),
  EXCLUDE USING gist (scheme_id WITH =, numrange(min_percent, max_percent, '[]') WITH &&)   -- no overlapping bands
);

CREATE TABLE exm.exam_type (
  id          uuid PRIMARY KEY DEFAULT uuidv7(),
  org_id      uuid NOT NULL,
  code        text NOT NULL,                       -- CT, MID, FINAL, MOCK, BOARD_PRACTICE
  name_en     text NOT NULL,
  name_bn     text,
  UNIQUE (org_id, code)
);

CREATE TABLE exm.exam (
  id                   uuid PRIMARY KEY DEFAULT uuidv7(),
  org_id               uuid NOT NULL,
  campus_id            uuid NOT NULL,
  academic_year_id     uuid NOT NULL REFERENCES core.academic_year(id),
  term_id              uuid REFERENCES core.term(id),
  exam_type_id         uuid NOT NULL REFERENCES exm.exam_type(id),
  name_en              text NOT NULL,
  name_bn              text,
  starts_on            date NOT NULL,
  ends_on              date NOT NULL,
  status               text NOT NULL DEFAULT 'draft'
                       CHECK (status IN ('draft','scheduled','in_progress','marking','moderation','locked','published','archived')),
  weight_in_term       numeric(5,2),               -- e.g. MID 40%, FINAL 60%
  result_embargo_until timestamptz,                -- EXM-06
  published_at         timestamptz,
  LIKE core.std_cols INCLUDING DEFAULTS,
  CHECK (ends_on >= starts_on)
);  -- std(audit, rls)

CREATE TABLE exm.exam_paper (                      -- one subject sitting for a year group
  id                uuid PRIMARY KEY DEFAULT uuidv7(),
  org_id            uuid NOT NULL,
  campus_id         uuid NOT NULL,
  exam_id           uuid NOT NULL REFERENCES exm.exam(id) ON DELETE CASCADE,
  year_group_id     uuid NOT NULL REFERENCES aca.year_group(id),
  subject_id        uuid NOT NULL REFERENCES aca.subject(id),
  paper_code        text NOT NULL DEFAULT '1',
  sits_at           timestamptz,
  duration          interval,
  max_marks         numeric(6,2) NOT NULL CHECK (max_marks > 0),
  pass_marks        numeric(6,2),
  grading_scheme_id uuid NOT NULL REFERENCES exm.grading_scheme(id),
  double_entry      boolean NOT NULL DEFAULT false,  -- EXM-03 verification
  status            text NOT NULL DEFAULT 'open'
                    CHECK (status IN ('open','submitted','moderated','locked','reopened')),
  locked_at         timestamptz,
  locked_by         uuid,
  LIKE core.std_cols INCLUDING DEFAULTS,
  UNIQUE (exam_id, year_group_id, subject_id, paper_code)
);  -- std(audit, rls)
CREATE INDEX ix_exam_paper_sitting ON exm.exam_paper (campus_id, sits_at);

CREATE TABLE exm.assessment_component (            -- written / practical / oral / CA
  id            uuid PRIMARY KEY DEFAULT uuidv7(),
  exam_paper_id uuid NOT NULL REFERENCES exm.exam_paper(id) ON DELETE CASCADE,
  code          text NOT NULL,
  name_en       text NOT NULL,
  max_marks     numeric(6,2) NOT NULL CHECK (max_marks > 0),
  weight_pct    numeric(5,2) NOT NULL CHECK (weight_pct BETWEEN 0 AND 100),
  source        text NOT NULL DEFAULT 'entry' CHECK (source IN ('entry','gradebook')),   -- CA pulled from LRN
  UNIQUE (exam_paper_id, code)
);

CREATE TABLE exm.seat_allocation (                 -- EXM-02
  exam_id       uuid NOT NULL REFERENCES exm.exam(id) ON DELETE CASCADE,
  student_id    uuid NOT NULL,
  session_date  date NOT NULL,
  room_id       uuid NOT NULL REFERENCES core.room(id),
  seat_no       text NOT NULL,
  admit_card_no text NOT NULL,
  PRIMARY KEY (exam_id, student_id, session_date),
  UNIQUE (exam_id, session_date, room_id, seat_no)
);

CREATE TABLE exm.invigilation (
  exam_paper_id uuid NOT NULL REFERENCES exm.exam_paper(id) ON DELETE CASCADE,
  room_id       uuid NOT NULL REFERENCES core.room(id),
  staff_id      uuid NOT NULL,
  role          text NOT NULL DEFAULT 'invigilator' CHECK (role IN ('chief','invigilator','reader','scribe')),
  PRIMARY KEY (exam_paper_id, room_id, staff_id)
);

-- Append-only marks (I-3). Every change = new version row. App role: INSERT only.
CREATE TABLE exm.mark_entry (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id        uuid NOT NULL,
  campus_id     uuid NOT NULL,
  exam_paper_id uuid NOT NULL REFERENCES exm.exam_paper(id),
  component_id  uuid NOT NULL REFERENCES exm.assessment_component(id),
  student_id    uuid NOT NULL,
  entry_round   smallint NOT NULL DEFAULT 1 CHECK (entry_round IN (1, 2)),   -- 2 = double-entry verification
  version       integer NOT NULL,
  marks         numeric(6,2) CHECK (marks >= 0),
  absence_code  text CHECK (absence_code IN ('AB','EX','MED','NA')),        -- absent / exempt / medical / not applicable
  change_reason text,                                                        -- mandatory when version > 1 (domain rule)
  source        text NOT NULL DEFAULT 'web' CHECK (source IN ('web','excel_upload','teacher_app','gradebook','reopen')),
  entered_by    uuid NOT NULL,
  entered_at    timestamptz NOT NULL DEFAULT now(),
  CHECK ((marks IS NULL) <> (absence_code IS NULL)),
  UNIQUE (component_id, student_id, entry_round, version)
);
CREATE INDEX ix_mark_entry_paper ON exm.mark_entry (exam_paper_id, student_id);
-- RLS on (org_id, campus_id); REVOKE UPDATE, DELETE ON exm.mark_entry FROM sms_app;

CREATE TABLE exm.mark_current (                    -- latest round-1 value; maintained ONLY by trigger
  component_id  uuid NOT NULL,
  student_id    uuid NOT NULL,
  exam_paper_id uuid NOT NULL,
  org_id        uuid NOT NULL,
  campus_id     uuid NOT NULL,
  mark_entry_id bigint NOT NULL REFERENCES exm.mark_entry(id),
  marks         numeric(6,2),
  absence_code  text,
  version       integer NOT NULL,
  PRIMARY KEY (component_id, student_id)
);
CREATE INDEX ix_mark_current_paper ON exm.mark_current (exam_paper_id);

CREATE FUNCTION exm.tg_mark_entry_apply() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, exm AS $$
DECLARE v_status text;
BEGIN
  SELECT status INTO v_status FROM exm.exam_paper WHERE id = NEW.exam_paper_id FOR SHARE;
  IF v_status NOT IN ('open','reopened') THEN
    RAISE EXCEPTION 'paper % is %, marks are locked', NEW.exam_paper_id, v_status USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.entry_round = 1 THEN
    INSERT INTO exm.mark_current AS c (component_id, student_id, exam_paper_id, org_id, campus_id,
                                       mark_entry_id, marks, absence_code, version)
    VALUES (NEW.component_id, NEW.student_id, NEW.exam_paper_id, NEW.org_id, NEW.campus_id,
            NEW.id, NEW.marks, NEW.absence_code, NEW.version)
    ON CONFLICT (component_id, student_id) DO UPDATE
      SET mark_entry_id = EXCLUDED.mark_entry_id, marks = EXCLUDED.marks,
          absence_code = EXCLUDED.absence_code, version = EXCLUDED.version
      WHERE c.version < EXCLUDED.version;      -- optimistic: stale writes ignored, app detects via returned version
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER trg_mark_entry_apply AFTER INSERT ON exm.mark_entry
  FOR EACH ROW EXECUTE FUNCTION exm.tg_mark_entry_apply();

CREATE TABLE exm.paper_status_history (            -- submit / moderate / lock / reopen trail
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  exam_paper_id uuid NOT NULL REFERENCES exm.exam_paper(id),
  from_status   text NOT NULL,
  to_status     text NOT NULL,
  actor_user_id uuid NOT NULL,
  approval_request_id uuid,                        -- reopen requires approval
  comment       text,
  at            timestamptz NOT NULL DEFAULT now()
);

-- Derived results: recomputed by ResultCalculator; frozen (snapshot) when exam is published.
CREATE TABLE exm.result_subject (
  exam_id         uuid NOT NULL REFERENCES exm.exam(id),
  exam_paper_id   uuid NOT NULL REFERENCES exm.exam_paper(id),
  student_id      uuid NOT NULL,
  enrolment_id    uuid NOT NULL,
  org_id          uuid NOT NULL,
  campus_id       uuid NOT NULL,
  weighted_marks  numeric(7,3),
  percent         numeric(6,3),
  grade           text,
  grade_point     numeric(4,2),
  is_pass         boolean,
  rank_in_section integer,
  rank_in_year    integer,
  scheme_id       uuid NOT NULL,
  scheme_version  integer NOT NULL,
  computed_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (exam_paper_id, student_id)
);
CREATE INDEX ix_result_subject_student ON exm.result_subject (student_id, exam_id);

CREATE TABLE exm.result_summary (
  exam_id                 uuid NOT NULL REFERENCES exm.exam(id),
  student_id              uuid NOT NULL,
  enrolment_id            uuid NOT NULL,
  org_id                  uuid NOT NULL,
  campus_id               uuid NOT NULL,
  total_marks             numeric(8,3),
  percent                 numeric(6,3),
  gpa                     numeric(4,2),
  overall_grade           text,
  position_in_section     integer,                 -- optional per policy (EXM-06)
  attendance_percent      numeric(5,2),
  conduct_grade           text,
  class_teacher_remark_en text,
  class_teacher_remark_bn text,
  principal_remark        text,
  is_promoted             boolean,
  computed_at             timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (exam_id, student_id)
);  -- std(rls)

CREATE TABLE exm.report_card (                     -- EXM-05
  id                uuid PRIMARY KEY DEFAULT uuidv7(),
  org_id            uuid NOT NULL,
  campus_id         uuid NOT NULL,
  exam_id           uuid NOT NULL REFERENCES exm.exam(id),
  student_id        uuid NOT NULL,
  version           integer NOT NULL DEFAULT 1,
  template_id       uuid NOT NULL,                 -- doc.template
  locale            text NOT NULL CHECK (locale IN ('en','bn','bilingual')),
  file_id           uuid REFERENCES sys.stored_file(id),
  verification_code text NOT NULL UNIQUE,          -- QR verification (DOC-04)
  generated_at      timestamptz,
  published_at      timestamptz,
  superseded_at     timestamptz,
  UNIQUE (exam_id, student_id, version)
);  -- std(rls)

-- Pearson Edexcel external administration (EXM-07..09, P2)
CREATE TABLE exm.external_series (
  id             uuid PRIMARY KEY DEFAULT uuidv7(),
  org_id         uuid NOT NULL,
  awarding_body  text NOT NULL DEFAULT 'PEARSON_EDEXCEL',
  code           text NOT NULL,                    -- 'JUN-2027'
  entry_deadline date,
  late_deadline  date,
  results_on     date,
  UNIQUE (org_id, awarding_body, code)
);

CREATE TABLE exm.candidate (
  student_id     uuid NOT NULL,
  awarding_body  text NOT NULL DEFAULT 'PEARSON_EDEXCEL',
  candidate_no   text NOT NULL,
  uci            text,                             -- unique candidate identifier
  centre_no      text NOT NULL,
  PRIMARY KEY (student_id, awarding_body)
);

CREATE TABLE exm.external_entry (
  id               uuid PRIMARY KEY DEFAULT uuidv7(),
  org_id           uuid NOT NULL,
  campus_id        uuid NOT NULL,
  series_id        uuid NOT NULL REFERENCES exm.external_series(id),
  student_id       uuid NOT NULL,
  subject_id       uuid NOT NULL,
  entry_code       text NOT NULL,                  -- unit/option code
  is_resit         boolean NOT NULL DEFAULT false,
  is_cash_in       boolean NOT NULL DEFAULT false,
  access_arrangements text[] NOT NULL DEFAULT '{}',
  entry_fee_paisa  core.paisa_nn NOT NULL,
  invoice_line_id  uuid,                           -- billed via FEE
  status           text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','confirmed','exported','withdrawn')),
  exported_at      timestamptz,
  LIKE core.std_cols INCLUDING DEFAULTS,
  UNIQUE (series_id, student_id, entry_code)
);  -- std(audit, rls)

CREATE TABLE exm.external_result (
  entry_id     uuid PRIMARY KEY REFERENCES exm.external_entry(id),
  grade        text NOT NULL,
  ums          numeric(6,1),
  imported_at  timestamptz NOT NULL DEFAULT now(),
  import_batch_id uuid
);

CREATE TABLE exm.predicted_grade (                 -- EXM-08
  id             uuid PRIMARY KEY DEFAULT uuidv7(),
  org_id         uuid NOT NULL,
  campus_id      uuid NOT NULL,
  student_id     uuid NOT NULL,
  subject_id     uuid NOT NULL,
  series_id      uuid REFERENCES exm.external_series(id),
  grade          text NOT NULL,
  evidence       text,
  status         text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','submitted','approved','rejected')),
  approved_by    uuid,
  LIKE core.std_cols INCLUDING DEFAULTS
);  -- std(audit, rls)
