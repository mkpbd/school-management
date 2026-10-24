-- 0002_core: generated from SYSTEM_DESIGN.md section 6, then extended.
-- Run as sms_owner. Standard triggers/RLS are applied in 0030_standardize.sql.

CREATE TABLE core.organisation (
  id        uuid PRIMARY KEY DEFAULT uuidv7(),
  code      text NOT NULL UNIQUE,
  name_en   text NOT NULL,
  name_bn   text,
  timezone  text NOT NULL DEFAULT 'Asia/Dhaka',
  currency  char(3) NOT NULL DEFAULT 'BDT',
  settings  jsonb NOT NULL DEFAULT '{}',          -- default locale, Hijri display, branding
  LIKE core.std_cols INCLUDING DEFAULTS
);

CREATE TABLE core.campus (
  id                 uuid PRIMARY KEY DEFAULT uuidv7(),
  org_id             uuid NOT NULL REFERENCES core.organisation(id),
  code               text NOT NULL,              -- DHN, GUL, LAL
  name_en            text NOT NULL,
  name_bn            text,
  address_en         text,
  address_bn         text,
  phone              core.phone_e164,
  email              citext,
  letterhead_file_id uuid,
  signature_file_id  uuid,
  is_active          boolean NOT NULL DEFAULT true,
  LIKE core.std_cols INCLUDING DEFAULTS,
  UNIQUE (org_id, code)
);

CREATE TABLE core.org_module (                     -- feature switches per phase
  org_id      uuid NOT NULL REFERENCES core.organisation(id),
  module_code text NOT NULL,                       -- 'trn','lib','inv',...
  enabled     boolean NOT NULL DEFAULT false,
  enabled_at  timestamptz,
  PRIMARY KEY (org_id, module_code)
);

CREATE TABLE core.academic_year (
  id         uuid PRIMARY KEY DEFAULT uuidv7(),
  org_id     uuid NOT NULL REFERENCES core.organisation(id),
  code       text NOT NULL,                        -- '2026-27'
  starts_on  date NOT NULL,
  ends_on    date NOT NULL,
  status     text NOT NULL DEFAULT 'planned'
             CHECK (status IN ('planned','open','closing','locked','archived')),
  is_current boolean NOT NULL DEFAULT false,
  LIKE core.std_cols INCLUDING DEFAULTS,
  UNIQUE (org_id, code),
  CHECK (ends_on > starts_on),
  EXCLUDE USING gist (org_id WITH =, daterange(starts_on, ends_on, '[]') WITH &&)
);
CREATE UNIQUE INDEX ux_academic_year_current ON core.academic_year (org_id) WHERE is_current;

CREATE TABLE core.term (
  id               uuid PRIMARY KEY DEFAULT uuidv7(),
  academic_year_id uuid NOT NULL REFERENCES core.academic_year(id) ON DELETE CASCADE,
  seq              smallint NOT NULL,
  code             text NOT NULL,                  -- T1, T2, T3
  name_en          text NOT NULL,
  name_bn          text,
  starts_on        date NOT NULL,
  ends_on          date NOT NULL,
  LIKE core.std_cols INCLUDING DEFAULTS,
  UNIQUE (academic_year_id, seq),
  EXCLUDE USING gist (academic_year_id WITH =, daterange(starts_on, ends_on, '[]') WITH &&)
);

CREATE TABLE core.shift (
  id        uuid PRIMARY KEY DEFAULT uuidv7(),
  org_id    uuid NOT NULL,
  campus_id uuid NOT NULL REFERENCES core.campus(id),
  code      text NOT NULL,                         -- MORNING, DAY
  name_en   text NOT NULL,
  name_bn   text,
  starts_at time NOT NULL,
  ends_at   time NOT NULL,
  LIKE core.std_cols INCLUDING DEFAULTS,
  UNIQUE (campus_id, code)
);  -- std(rls)

CREATE TABLE core.room (
  id        uuid PRIMARY KEY DEFAULT uuidv7(),
  org_id    uuid NOT NULL,
  campus_id uuid NOT NULL REFERENCES core.campus(id),
  code      text NOT NULL,
  name      text NOT NULL,
  room_type text NOT NULL CHECK (room_type IN ('classroom','lab','ict_lab','hall','library','playground','office','other')),
  capacity  smallint,
  exam_capacity smallint,
  is_bookable boolean NOT NULL DEFAULT false,
  LIKE core.std_cols INCLUDING DEFAULTS,
  UNIQUE (campus_id, code)
);  -- std(rls)

CREATE TABLE core.calendar_event (                 -- ACA-06 academic calendar + holidays
  id               uuid PRIMARY KEY DEFAULT uuidv7(),
  org_id           uuid NOT NULL,
  campus_id        uuid REFERENCES core.campus(id), -- NULL = all campuses
  academic_year_id uuid NOT NULL REFERENCES core.academic_year(id),
  kind             text NOT NULL CHECK (kind IN ('holiday_national','holiday_islamic','holiday_school',
                                                 'exam_window','ptm','event','term_break','ramadan_routine')),
  title_en         text NOT NULL,
  title_bn         text,
  starts_on        date NOT NULL,
  ends_on          date NOT NULL,
  is_instructional boolean NOT NULL DEFAULT false, -- false => no attendance expected
  audience         text NOT NULL DEFAULT 'all' CHECK (audience IN ('all','staff','students')),
  is_tentative     boolean NOT NULL DEFAULT false, -- moon-sighting dependent
  publish_to_web   boolean NOT NULL DEFAULT false,
  LIKE core.std_cols INCLUDING DEFAULTS,
  CHECK (ends_on >= starts_on)
);  -- std(audit, rls)
CREATE INDEX ix_calendar_event_range ON core.calendar_event USING gist (org_id, daterange(starts_on, ends_on, '[]'));

CREATE TABLE core.hijri_adjustment (               -- CCA-07 moon-sighting offsets
  org_id         uuid NOT NULL,
  hijri_year     smallint NOT NULL,
  hijri_month    smallint NOT NULL CHECK (hijri_month BETWEEN 1 AND 12),
  offset_days    smallint NOT NULL CHECK (offset_days BETWEEN -2 AND 2),
  PRIMARY KEY (org_id, hijri_year, hijri_month)
);

CREATE TABLE core.lookup_value (                   -- configurable dropdowns (occupations, doc types, lost reasons...)
  id        uuid PRIMARY KEY DEFAULT uuidv7(),
  org_id    uuid NOT NULL,
  list_code text NOT NULL,
  code      text NOT NULL,
  label_en  text NOT NULL,
  label_bn  text,
  seq       smallint NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  meta      jsonb NOT NULL DEFAULT '{}',
  UNIQUE (org_id, list_code, code)
);

CREATE TABLE core.setting (                        -- CORE-06 master settings (typed via JSON schema in app)
  org_id    uuid NOT NULL,
  campus_id uuid,                                  -- NULL = org default, campus row overrides
  key       text NOT NULL,                         -- 'attendance.late_cutoff', 'sms.sender_id', ...
  value     jsonb NOT NULL,
  LIKE core.std_cols INCLUDING DEFAULTS,
  UNIQUE NULLS NOT DISTINCT (org_id, campus_id, key)
);

CREATE TABLE core.number_sequence (                -- I-8 gap-free numbering
  id         uuid PRIMARY KEY DEFAULT uuidv7(),
  org_id     uuid NOT NULL,
  campus_id  uuid,                                 -- NULL = org-wide
  seq_key    text NOT NULL,                        -- 'admission_no','invoice','receipt','tc','application'
  period_key text NOT NULL DEFAULT '',             -- '2026-27' | '2026' | '' (never resets)
  format     text NOT NULL,                        -- '{CAMPUS}-RCP-{PERIOD}-{SEQ:6}'
  next_value bigint NOT NULL DEFAULT 1,
  UNIQUE NULLS NOT DISTINCT (org_id, campus_id, seq_key, period_key)
);
-- Allocation inside the business transaction (row lock => gap-free; rolled back with the tx):
-- UPDATE core.number_sequence SET next_value = next_value + 1
--  WHERE org_id = $1 AND campus_id IS NOT DISTINCT FROM $2 AND seq_key = $3 AND period_key = $4
-- RETURNING next_value - 1 AS value, format;
