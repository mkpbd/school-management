-- 0017_lrn_p2: lesson plans, online classes, question bank, quizzes/online tests, learner targets (LRN-01, 05, 06, 07, 09)

CREATE TABLE lrn.lesson_plan (                     -- LRN-01 aligned to Edexcel spec topics, HoD approval
  id                uuid PRIMARY KEY DEFAULT uuidv7(),
  org_id            uuid NOT NULL,
  campus_id         uuid NOT NULL,
  teaching_group_id uuid REFERENCES aca.teaching_group(id),
  subject_id        uuid NOT NULL REFERENCES aca.subject(id),
  year_group_id     uuid NOT NULL REFERENCES aca.year_group(id),
  author_staff_id   uuid NOT NULL,
  topic_id          uuid REFERENCES aca.syllabus_topic(id),
  title             text NOT NULL,
  planned_for       date,
  objectives        text[] NOT NULL DEFAULT '{}',
  body              jsonb NOT NULL DEFAULT '{}',   -- starter / main / plenary / differentiation / resources
  resource_ids      uuid[] NOT NULL DEFAULT '{}',
  is_shared         boolean NOT NULL DEFAULT false, -- shared plan library
  status            text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','submitted','approved','returned')),
  reviewed_by       uuid,
  reviewed_at       timestamptz,
  review_comment    text,
  LIKE core.std_cols INCLUDING DEFAULTS
);
CREATE INDEX ix_lesson_plan_group ON lrn.lesson_plan (teaching_group_id, planned_for);

CREATE TABLE lrn.online_session (                  -- LRN-05 Meet / Teams / Zoom
  id                uuid PRIMARY KEY DEFAULT uuidv7(),
  org_id            uuid NOT NULL,
  campus_id         uuid NOT NULL,
  teaching_group_id uuid NOT NULL REFERENCES aca.teaching_group(id),
  timetable_slot_id uuid REFERENCES aca.timetable_slot(id),
  provider          text NOT NULL CHECK (provider IN ('google_meet','ms_teams','zoom')),
  external_id       text,
  join_url          text NOT NULL,
  starts_at         timestamptz NOT NULL,
  ends_at           timestamptz NOT NULL,
  recording_url     text,
  lesson_plan_id    uuid REFERENCES lrn.lesson_plan(id),
  LIKE core.std_cols INCLUDING DEFAULTS,
  CHECK (ends_at > starts_at)
);

CREATE TABLE lrn.online_session_join (             -- join log -> period attendance
  online_session_id uuid NOT NULL REFERENCES lrn.online_session(id) ON DELETE CASCADE,
  student_id        uuid NOT NULL,
  joined_at         timestamptz NOT NULL,
  left_at           timestamptz,
  PRIMARY KEY (online_session_id, student_id, joined_at)
);

CREATE TABLE lrn.question (                        -- LRN-06 tagged question bank
  id              uuid PRIMARY KEY DEFAULT uuidv7(),
  org_id          uuid NOT NULL,
  subject_id      uuid NOT NULL REFERENCES aca.subject(id),
  year_group_id   uuid REFERENCES aca.year_group(id),
  topic_id        uuid REFERENCES aca.syllabus_topic(id),
  kind            text NOT NULL CHECK (kind IN ('mcq_single','mcq_multi','true_false','short','structured','numeric')),
  stem            text NOT NULL,
  options         jsonb,                           -- [{"key":"A","text":"...","correct":true}]
  answer          jsonb,                           -- model answer / numeric tolerance
  marks           numeric(6,2) NOT NULL CHECK (marks > 0),
  difficulty      smallint CHECK (difficulty BETWEEN 1 AND 5),
  tags            text[] NOT NULL DEFAULT '{}',
  is_active       boolean NOT NULL DEFAULT true,
  LIKE core.std_cols INCLUDING DEFAULTS
);
CREATE INDEX ix_question_subject_topic ON lrn.question (subject_id, topic_id) WHERE is_active;
CREATE INDEX ix_question_tags ON lrn.question USING gin (tags);

CREATE TABLE lrn.quiz (                            -- LRN-06 quizzes / LRN-07 online tests
  id                 uuid PRIMARY KEY DEFAULT uuidv7(),
  org_id             uuid NOT NULL,
  campus_id          uuid NOT NULL,
  teaching_group_id  uuid NOT NULL REFERENCES aca.teaching_group(id),
  title              text NOT NULL,
  kind               text NOT NULL DEFAULT 'quiz' CHECK (kind IN ('quiz','online_test','mock')),
  opens_at           timestamptz NOT NULL,
  closes_at          timestamptz NOT NULL,
  time_limit         interval,
  shuffle_questions  boolean NOT NULL DEFAULT true,
  shuffle_options    boolean NOT NULL DEFAULT true,
  lockdown_required  boolean NOT NULL DEFAULT false,
  max_attempts       smallint NOT NULL DEFAULT 1,
  gradebook_item_id  uuid REFERENCES lrn.gradebook_item(id),
  status             text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','closed','archived')),
  LIKE core.std_cols INCLUDING DEFAULTS,
  CHECK (closes_at > opens_at)
);

CREATE TABLE lrn.quiz_question (
  quiz_id     uuid NOT NULL REFERENCES lrn.quiz(id) ON DELETE CASCADE,
  question_id uuid NOT NULL REFERENCES lrn.question(id),
  seq         smallint NOT NULL,
  marks       numeric(6,2) NOT NULL,
  PRIMARY KEY (quiz_id, question_id)
);

CREATE TABLE lrn.quiz_attempt (
  id            uuid PRIMARY KEY DEFAULT uuidv7(),
  org_id        uuid NOT NULL,
  campus_id     uuid NOT NULL,
  quiz_id       uuid NOT NULL REFERENCES lrn.quiz(id),
  student_id    uuid NOT NULL,
  attempt_no    smallint NOT NULL DEFAULT 1,
  started_at    timestamptz NOT NULL DEFAULT now(),
  submitted_at  timestamptz,
  auto_submitted boolean NOT NULL DEFAULT false,
  answers       jsonb NOT NULL DEFAULT '{}',      -- {questionId: answer}
  auto_score    numeric(7,2),
  manual_score  numeric(7,2),                     -- teacher moderation of free text
  status        text NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress','submitted','graded')),
  UNIQUE (quiz_id, student_id, attempt_no)
);

CREATE TABLE lrn.learner_target (                  -- LRN-09 baseline / target / working-at grades
  id                 uuid PRIMARY KEY DEFAULT uuidv7(),
  org_id             uuid NOT NULL,
  campus_id          uuid NOT NULL,
  student_id         uuid NOT NULL,
  academic_year_id   uuid NOT NULL REFERENCES core.academic_year(id),
  subject_id         uuid NOT NULL REFERENCES aca.subject(id),
  baseline_grade     text,
  target_grade       text,
  working_at_grade   text,
  intervention_flag  boolean NOT NULL DEFAULT false,
  note               text,
  LIKE core.std_cols INCLUDING DEFAULTS,
  UNIQUE (student_id, academic_year_id, subject_id)
);
