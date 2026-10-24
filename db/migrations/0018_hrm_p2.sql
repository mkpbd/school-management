-- 0018_hrm_p2: recruitment, onboarding/exit, appraisal, CPD (HRM-02, 03, 05, 06)

CREATE TABLE hrm.vacancy (                         -- HRM-02, synced to website careers page (WEB-04)
  id              uuid PRIMARY KEY DEFAULT uuidv7(),
  org_id          uuid NOT NULL,
  campus_id       uuid NOT NULL,
  title           text NOT NULL,
  department_id   uuid REFERENCES hrm.department(id),
  designation_id  uuid REFERENCES hrm.designation(id),
  description     text NOT NULL,
  requirements    text,
  openings        smallint NOT NULL DEFAULT 1,
  closes_on       date,
  publish_to_web  boolean NOT NULL DEFAULT true,
  status          text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','open','closed','filled','cancelled')),
  LIKE core.std_cols INCLUDING DEFAULTS
);

CREATE TABLE hrm.job_application (
  id              uuid PRIMARY KEY DEFAULT uuidv7(),
  org_id          uuid NOT NULL,
  campus_id       uuid NOT NULL,
  vacancy_id      uuid NOT NULL REFERENCES hrm.vacancy(id),
  full_name       text NOT NULL,
  email           citext NOT NULL,
  phone           core.phone_e164 NOT NULL,
  cv_file_id      uuid REFERENCES sys.stored_file(id),
  answers         jsonb NOT NULL DEFAULT '{}',
  stage           text NOT NULL DEFAULT 'applied'
                  CHECK (stage IN ('applied','shortlisted','interview','demo_class','offered','hired','rejected','withdrawn')),
  score           numeric(5,2),
  offer_document_id uuid,
  hired_staff_id  uuid REFERENCES hrm.staff(id),
  LIKE core.std_cols INCLUDING DEFAULTS
);
CREATE INDEX ix_job_application_vacancy ON hrm.job_application (vacancy_id, stage);

CREATE TABLE hrm.interview (
  id                 uuid PRIMARY KEY DEFAULT uuidv7(),
  job_application_id uuid NOT NULL REFERENCES hrm.job_application(id) ON DELETE CASCADE,
  scheduled_at       timestamptz NOT NULL,
  panel_staff_ids    uuid[] NOT NULL DEFAULT '{}',
  scores             jsonb NOT NULL DEFAULT '{}',   -- {criterion: score} per panelist
  recommendation     text CHECK (recommendation IN ('hire','hold','reject')),
  notes              text
);

CREATE TABLE hrm.lifecycle_task (                  -- HRM-03 onboarding & exit checklists
  id           uuid PRIMARY KEY DEFAULT uuidv7(),
  org_id       uuid NOT NULL,
  staff_id     uuid NOT NULL REFERENCES hrm.staff(id),
  kind         text NOT NULL CHECK (kind IN ('onboarding','exit')),
  task_code    text NOT NULL,                     -- IT_ACCOUNT, ID_CARD, UNIFORM, ORIENTATION, CLEARANCE_LIB, ...
  assignee_id  uuid,
  due_on       date,
  done_at      timestamptz,
  done_by      uuid,
  note         text,
  UNIQUE (staff_id, kind, task_code)
);

CREATE TABLE hrm.separation (                      -- resignation / termination with clearance
  id                 uuid PRIMARY KEY DEFAULT uuidv7(),
  org_id             uuid NOT NULL,
  campus_id          uuid NOT NULL,
  staff_id           uuid NOT NULL REFERENCES hrm.staff(id),
  kind               text NOT NULL CHECK (kind IN ('resignation','termination','retirement','contract_end')),
  notice_on          date NOT NULL,
  last_working_day   date NOT NULL,
  reason             text,
  clearance          jsonb NOT NULL DEFAULT '{}',
  experience_cert_document_id uuid,
  status             text NOT NULL DEFAULT 'initiated' CHECK (status IN ('initiated','clearance','settled','closed')),
  approval_request_id uuid,
  LIKE core.std_cols INCLUDING DEFAULTS
);

CREATE TABLE hrm.appraisal_cycle (                 -- HRM-05
  id         uuid PRIMARY KEY DEFAULT uuidv7(),
  org_id     uuid NOT NULL,
  name       text NOT NULL,
  starts_on  date NOT NULL,
  ends_on    date NOT NULL,
  form       jsonb NOT NULL,                       -- sections, criteria, weights
  status     text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','open','closed'))
);

CREATE TABLE hrm.appraisal (
  id               uuid PRIMARY KEY DEFAULT uuidv7(),
  org_id           uuid NOT NULL,
  campus_id        uuid NOT NULL,
  cycle_id         uuid NOT NULL REFERENCES hrm.appraisal_cycle(id),
  staff_id         uuid NOT NULL REFERENCES hrm.staff(id),
  reviewer_id      uuid REFERENCES hrm.staff(id),
  self_review      jsonb,
  reviewer_review  jsonb,
  student_feedback jsonb,
  overall_rating   numeric(3,1),
  goals            jsonb NOT NULL DEFAULT '[]',
  status           text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','self_done','reviewed','acknowledged')),
  LIKE core.std_cols INCLUDING DEFAULTS,
  UNIQUE (cycle_id, staff_id)
);

CREATE TABLE hrm.lesson_observation (
  id               uuid PRIMARY KEY DEFAULT uuidv7(),
  org_id           uuid NOT NULL,
  campus_id        uuid NOT NULL,
  staff_id         uuid NOT NULL REFERENCES hrm.staff(id),
  observer_id      uuid NOT NULL REFERENCES hrm.staff(id),
  teaching_group_id uuid REFERENCES aca.teaching_group(id),
  observed_on      date NOT NULL,
  ratings          jsonb NOT NULL,
  strengths        text,
  improvements     text,
  LIKE core.std_cols INCLUDING DEFAULTS
);

CREATE TABLE hrm.cpd_course (                      -- HRM-06 (P3)
  id         uuid PRIMARY KEY DEFAULT uuidv7(),
  org_id     uuid NOT NULL,
  title      text NOT NULL,
  provider   text,
  hours      numeric(5,1) NOT NULL,
  is_active  boolean NOT NULL DEFAULT true
);

CREATE TABLE hrm.cpd_record (
  id             uuid PRIMARY KEY DEFAULT uuidv7(),
  staff_id       uuid NOT NULL REFERENCES hrm.staff(id),
  cpd_course_id  uuid REFERENCES hrm.cpd_course(id),
  title          text NOT NULL,
  completed_on   date NOT NULL,
  hours          numeric(5,1) NOT NULL CHECK (hours > 0),
  certificate_file_id uuid REFERENCES sys.stored_file(id)
);
