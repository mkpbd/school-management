-- 0047_adm_web_forms: website enquiry and online application forms post into ADM (WEB-06, ADM-01/02/06):
-- campaigns with tracked links / QR codes, UTM capture, spam protection (signed form token, honeypot, rate limits,
-- optional captcha, content scoring, duplicate merging) and a submission log.
-- Run as sms_owner.

CREATE TABLE adm.campaign (                        -- a tracked source: QR code, ad, social post, open day
  id           uuid PRIMARY KEY DEFAULT uuidv7(),
  org_id       uuid NOT NULL,
  campus_id    uuid REFERENCES core.campus(id),    -- NULL = every campus
  code         text NOT NULL,                      -- in links: ?campaign=CODE
  name         text NOT NULL,
  channel      text NOT NULL CHECK (channel IN ('website','facebook','google','instagram','youtube','qr','sms',
                                                'email','event','referral','print','other')),
  utm_source   text,
  utm_medium   text,
  utm_campaign text,                               -- an incoming utm_campaign with this value maps here too
  landing_path text NOT NULL DEFAULT '/admissions/enquire',
  starts_on    date,
  ends_on      date,
  budget_paisa core.paisa_nn,
  is_active    boolean NOT NULL DEFAULT true,
  LIKE core.std_cols INCLUDING DEFAULTS,
  UNIQUE (org_id, code),
  CHECK (code ~ '^[A-Z0-9][A-Z0-9_-]{1,39}$'),
  CHECK (ends_on IS NULL OR starts_on IS NULL OR ends_on >= starts_on)
);
CREATE UNIQUE INDEX ux_campaign_utm ON adm.campaign (org_id, lower(utm_campaign)) WHERE utm_campaign IS NOT NULL;

ALTER TABLE adm.enquiry
  ADD COLUMN enquiry_no        text,
  ADD COLUMN campaign_id       uuid REFERENCES adm.campaign(id),
  ADD COLUMN referrer          text,
  ADD COLUMN landing_url       text,
  ADD COLUMN message           text,
  ADD COLUMN preferred_contact text CHECK (preferred_contact IN ('phone','sms','email','whatsapp')),
  ADD COLUMN is_spam           boolean NOT NULL DEFAULT false,
  ADD COLUMN spam_score        smallint NOT NULL DEFAULT 0,
  ADD COLUMN spam_reasons      text[] NOT NULL DEFAULT '{}',
  ADD COLUMN client_ip         inet,
  ADD COLUMN repeat_count      smallint NOT NULL DEFAULT 0;   -- the same family enquired again (merged here)
CREATE UNIQUE INDEX ux_enquiry_no ON adm.enquiry (org_id, enquiry_no) WHERE enquiry_no IS NOT NULL;
CREATE INDEX ix_enquiry_phone ON adm.enquiry (org_id, phone, created_at DESC);
CREATE INDEX ix_enquiry_campaign ON adm.enquiry (campaign_id) WHERE campaign_id IS NOT NULL;

ALTER TABLE adm.application
  ADD COLUMN source_code        text,
  ADD COLUMN campaign_id        uuid REFERENCES adm.campaign(id),
  ADD COLUMN utm                jsonb,
  ADD COLUMN referrer           text,
  ADD COLUMN landing_url        text,
  ADD COLUMN guardian_name      text,
  ADD COLUMN guardian_phone     core.phone_e164,
  ADD COLUMN guardian_email     citext,
  ADD COLUMN resume_token_hash  bytea,             -- secret link to continue a draft (only the hash is kept)
  ADD COLUMN resume_expires_at  timestamptz,
  ADD COLUMN is_spam            boolean NOT NULL DEFAULT false,
  ADD COLUMN spam_score         smallint NOT NULL DEFAULT 0,
  ADD COLUMN spam_reasons       text[] NOT NULL DEFAULT '{}',
  ADD COLUMN client_ip          inet,
  ADD COLUMN review_note        text;
CREATE UNIQUE INDEX ux_application_resume ON adm.application (resume_token_hash) WHERE resume_token_hash IS NOT NULL;

CREATE TABLE adm.web_submission (                  -- every public form post: outcome and why (spam review, abuse)
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id     uuid NOT NULL,
  form       text NOT NULL CHECK (form IN ('enquiry','application')),
  outcome    text NOT NULL CHECK (outcome IN ('accepted','merged','spam','rejected')),
  reasons    text[] NOT NULL DEFAULT '{}',
  record_id  uuid,
  campaign_id uuid REFERENCES adm.campaign(id),
  client_ip  inet,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_web_submission_time ON adm.web_submission (org_id, created_at DESC);

CALL core.enable_touch('adm.campaign');
CALL core.enable_campus_rls('adm.campaign');
CALL core.enable_org_rls('adm.web_submission');
CALL core.enable_audit('adm.campaign');

COMMENT ON TABLE adm.campaign IS 'Tracked admission campaign (QR code, ad, social post, event) with UTM mapping. [WEB-06, ADM-01]';
COMMENT ON TABLE adm.web_submission IS 'Log of public admission form posts with the spam / duplicate decision. [WEB-06]';
