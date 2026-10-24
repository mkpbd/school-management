-- 0006_sys_search: generated from SYSTEM_DESIGN.md section 6, then extended.
-- Run as sms_owner. Standard triggers/RLS are applied in 0030_standardize.sql.

CREATE TABLE sys.outbox_event (                    -- transactional outbox
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_id       uuid NOT NULL UNIQUE DEFAULT uuidv7(),
  org_id         uuid NOT NULL,
  module         text NOT NULL,
  event_type     text NOT NULL,                    -- 'att.student_marked_absent.v1'
  aggregate_type text NOT NULL,
  aggregate_id   text NOT NULL,
  payload        jsonb NOT NULL,
  occurred_at    timestamptz NOT NULL DEFAULT now(),
  published_at   timestamptz,
  attempts       smallint NOT NULL DEFAULT 0,
  last_error     text
);
CREATE INDEX ix_outbox_unpublished ON sys.outbox_event (id) WHERE published_at IS NULL;
-- Relay: SELECT ... WHERE published_at IS NULL ORDER BY id LIMIT 500 FOR UPDATE SKIP LOCKED; (+ LISTEN/NOTIFY wake-up)

CREATE TABLE sys.processed_event (                 -- inbox de-duplication for idempotent subscribers
  consumer     text NOT NULL,                      -- 'com.on_student_absent'
  event_id     uuid NOT NULL,
  processed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (consumer, event_id)
);

CREATE TABLE sys.idempotency_key (                 -- Idempotency-Key header for POSTs (payments, attendance sync)
  user_id       uuid NOT NULL,
  key           text NOT NULL,
  method_path   text NOT NULL,
  request_hash  bytea NOT NULL,
  status        text NOT NULL CHECK (status IN ('in_progress','completed')),
  response_code smallint,
  response_body jsonb,
  created_at    timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL DEFAULT now() + interval '48 hours',
  PRIMARY KEY (user_id, key)
);

CREATE TABLE sys.stored_file (                     -- every uploaded/generated file (documents, photos, PDFs)
  id            uuid PRIMARY KEY DEFAULT uuidv7(),
  org_id        uuid NOT NULL,
  campus_id     uuid,
  bucket        text NOT NULL,
  object_key    text NOT NULL,                     -- '{org}/{module}/{yyyy}/{mm}/{uuid}' (no PII in keys)
  original_name text,
  mime_type     text NOT NULL,
  size_bytes    bigint NOT NULL CHECK (size_bytes >= 0),
  sha256        bytea,
  purpose       text NOT NULL,                     -- 'student_photo','student_document','report_card','receipt',...
  classification text NOT NULL DEFAULT 'internal'
                CHECK (classification IN ('public','internal','confidential','restricted')),
  scan_status   text NOT NULL DEFAULT 'pending' CHECK (scan_status IN ('pending','clean','infected','failed','skipped')),
  uploaded_by   uuid,
  created_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz,
  UNIQUE (bucket, object_key)
);  -- std(rls)

CREATE TABLE sys.import_batch (                    -- CORE-09 import with validation preview
  id           uuid PRIMARY KEY DEFAULT uuidv7(),
  org_id       uuid NOT NULL,
  campus_id    uuid,
  kind         text NOT NULL,                      -- 'students','guardians','staff','fee_plans','opening_balances','marks'
  file_id      uuid NOT NULL REFERENCES sys.stored_file(id),
  status       text NOT NULL DEFAULT 'uploaded'
               CHECK (status IN ('uploaded','validating','validated','invalid','committing','committed','failed')),
  row_count    integer,
  error_count  integer,
  report       jsonb,                              -- per-row errors/warnings (dry-run report)
  committed_at timestamptz,
  LIKE core.std_cols INCLUDING DEFAULTS
);  -- std(rls)

CREATE TABLE sys.job_run (                         -- user-visible async jobs (exports, PDF batches, billing runs)
  id           uuid PRIMARY KEY DEFAULT uuidv7(),
  org_id       uuid NOT NULL,
  campus_id    uuid,
  kind         text NOT NULL,
  requested_by uuid,
  status       text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','succeeded','failed','cancelled')),
  progress     smallint NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  params       jsonb NOT NULL DEFAULT '{}',
  result_file_id uuid REFERENCES sys.stored_file(id),
  error        text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  finished_at  timestamptz
);

CREATE TABLE search.document (                     -- CORE-08 global search read model (fed by events)
  entity_type  text NOT NULL,                      -- 'student','guardian','staff','invoice','receipt','application'
  entity_id    uuid NOT NULL,
  org_id       uuid NOT NULL,
  campus_id    uuid,
  title        text NOT NULL,                      -- 'Ayaan Rahman (DHN-2026-0142)'
  subtitle     text,                               -- 'Year 7 - B · Dhanmondi'
  search_text  text NOT NULL,                      -- lower(name_en) || name_bn || ids || phones || barcode
  route        text NOT NULL,                      -- '/students/{id}'
  required_permission text NOT NULL,               -- filtered per user
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (entity_type, entity_id)
);  -- std(rls)
CREATE INDEX ix_search_trgm ON search.document USING gin (search_text gin_trgm_ops);
