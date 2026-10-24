-- 0022_lib: library management (LIB-01..06)

CREATE TABLE lib.book_title (                      -- LIB-01 catalogue
  id            uuid PRIMARY KEY DEFAULT uuidv7(),
  org_id        uuid NOT NULL,
  isbn          text,
  title         text NOT NULL,
  subtitle      text,
  authors       text[] NOT NULL DEFAULT '{}',
  publisher     text,
  edition       text,
  published_year smallint,
  language      text NOT NULL DEFAULT 'en',
  category_code text,                              -- DDC class or school category
  reading_level text,
  media_type    text NOT NULL DEFAULT 'book' CHECK (media_type IN ('book','journal','magazine','dvd','audio','kit')),
  cover_file_id uuid REFERENCES sys.stored_file(id),
  search_text   text GENERATED ALWAYS AS (lower(title || ' ' || coalesce(subtitle, '') || ' ' || coalesce(isbn, ''))) STORED,
  LIKE core.std_cols INCLUDING DEFAULTS
);
CREATE INDEX ix_book_title_trgm ON lib.book_title USING gin (search_text gin_trgm_ops);
CREATE INDEX ix_book_title_isbn ON lib.book_title (org_id, isbn) WHERE isbn IS NOT NULL;

CREATE TABLE lib.book_copy (
  id            uuid PRIMARY KEY DEFAULT uuidv7(),
  org_id        uuid NOT NULL,
  campus_id     uuid NOT NULL REFERENCES core.campus(id),
  book_title_id uuid NOT NULL REFERENCES lib.book_title(id),
  accession_no  text NOT NULL,
  barcode       text NOT NULL,
  rfid_uid      text,
  shelf_location text,
  acquired_on   date,
  price_paisa   core.paisa_nn,
  status        text NOT NULL DEFAULT 'available'
                CHECK (status IN ('available','on_loan','reserved','lost','damaged','withdrawn','in_repair')),
  LIKE core.std_cols INCLUDING DEFAULTS,
  UNIQUE (org_id, accession_no),
  UNIQUE (org_id, barcode)
);
CREATE INDEX ix_book_copy_title ON lib.book_copy (book_title_id, status);

CREATE TABLE lib.member_policy (                   -- limits per role
  org_id         uuid NOT NULL,
  member_type    text NOT NULL CHECK (member_type IN ('student_junior','student_senior','teacher','staff')),
  max_loans      smallint NOT NULL,
  loan_days      smallint NOT NULL,
  max_renewals   smallint NOT NULL DEFAULT 1,
  fine_per_day_paisa core.paisa_nn NOT NULL DEFAULT 0,
  PRIMARY KEY (org_id, member_type)
);

CREATE TABLE lib.circulation (                     -- LIB-02 issue / return / renewal
  id               uuid PRIMARY KEY DEFAULT uuidv7(),
  org_id           uuid NOT NULL,
  campus_id        uuid NOT NULL,
  book_copy_id     uuid NOT NULL REFERENCES lib.book_copy(id),
  borrower_type    text NOT NULL CHECK (borrower_type IN ('student','staff')),
  borrower_id      uuid NOT NULL,
  issued_at        timestamptz NOT NULL DEFAULT now(),
  due_on           date NOT NULL,
  renew_count      smallint NOT NULL DEFAULT 0,
  returned_at      timestamptz,
  return_condition text CHECK (return_condition IN ('good','damaged','lost')),
  fine_paisa       core.paisa_nn NOT NULL DEFAULT 0,
  fine_invoice_line_id uuid REFERENCES fee.invoice_line(id),   -- LIB-03 fine posted to fee ledger
  issued_by        uuid NOT NULL,
  received_by      uuid
);
CREATE UNIQUE INDEX ux_circulation_active_copy ON lib.circulation (book_copy_id) WHERE returned_at IS NULL;  -- one active loan per copy
CREATE INDEX ix_circulation_borrower ON lib.circulation (borrower_type, borrower_id) WHERE returned_at IS NULL;
CREATE INDEX ix_circulation_overdue ON lib.circulation (due_on) WHERE returned_at IS NULL;

CREATE TABLE lib.reservation (                     -- LIB-04
  id            uuid PRIMARY KEY DEFAULT uuidv7(),
  org_id        uuid NOT NULL,
  campus_id     uuid NOT NULL,
  book_title_id uuid NOT NULL REFERENCES lib.book_title(id),
  borrower_type text NOT NULL CHECK (borrower_type IN ('student','staff')),
  borrower_id   uuid NOT NULL,
  reserved_at   timestamptz NOT NULL DEFAULT now(),
  ready_copy_id uuid REFERENCES lib.book_copy(id),
  expires_at    timestamptz,
  status        text NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting','ready','fulfilled','cancelled','expired'))
);

CREATE TABLE lib.stock_take (                      -- LIB-05 (P3)
  id          uuid PRIMARY KEY DEFAULT uuidv7(),
  org_id      uuid NOT NULL,
  campus_id   uuid NOT NULL,
  started_on  date NOT NULL,
  completed_on date,
  status      text NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress','completed'))
);
CREATE TABLE lib.stock_take_scan (
  stock_take_id uuid NOT NULL REFERENCES lib.stock_take(id) ON DELETE CASCADE,
  book_copy_id  uuid NOT NULL REFERENCES lib.book_copy(id),
  scanned_at    timestamptz NOT NULL DEFAULT now(),
  condition     text,
  PRIMARY KEY (stock_take_id, book_copy_id)
);

CREATE TABLE lib.digital_item (                    -- LIB-06 (P3) e-library & past papers
  id           uuid PRIMARY KEY DEFAULT uuidv7(),
  org_id       uuid NOT NULL,
  title        text NOT NULL,
  kind         text NOT NULL CHECK (kind IN ('ebook','past_paper','journal','video')),
  file_id      uuid REFERENCES sys.stored_file(id),
  url          text,
  programme_id uuid REFERENCES aca.programme(id),
  year_group_ids uuid[] NOT NULL DEFAULT '{}',     -- access control by class
  subject_id   uuid REFERENCES aca.subject(id),
  LIKE core.std_cols INCLUDING DEFAULTS,
  CHECK (file_id IS NOT NULL OR url IS NOT NULL)
);
