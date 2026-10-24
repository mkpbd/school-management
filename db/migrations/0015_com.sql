-- 0015_com: generated from SYSTEM_DESIGN.md section 6, then extended.
-- Run as sms_owner. Standard triggers/RLS are applied in 0030_standardize.sql.

CREATE TABLE com.message_template (                -- COM-10 versioned bilingual templates
  id             uuid PRIMARY KEY DEFAULT uuidv7(),
  org_id         uuid NOT NULL,
  event_code     text NOT NULL,                    -- 'att.absent', 'fee.invoice_due', 'exm.result_published'
  channel        text NOT NULL CHECK (channel IN ('sms','email','push','whatsapp','in_app')),
  locale         core.locale NOT NULL,
  version        integer NOT NULL DEFAULT 1,
  subject        text,
  body           text NOT NULL,                    -- Handlebars: 'প্রিয় অভিভাবক, {{student_name}} আজ ...'
  whatsapp_template_name text,                     -- approved WA template id
  is_active      boolean NOT NULL DEFAULT false,
  approved_by    uuid,
  LIKE core.std_cols INCLUDING DEFAULTS,
  UNIQUE (org_id, event_code, channel, locale, version)
);
CREATE UNIQUE INDEX ux_template_active ON com.message_template (org_id, event_code, channel, locale) WHERE is_active;

CREATE TABLE com.notification_rule (               -- which events go to whom on which channels (Appendix C)
  org_id        uuid NOT NULL,
  event_code    text NOT NULL,
  recipient     text NOT NULL,                     -- 'primary_guardian','all_guardians','student','class_teacher','approver'
  channels      text[] NOT NULL,                   -- '{sms,push}'
  priority      text NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high','emergency')),
  respect_quiet_hours boolean NOT NULL DEFAULT true,
  is_enabled    boolean NOT NULL DEFAULT true,
  PRIMARY KEY (org_id, event_code, recipient)
);

CREATE TABLE com.notification_preference (         -- per-user opt-outs and quiet hours
  user_id     uuid NOT NULL REFERENCES iam.user_account(id),
  event_code  text NOT NULL,                       -- '*' = all
  channel     text NOT NULL,
  enabled     boolean NOT NULL DEFAULT true,
  quiet_from  time,
  quiet_to    time,
  PRIMARY KEY (user_id, event_code, channel)
);

CREATE TABLE com.push_device (
  id          uuid PRIMARY KEY DEFAULT uuidv7(),
  user_id     uuid NOT NULL REFERENCES iam.user_account(id),
  app         text NOT NULL CHECK (app IN ('parent','staff','web_push')),
  platform    text NOT NULL CHECK (platform IN ('android','ios','web')),
  token       text NOT NULL UNIQUE,
  locale      core.locale,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  revoked_at  timestamptz
);

CREATE TABLE com.outbound_message (                -- every message sent on any channel (delivery status)
  id                  uuid NOT NULL DEFAULT uuidv7(),
  created_at          timestamptz NOT NULL DEFAULT now(),
  org_id              uuid NOT NULL,
  campus_id           uuid,
  event_code          text NOT NULL,
  channel             text NOT NULL CHECK (channel IN ('sms','email','push','whatsapp','in_app')),
  priority            text NOT NULL DEFAULT 'normal',
  template_id         uuid,
  template_version    integer,
  locale              core.locale NOT NULL,
  recipient_user_id   uuid,
  recipient_address   text NOT NULL,             -- phone / email / device token
  subject             text,
  body                text NOT NULL,             -- rendered
  correlation_type    text,                      -- 'student_attendance','invoice'
  correlation_id      text,
  dedupe_key          text,                      -- 'att.absent:{student}:{date}' (checked via Redis + com.message_dedupe)
  status              text NOT NULL DEFAULT 'queued'
                      CHECK (status IN ('queued','throttled','sending','sent','delivered','failed','undeliverable',
                                        'cancelled','suppressed')),
  provider            text,
  provider_message_id text,
  sms_segments        smallint,
  sms_encoding        text CHECK (sms_encoding IN ('gsm7','ucs2')),   -- Bangla = UCS-2 (70 chars/segment)
  cost_paisa          core.paisa,
  attempts            smallint NOT NULL DEFAULT 0,
  last_error          text,
  scheduled_for       timestamptz,
  sent_at             timestamptz,
  delivered_at        timestamptz,
  read_at             timestamptz,              -- in_app / notice read receipts
  PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);              -- monthly; retain 24 months hot, then archive
CREATE INDEX ix_outbound_recipient ON com.outbound_message (recipient_user_id, created_at DESC);
CREATE INDEX ix_outbound_provider  ON com.outbound_message (provider, provider_message_id);   -- DLR callbacks
CREATE INDEX ix_outbound_inbox     ON com.outbound_message (recipient_user_id, created_at DESC)
  WHERE channel = 'in_app' AND read_at IS NULL;

CREATE TABLE com.message_dedupe (                  -- cross-partition uniqueness for dedupe keys
  dedupe_key  text PRIMARY KEY,
  message_id  uuid NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()  -- purged after 30 days
);

CREATE TABLE com.notice (                          -- COM-01
  id                uuid PRIMARY KEY DEFAULT uuidv7(),
  org_id            uuid NOT NULL,
  campus_id         uuid,                          -- NULL = all campuses
  title_en          text NOT NULL,
  title_bn          text,
  body_en           text NOT NULL,
  body_bn           text,
  attachment_file_ids uuid[] NOT NULL DEFAULT '{}',
  priority          text NOT NULL DEFAULT 'normal' CHECK (priority IN ('normal','urgent','emergency')),
  publish_at        timestamptz NOT NULL DEFAULT now(),
  expires_at        timestamptz,
  publish_to_website boolean NOT NULL DEFAULT false,   -- WEB-01
  send_sms          boolean NOT NULL DEFAULT false,
  status            text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','scheduled','published','withdrawn')),
  LIKE core.std_cols INCLUDING DEFAULTS
);  -- std(audit, rls)
CREATE INDEX ix_notice_published ON com.notice (org_id, publish_at DESC) WHERE status = 'published';

CREATE TABLE com.notice_audience (
  notice_id     uuid NOT NULL REFERENCES com.notice(id) ON DELETE CASCADE,
  audience_type text NOT NULL CHECK (audience_type IN ('everyone','campus','programme','year_group','class_section',
                                                       'teaching_group','house','role','staff','guardians','students','user')),
  audience_id   uuid,                              -- NULL for 'everyone' / 'guardians' / 'students'
  UNIQUE NULLS NOT DISTINCT (notice_id, audience_type, audience_id)
);

CREATE TABLE com.notice_read (
  notice_id uuid NOT NULL REFERENCES com.notice(id) ON DELETE CASCADE,
  user_id   uuid NOT NULL,
  read_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (notice_id, user_id)
);

CREATE TABLE com.broadcast (                       -- COM-09 emergency broadcast
  id          uuid PRIMARY KEY DEFAULT uuidv7(),
  org_id      uuid NOT NULL,
  campus_id   uuid,
  audience    jsonb NOT NULL,
  message_en  text NOT NULL,
  message_bn  text NOT NULL,
  channels    text[] NOT NULL DEFAULT '{sms,push}',
  sent_by     uuid NOT NULL,
  sent_at     timestamptz NOT NULL DEFAULT now(),
  recipient_count integer,
  delivered_count integer
);  -- std(audit, rls)

CREATE TABLE com.sms_provider_balance (            -- COM-02 balance alerts
  provider    text PRIMARY KEY,
  balance     numeric(12,2),
  checked_at  timestamptz NOT NULL,
  low_threshold numeric(12,2) NOT NULL
);
-- P2 COM tables (messaging, PTM, surveys, complaints): see 0019_com_p2.sql
