-- 0007_aca: generated from SYSTEM_DESIGN.md section 6, then extended.
-- Run as sms_owner. Standard triggers/RLS are applied in 0030_standardize.sql.

CREATE TABLE aca.programme (                       -- EY, PRIMARY, LOWER_SEC, IGCSE, IAL
  id                 uuid PRIMARY KEY DEFAULT uuidv7(),
  org_id             uuid NOT NULL,
  code               text NOT NULL,
  name_en            text NOT NULL,
  name_bn            text,
  awarding_body      text,                         -- 'PEARSON_EDEXCEL' | NULL (internal)
  default_grading_scheme_id uuid,                  -- FK added after exm.grading_scheme
  seq                smallint NOT NULL,
  LIKE core.std_cols INCLUDING DEFAULTS,
  UNIQUE (org_id, code)
);

CREATE TABLE aca.year_group (                      -- Nursery..Y13 / AS / A2
  id              uuid PRIMARY KEY DEFAULT uuidv7(),
  programme_id    uuid NOT NULL REFERENCES aca.programme(id),
  code            text NOT NULL,                   -- 'Y7'
  name_en         text NOT NULL,
  name_bn         text,
  seq             smallint NOT NULL,               -- global ordering for promotion (Y7 -> Y8)
  next_year_group_id uuid REFERENCES aca.year_group(id),
  min_age_months  smallint,                        -- admission age cut-off
  max_age_months  smallint,
  LIKE core.std_cols INCLUDING DEFAULTS,
  UNIQUE (programme_id, code)
);

CREATE TABLE aca.class_section (
  id                  uuid PRIMARY KEY DEFAULT uuidv7(),
  org_id              uuid NOT NULL,
  campus_id           uuid NOT NULL REFERENCES core.campus(id),
  academic_year_id    uuid NOT NULL REFERENCES core.academic_year(id),
  year_group_id       uuid NOT NULL REFERENCES aca.year_group(id),
  shift_id            uuid REFERENCES core.shift(id),
  name                text NOT NULL,               -- 'A', 'Rose', 'Boys-1'
  display_name        text NOT NULL,               -- 'Year 7 - A'
  class_teacher_staff_id uuid,                     -- FK hrm.staff
  head_of_section_staff_id uuid,
  home_room_id        uuid REFERENCES core.room(id),
  capacity            smallint NOT NULL CHECK (capacity > 0),
  gender_policy       text NOT NULL DEFAULT 'mixed' CHECK (gender_policy IN ('mixed','boys','girls')),
  LIKE core.std_cols INCLUDING DEFAULTS,
  UNIQUE (campus_id, academic_year_id, year_group_id, name)
);  -- std(audit, rls)

CREATE TABLE aca.subject (
  id               uuid PRIMARY KEY DEFAULT uuidv7(),
  org_id           uuid NOT NULL,
  code             text NOT NULL,                  -- 'PHY', 'BAN', 'ISL'
  name_en          text NOT NULL,
  name_bn          text,
  kind             text NOT NULL CHECK (kind IN ('core','optional','elective','co_curricular','religious','language')),
  external_code    text,                           -- Edexcel spec code e.g. '4PH1'
  is_graded        boolean NOT NULL DEFAULT true,
  LIKE core.std_cols INCLUDING DEFAULTS,
  UNIQUE (org_id, code)
);

CREATE TABLE aca.subject_group (                   -- ACA-02 choice groups (pick 1 of Physics/Business...)
  id            uuid PRIMARY KEY DEFAULT uuidv7(),
  programme_id  uuid NOT NULL REFERENCES aca.programme(id),
  code          text NOT NULL,
  name_en       text NOT NULL,
  min_choose    smallint NOT NULL DEFAULT 1,
  max_choose    smallint NOT NULL DEFAULT 1,
  rules         jsonb NOT NULL DEFAULT '{}',       -- incompatibilities, prerequisites (validated in domain)
  UNIQUE (programme_id, code),
  CHECK (max_choose >= min_choose)
);

CREATE TABLE aca.curriculum_subject (              -- what a year group studies in a given year
  id                 uuid PRIMARY KEY DEFAULT uuidv7(),
  academic_year_id   uuid NOT NULL REFERENCES core.academic_year(id),
  year_group_id      uuid NOT NULL REFERENCES aca.year_group(id),
  subject_id         uuid NOT NULL REFERENCES aca.subject(id),
  subject_group_id   uuid REFERENCES aca.subject_group(id),   -- NULL = compulsory
  periods_per_week   smallint NOT NULL DEFAULT 0,
  grading_scheme_id  uuid,                                    -- override of programme default
  report_order       smallint NOT NULL DEFAULT 0,
  UNIQUE (academic_year_id, year_group_id, subject_id)
);

CREATE TABLE aca.teaching_group (
  id               uuid PRIMARY KEY DEFAULT uuidv7(),
  org_id           uuid NOT NULL,
  campus_id        uuid NOT NULL,
  academic_year_id uuid NOT NULL REFERENCES core.academic_year(id),
  subject_id       uuid NOT NULL REFERENCES aca.subject(id),
  year_group_id    uuid NOT NULL REFERENCES aca.year_group(id),
  name             text NOT NULL,                  -- 'Y10 Physics Set 1'
  membership       text NOT NULL CHECK (membership IN ('whole_section','explicit')),
  class_section_id uuid REFERENCES aca.class_section(id),   -- when whole_section
  LIKE core.std_cols INCLUDING DEFAULTS,
  CHECK ((membership = 'whole_section') = (class_section_id IS NOT NULL))
);  -- std(audit, rls)

CREATE TABLE aca.teaching_group_teacher (          -- ACA-03 teacher-subject-class allocation
  teaching_group_id uuid NOT NULL REFERENCES aca.teaching_group(id) ON DELETE CASCADE,
  staff_id          uuid NOT NULL,
  role              text NOT NULL DEFAULT 'main' CHECK (role IN ('main','assistant')),
  periods_per_week  smallint NOT NULL DEFAULT 0,
  valid_from        date NOT NULL,
  valid_to          date,
  PRIMARY KEY (teaching_group_id, staff_id, valid_from)
);

CREATE TABLE aca.teaching_group_member (           -- explicit membership (electives)
  teaching_group_id uuid NOT NULL REFERENCES aca.teaching_group(id) ON DELETE CASCADE,
  enrolment_id      uuid NOT NULL,                 -- FK sis.enrolment
  joined_on         date NOT NULL,
  left_on           date,
  PRIMARY KEY (teaching_group_id, enrolment_id)
);

CREATE TABLE aca.period_definition (               -- bell schedule per campus/shift
  id         uuid PRIMARY KEY DEFAULT uuidv7(),
  org_id     uuid NOT NULL,
  campus_id  uuid NOT NULL,
  shift_id   uuid NOT NULL REFERENCES core.shift(id),
  schedule_code text NOT NULL DEFAULT 'regular',   -- 'regular' | 'ramadan' (CCA-07)
  period_no  smallint NOT NULL,
  label      text NOT NULL,                        -- 'P1', 'Break', 'Zuhr'
  kind       text NOT NULL CHECK (kind IN ('teaching','break','prayer','assembly','registration')),
  starts_at  time NOT NULL,
  ends_at    time NOT NULL,
  UNIQUE (shift_id, schedule_code, period_no),
  CHECK (ends_at > starts_at)
);  -- std(rls)

CREATE TABLE aca.timetable (
  id               uuid PRIMARY KEY DEFAULT uuidv7(),
  org_id           uuid NOT NULL,
  campus_id        uuid NOT NULL,
  academic_year_id uuid NOT NULL,
  name             text NOT NULL,
  status           text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','archived')),
  effective_from   date NOT NULL,
  effective_to     date,
  LIKE core.std_cols INCLUDING DEFAULTS
);  -- std(audit, rls)
CREATE UNIQUE INDEX ux_timetable_published ON aca.timetable (campus_id, academic_year_id, effective_from)
  WHERE status = 'published';

CREATE TABLE aca.timetable_slot (
  id                   uuid PRIMARY KEY DEFAULT uuidv7(),
  timetable_id         uuid NOT NULL REFERENCES aca.timetable(id) ON DELETE CASCADE,
  day_of_week          smallint NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),  -- 6 = Saturday (BD week Sat-Thu)
  period_definition_id uuid NOT NULL REFERENCES aca.period_definition(id),
  teaching_group_id    uuid NOT NULL REFERENCES aca.teaching_group(id),
  staff_id             uuid NOT NULL,
  room_id              uuid REFERENCES core.room(id),
  online_meeting_url   text,                                                    -- LRN-05
  UNIQUE (timetable_id, day_of_week, period_definition_id, teaching_group_id),
  UNIQUE (timetable_id, day_of_week, period_definition_id, staff_id),          -- teacher clash
  UNIQUE (timetable_id, day_of_week, period_definition_id, room_id)            -- room clash
);
-- Student/section clash (a student in two groups at the same time) is validated by the TimetableClashChecker
-- domain service before publish; max periods/day and consecutive limits likewise.

CREATE TABLE aca.substitution (                    -- ACA-05
  id                uuid PRIMARY KEY DEFAULT uuidv7(),
  org_id            uuid NOT NULL,
  campus_id         uuid NOT NULL,
  cover_date        date NOT NULL,
  timetable_slot_id uuid NOT NULL REFERENCES aca.timetable_slot(id),
  absent_staff_id   uuid NOT NULL,
  cover_staff_id    uuid,
  reason            text,
  status            text NOT NULL DEFAULT 'open' CHECK (status IN ('open','assigned','accepted','cancelled','completed')),
  payable           boolean NOT NULL DEFAULT true,  -- HRM cover-period pay
  assigned_by       uuid,
  notified_at       timestamptz,
  LIKE core.std_cols INCLUDING DEFAULTS,
  UNIQUE (cover_date, timetable_slot_id)
);  -- std(audit, rls)
CREATE INDEX ix_substitution_cover ON aca.substitution (cover_staff_id, cover_date);

CREATE TABLE aca.syllabus_topic (                  -- ACA-09 / LRN-01 (P2)
  id               uuid PRIMARY KEY DEFAULT uuidv7(),
  academic_year_id uuid NOT NULL,
  year_group_id    uuid NOT NULL,
  subject_id       uuid NOT NULL,
  term_id          uuid REFERENCES core.term(id),
  seq              smallint NOT NULL,
  title            text NOT NULL,
  spec_reference   text,                           -- Edexcel spec point
  planned_periods  smallint
);
CREATE TABLE aca.syllabus_coverage (
  teaching_group_id uuid NOT NULL REFERENCES aca.teaching_group(id),
  topic_id          uuid NOT NULL REFERENCES aca.syllabus_topic(id),
  covered_on        date NOT NULL,
  percent_covered   core.percent NOT NULL,
  reported_by       uuid NOT NULL,
  reviewed_by       uuid,
  PRIMARY KEY (teaching_group_id, topic_id)
);
