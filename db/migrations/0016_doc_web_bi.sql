-- 0016_doc_web_bi: generated from SYSTEM_DESIGN.md section 6, then extended.
-- Run as sms_owner. Standard triggers/RLS are applied in 0030_standardize.sql.

CREATE TABLE doc.template (                        -- DOC-01 bilingual templates with letterhead/signature
  id          uuid PRIMARY KEY DEFAULT uuidv7(),
  org_id      uuid NOT NULL,
  campus_id   uuid,
  code        text NOT NULL,                       -- 'TC','CHARACTER','BONAFIDE','TESTIMONIAL','FEE_PAID','STUDY',
                                                   -- 'AGE','ATTENDANCE','OFFER_LETTER','REPORT_CARD_IGCSE',...
  kind        text NOT NULL CHECK (kind IN ('certificate','letter','report_card','receipt','admit_card','id_card','payslip')),
  locale      text NOT NULL CHECK (locale IN ('en','bn','bilingual')),
  version     integer NOT NULL DEFAULT 1,
  html        text NOT NULL,                       -- Handlebars + CSS (print), fonts embedded
  page_size   text NOT NULL DEFAULT 'A4',
  merge_schema jsonb NOT NULL,                     -- JSON schema of merge fields (validated before render)
  requires_approval boolean NOT NULL DEFAULT false,
  status      text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','retired')),
  LIKE core.std_cols INCLUDING DEFAULTS,
  UNIQUE NULLS NOT DISTINCT (org_id, campus_id, code, locale, version)
);

CREATE TABLE doc.issued_document (                 -- DOC-03 issue register
  id                  uuid PRIMARY KEY DEFAULT uuidv7(),
  org_id              uuid NOT NULL,
  campus_id           uuid NOT NULL,
  template_id         uuid NOT NULL REFERENCES doc.template(id),
  doc_code            text NOT NULL,
  serial_no           text NOT NULL,               -- core.number_sequence
  subject_type        text NOT NULL CHECK (subject_type IN ('student','staff','applicant','guardian')),
  subject_id          uuid NOT NULL,
  data_snapshot       jsonb NOT NULL,              -- merged data frozen at issue
  file_id             uuid REFERENCES sys.stored_file(id),
  verification_code   text NOT NULL UNIQUE,        -- 20-char base32 random, printed as QR
  public_fields       jsonb NOT NULL,              -- {name, class, issue_date} only (DOC-04)
  status              text NOT NULL DEFAULT 'issued' CHECK (status IN ('pending_approval','issued','revoked')),
  approval_request_id uuid,
  issued_by           uuid NOT NULL,
  issued_at           timestamptz NOT NULL DEFAULT now(),
  print_count         smallint NOT NULL DEFAULT 0,
  revoked_reason      text,
  UNIQUE (org_id, doc_code, serial_no)
);  -- std(audit, rls)

CREATE TABLE web.api_client (                      -- public website / partners (API key + CDN)
  id           uuid PRIMARY KEY DEFAULT uuidv7(),
  org_id       uuid NOT NULL,
  name         text NOT NULL,
  key_prefix   text NOT NULL UNIQUE,               -- shown in UI
  key_hash     bytea NOT NULL,                     -- sha256(secret)
  scopes       text[] NOT NULL,                    -- '{public.notices,public.events,admission.enquiry}'
  allowed_origins text[] NOT NULL DEFAULT '{}',
  rate_limit_per_min integer NOT NULL DEFAULT 600,
  revoked_at   timestamptz
);
CREATE TABLE web.news_post (id uuid PRIMARY KEY DEFAULT uuidv7(), org_id uuid NOT NULL, campus_id uuid,
  slug text NOT NULL, title_en text NOT NULL, title_bn text, body_en text, body_bn text, cover_file_id uuid,
  published_at timestamptz, seo jsonb NOT NULL DEFAULT '{}', LIKE core.std_cols INCLUDING DEFAULTS, UNIQUE (org_id, slug));
CREATE TABLE web.gallery_album (id uuid PRIMARY KEY DEFAULT uuidv7(), org_id uuid NOT NULL, campus_id uuid,
  title_en text NOT NULL, event_date date, published_at timestamptz, LIKE core.std_cols INCLUDING DEFAULTS);
CREATE TABLE web.gallery_photo (id uuid PRIMARY KEY DEFAULT uuidv7(), album_id uuid NOT NULL REFERENCES web.gallery_album(id),
  file_id uuid NOT NULL, caption text, contains_students boolean NOT NULL DEFAULT true,
  consent_verified boolean NOT NULL DEFAULT false, seq smallint NOT NULL DEFAULT 0);   -- WEB-05 consent flags

-- BI: pre-aggregated snapshots refreshed every 15 min by worker (§5.9), read by dashboards
CREATE TABLE bi.campus_daily_kpi (
  org_id               uuid NOT NULL,
  campus_id            uuid NOT NULL,
  kpi_date             date NOT NULL,
  students_active      integer NOT NULL,
  students_present     integer NOT NULL,
  students_absent      integer NOT NULL,
  attendance_pct       numeric(5,2),
  staff_present        integer,
  invoiced_paisa       bigint NOT NULL DEFAULT 0,
  collected_paisa      bigint NOT NULL DEFAULT 0,
  collected_online_paisa bigint NOT NULL DEFAULT 0,
  outstanding_paisa    bigint NOT NULL DEFAULT 0,
  overdue_paisa        bigint NOT NULL DEFAULT 0,
  concession_paisa     bigint NOT NULL DEFAULT 0,
  enquiries_new        integer NOT NULL DEFAULT 0,
  admissions_new       integer NOT NULL DEFAULT 0,
  sms_sent             integer NOT NULL DEFAULT 0,
  refreshed_at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (campus_id, kpi_date)
);  -- std(rls)
CREATE TABLE bi.section_attendance_daily (class_section_id uuid, attendance_date date, org_id uuid, campus_id uuid,
  enrolled int, present int, absent int, late int, PRIMARY KEY (class_section_id, attendance_date));
CREATE TABLE bi.fee_aging (org_id uuid, campus_id uuid, as_of date, bucket text CHECK (bucket IN ('0-30','31-60','61-90','90+')),
  family_count int, amount_paisa bigint, PRIMARY KEY (campus_id, as_of, bucket));
CREATE TABLE bi.exam_result_stats (exam_id uuid, exam_paper_id uuid, org_id uuid, campus_id uuid, class_section_id uuid,
  sat int, passed int, avg_percent numeric(6,3), grade_distribution jsonb, PRIMARY KEY (exam_paper_id, class_section_id));
CREATE TABLE bi.saved_report (id uuid PRIMARY KEY DEFAULT uuidv7(), org_id uuid NOT NULL, owner_id uuid NOT NULL,
  name text NOT NULL, dataset text NOT NULL, definition jsonb NOT NULL, shared_with_role_ids uuid[] NOT NULL DEFAULT '{}',
  schedule_cron text, recipients text[], LIKE core.std_cols INCLUDING DEFAULTS);   -- BI-04, BI-05
