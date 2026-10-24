-- 0011_lrn: generated from SYSTEM_DESIGN.md section 6, then extended.
-- Run as sms_owner. Standard triggers/RLS are applied in 0030_standardize.sql.

CREATE TABLE lrn.homework (                        -- LRN-02
  id                uuid PRIMARY KEY DEFAULT uuidv7(),
  org_id            uuid NOT NULL,
  campus_id         uuid NOT NULL,
  teaching_group_id uuid NOT NULL REFERENCES aca.teaching_group(id),
  subject_id        uuid NOT NULL,
  set_by_staff_id   uuid NOT NULL,
  title             text NOT NULL,
  instructions      text,
  attachment_file_ids uuid[] NOT NULL DEFAULT '{}',
  assigned_on       date NOT NULL,
  due_at            timestamptz NOT NULL,
  submission_mode   text NOT NULL DEFAULT 'online' CHECK (submission_mode IN ('online','offline','none')),
  max_score         numeric(6,2),
  late_policy       text NOT NULL DEFAULT 'allow_flag' CHECK (late_policy IN ('reject','allow_flag','allow_penalty')),
  late_penalty_pct  core.percent,
  status            text NOT NULL DEFAULT 'published' CHECK (status IN ('draft','published','closed','cancelled')),
  LIKE core.std_cols INCLUDING DEFAULTS
);  -- std(rls)
CREATE INDEX ix_homework_group_due ON lrn.homework (teaching_group_id, due_at DESC);

CREATE TABLE lrn.homework_submission (
  id            uuid PRIMARY KEY DEFAULT uuidv7(),
  org_id        uuid NOT NULL,
  campus_id     uuid NOT NULL,
  homework_id   uuid NOT NULL REFERENCES lrn.homework(id),
  student_id    uuid NOT NULL,
  file_ids      uuid[] NOT NULL DEFAULT '{}',
  text_answer   text,
  submitted_at  timestamptz,
  is_late       boolean NOT NULL DEFAULT false,
  status        text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','submitted','returned','graded','missing')),
  score         numeric(6,2),
  feedback      text,
  graded_by     uuid,
  graded_at     timestamptz,
  LIKE core.std_cols INCLUDING DEFAULTS,
  UNIQUE (homework_id, student_id)
);  -- std(rls)

CREATE TABLE lrn.class_diary (                     -- LRN-03 daily digest for parent app
  id               uuid PRIMARY KEY DEFAULT uuidv7(),
  org_id           uuid NOT NULL,
  campus_id        uuid NOT NULL,
  class_section_id uuid NOT NULL REFERENCES aca.class_section(id),
  diary_date       date NOT NULL,
  entries          jsonb NOT NULL DEFAULT '[]',     -- [{"subject":"MATH","topic":"...","note":"..."}]
  reminders        text,                            -- uniform/kit notes
  published_at     timestamptz,
  LIKE core.std_cols INCLUDING DEFAULTS,
  UNIQUE (class_section_id, diary_date)
);  -- std(rls)

CREATE TABLE lrn.learning_resource (               -- LRN-04
  id               uuid PRIMARY KEY DEFAULT uuidv7(),
  org_id           uuid NOT NULL,
  campus_id        uuid,                            -- NULL = all campuses
  subject_id       uuid NOT NULL,
  year_group_id    uuid,
  teaching_group_id uuid,
  title            text NOT NULL,
  kind             text NOT NULL CHECK (kind IN ('notes','slides','video','past_paper','worksheet','link')),
  file_id          uuid REFERENCES sys.stored_file(id),
  url              text,
  visibility       text NOT NULL DEFAULT 'students' CHECK (visibility IN ('staff','students','students_and_parents')),
  download_count   integer NOT NULL DEFAULT 0,
  LIKE core.std_cols INCLUDING DEFAULTS,
  CHECK (file_id IS NOT NULL OR url IS NOT NULL)
);  -- std(rls)

CREATE TABLE lrn.gradebook_item (                  -- LRN-08 continuous assessment
  id                uuid PRIMARY KEY DEFAULT uuidv7(),
  org_id            uuid NOT NULL,
  campus_id         uuid NOT NULL,
  teaching_group_id uuid NOT NULL REFERENCES aca.teaching_group(id),
  term_id           uuid NOT NULL REFERENCES core.term(id),
  category          text NOT NULL CHECK (category IN ('classwork','project','practical','quiz','homework','presentation')),
  title             text NOT NULL,
  max_score         numeric(6,2) NOT NULL CHECK (max_score > 0),
  weight            numeric(5,2) NOT NULL DEFAULT 1,
  assessed_on       date NOT NULL,
  homework_id       uuid REFERENCES lrn.homework(id),
  status            text NOT NULL DEFAULT 'open' CHECK (status IN ('open','moderated','locked')),
  LIKE core.std_cols INCLUDING DEFAULTS
);  -- std(audit, rls)

CREATE TABLE lrn.gradebook_score (
  gradebook_item_id uuid NOT NULL REFERENCES lrn.gradebook_item(id) ON DELETE CASCADE,
  student_id        uuid NOT NULL,
  score             numeric(6,2),
  absence_code      text CHECK (absence_code IN ('AB','EX')),
  comment           text,
  entered_by        uuid NOT NULL,
  entered_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (gradebook_item_id, student_id),
  CHECK ((score IS NULL) <> (absence_code IS NULL))
);  -- std(audit)

-- P2/P3 LRN tables (lesson plans, online classes, question bank, quizzes, learner targets): see 0017_lrn_p2.sql
