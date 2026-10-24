-- 0025_cca: houses, clubs, events, sports, awards, Quran & Islamic studies, donations (CCA-01..08)

CREATE TABLE cca.house (                           -- CCA-02
  id         uuid PRIMARY KEY DEFAULT uuidv7(),
  org_id     uuid NOT NULL,
  code       text NOT NULL,
  name_en    text NOT NULL,
  name_bn    text,
  colour_hex text,
  is_active  boolean NOT NULL DEFAULT true,
  UNIQUE (org_id, code)
);

CREATE TABLE cca.house_captain (
  house_id         uuid NOT NULL REFERENCES cca.house(id),
  academic_year_id uuid NOT NULL REFERENCES core.academic_year(id),
  campus_id        uuid NOT NULL REFERENCES core.campus(id),
  student_id       uuid NOT NULL REFERENCES sis.student(id),
  role             text NOT NULL DEFAULT 'captain' CHECK (role IN ('captain','vice_captain','prefect')),
  PRIMARY KEY (house_id, academic_year_id, campus_id, role)
);

CREATE TABLE cca.house_point (                     -- live leaderboard source (append-only)
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id           uuid NOT NULL,
  campus_id        uuid NOT NULL,
  academic_year_id uuid NOT NULL,
  house_id         uuid NOT NULL REFERENCES cca.house(id),
  student_id       uuid,
  source           text NOT NULL CHECK (source IN ('academic','sports','behaviour','event','manual')),
  source_ref       text,
  points           integer NOT NULL,
  awarded_by       uuid NOT NULL,
  awarded_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_house_point_board ON cca.house_point (academic_year_id, house_id);

CREATE TABLE cca.club (                            -- CCA-01
  id               uuid PRIMARY KEY DEFAULT uuidv7(),
  org_id           uuid NOT NULL,
  campus_id        uuid NOT NULL,
  academic_year_id uuid NOT NULL REFERENCES core.academic_year(id),
  name             text NOT NULL,
  kind             text NOT NULL CHECK (kind IN ('club','sport','society','quran_circle','music','art','debate','other')),
  advisor_staff_id uuid REFERENCES hrm.staff(id),
  capacity         smallint,
  eligible_year_group_ids uuid[] NOT NULL DEFAULT '{}',
  fee_paisa        core.paisa_nn NOT NULL DEFAULT 0,  -- activity fee -> FEE student_fee_item
  meets            jsonb,                          -- [{"dow":1,"start":"14:00","end":"15:00","room":...}]
  signup_opens_at  timestamptz,
  signup_closes_at timestamptz,
  LIKE core.std_cols INCLUDING DEFAULTS
);

CREATE TABLE cca.club_membership (
  club_id     uuid NOT NULL REFERENCES cca.club(id) ON DELETE CASCADE,
  student_id  uuid NOT NULL REFERENCES sis.student(id),
  status      text NOT NULL DEFAULT 'active' CHECK (status IN ('waitlisted','active','left')),
  joined_on   date NOT NULL DEFAULT current_date,
  left_on     date,
  fee_item_id uuid REFERENCES fee.student_fee_item(id),
  PRIMARY KEY (club_id, student_id)
);

CREATE TABLE cca.activity_session (
  id          uuid PRIMARY KEY DEFAULT uuidv7(),
  club_id     uuid NOT NULL REFERENCES cca.club(id) ON DELETE CASCADE,
  session_date date NOT NULL,
  attendance  jsonb NOT NULL DEFAULT '{}',         -- {studentId: 'present'|'absent'}
  note        text,
  UNIQUE (club_id, session_date)
);

CREATE TABLE cca.event (                           -- CCA-04 field trips & events, CCA-03 sports day
  id            uuid PRIMARY KEY DEFAULT uuidv7(),
  org_id        uuid NOT NULL,
  campus_id     uuid,
  kind          text NOT NULL CHECK (kind IN ('field_trip','sports_day','competition','cultural','religious','charity','other')),
  title         text NOT NULL,
  starts_at     timestamptz NOT NULL,
  ends_at       timestamptz NOT NULL,
  venue         text,
  budget_paisa  core.paisa_nn,
  requires_consent boolean NOT NULL DEFAULT false,
  consent_form_id uuid,                            -- prt.form_definition
  transport_needed boolean NOT NULL DEFAULT false,
  status        text NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','open','closed','completed','cancelled')),
  LIKE core.std_cols INCLUDING DEFAULTS,
  CHECK (ends_at >= starts_at)
);

CREATE TABLE cca.event_participant (
  event_id    uuid NOT NULL REFERENCES cca.event(id) ON DELETE CASCADE,
  student_id  uuid NOT NULL REFERENCES sis.student(id),
  consent     text NOT NULL DEFAULT 'pending' CHECK (consent IN ('not_required','pending','granted','declined')),
  attended    boolean,
  PRIMARY KEY (event_id, student_id)
);

CREATE TABLE cca.competition_result (              -- CCA-03 heats, results, medal tally
  id           uuid PRIMARY KEY DEFAULT uuidv7(),
  event_id     uuid NOT NULL REFERENCES cca.event(id) ON DELETE CASCADE,
  category     text NOT NULL,                      -- '100m U-12 Boys'
  round        text NOT NULL DEFAULT 'final',
  student_id   uuid REFERENCES sis.student(id),
  house_id     uuid REFERENCES cca.house(id),
  position     smallint,
  result_value text,                               -- time / distance / score
  medal        text CHECK (medal IN ('gold','silver','bronze'))
);

CREATE TABLE cca.award (                           -- CCA-05 (certificate issued via DOC)
  id            uuid PRIMARY KEY DEFAULT uuidv7(),
  org_id        uuid NOT NULL,
  campus_id     uuid NOT NULL,
  student_id    uuid NOT NULL REFERENCES sis.student(id),
  kind          text NOT NULL CHECK (kind IN ('merit','attendance','participation','sports','academic','character')),
  title         text NOT NULL,
  awarded_on    date NOT NULL,
  issued_document_id uuid REFERENCES doc.issued_document(id),
  LIKE core.std_cols INCLUDING DEFAULTS
);

CREATE TABLE cca.quran_milestone (                 -- CCA-06 configurable milestone catalogue
  id         uuid PRIMARY KEY DEFAULT uuidv7(),
  org_id     uuid NOT NULL,
  track      text NOT NULL CHECK (track IN ('recitation','memorisation','tajweed')),
  code       text NOT NULL,                        -- 'JUZ_30', 'SURAH_YASIN'
  label_en   text NOT NULL,
  label_bn   text,
  seq        smallint NOT NULL,
  UNIQUE (org_id, track, code)
);

CREATE TABLE cca.quran_progress (
  id             uuid PRIMARY KEY DEFAULT uuidv7(),
  org_id         uuid NOT NULL,
  campus_id      uuid NOT NULL,
  student_id     uuid NOT NULL REFERENCES sis.student(id),
  milestone_id   uuid NOT NULL REFERENCES cca.quran_milestone(id),
  status         text NOT NULL CHECK (status IN ('in_progress','achieved','revising')),
  assessed_on    date NOT NULL,
  rating         smallint CHECK (rating BETWEEN 1 AND 5),
  teacher_id     uuid NOT NULL,
  note           text,
  LIKE core.std_cols INCLUDING DEFAULTS,
  UNIQUE (student_id, milestone_id)
);

CREATE TABLE cca.donation_drive (                  -- CCA-08 (P3) kept separate from fees
  id           uuid PRIMARY KEY DEFAULT uuidv7(),
  org_id       uuid NOT NULL,
  campus_id    uuid,
  kind         text NOT NULL CHECK (kind IN ('sadaqah','zakat','fitra','relief','other')),
  title        text NOT NULL,
  starts_on    date NOT NULL,
  ends_on      date,
  target_paisa core.paisa_nn,
  LIKE core.std_cols INCLUDING DEFAULTS
);
CREATE TABLE cca.donation (
  id            uuid PRIMARY KEY DEFAULT uuidv7(),
  org_id        uuid NOT NULL,
  campus_id     uuid NOT NULL,
  drive_id      uuid NOT NULL REFERENCES cca.donation_drive(id),
  donor_name    text,
  family_id     uuid REFERENCES sis.family(id),
  amount_paisa  core.paisa_nn NOT NULL CHECK (amount_paisa > 0),
  channel       text NOT NULL CHECK (channel IN ('cash','bkash','nagad','bank','card')),
  receipt_no    text NOT NULL,
  received_at   timestamptz NOT NULL DEFAULT now(),
  received_by   uuid NOT NULL,
  UNIQUE (org_id, receipt_no)
);
