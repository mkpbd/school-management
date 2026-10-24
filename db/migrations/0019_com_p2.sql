-- 0019_com_p2: parent-teacher messaging, PTM scheduler, surveys, complaints (COM-05..08)

CREATE TABLE com.conversation (                    -- COM-05 moderated 1:1 or class-level threads
  id               uuid PRIMARY KEY DEFAULT uuidv7(),
  org_id           uuid NOT NULL,
  campus_id        uuid NOT NULL,
  kind             text NOT NULL CHECK (kind IN ('direct','class_section','teaching_group')),
  student_id       uuid,                           -- context for parent-teacher threads
  class_section_id uuid REFERENCES aca.class_section(id),
  teaching_group_id uuid REFERENCES aca.teaching_group(id),
  subject          text,
  status           text NOT NULL DEFAULT 'open' CHECK (status IN ('open','escalated','closed')),
  escalated_to     uuid,                           -- head of section user
  retain_until     date,
  LIKE core.std_cols INCLUDING DEFAULTS
);

CREATE TABLE com.conversation_member (
  conversation_id uuid NOT NULL REFERENCES com.conversation(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES iam.user_account(id),
  role            text NOT NULL CHECK (role IN ('teacher','guardian','moderator','student')),
  can_post        boolean NOT NULL DEFAULT true,
  last_read_at    timestamptz,
  PRIMARY KEY (conversation_id, user_id)
);

CREATE TABLE com.chat_message (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  conversation_id uuid NOT NULL REFERENCES com.conversation(id) ON DELETE CASCADE,
  sender_user_id  uuid NOT NULL,
  body            text NOT NULL,
  attachment_file_ids uuid[] NOT NULL DEFAULT '{}',
  sent_at         timestamptz NOT NULL DEFAULT now(),
  hidden_at       timestamptz,                     -- moderation (never hard-deleted)
  hidden_by       uuid,
  hidden_reason   text
);
CREATE INDEX ix_chat_message_conv ON com.chat_message (conversation_id, sent_at DESC);

CREATE TABLE com.ptm_event (                       -- COM-06 parent-teacher meeting day
  id          uuid PRIMARY KEY DEFAULT uuidv7(),
  org_id      uuid NOT NULL,
  campus_id   uuid NOT NULL,
  title       text NOT NULL,
  event_date  date NOT NULL,
  slot_minutes smallint NOT NULL DEFAULT 10,
  booking_opens_at  timestamptz NOT NULL,
  booking_closes_at timestamptz NOT NULL,
  LIKE core.std_cols INCLUDING DEFAULTS
);

CREATE TABLE com.ptm_slot (
  id           uuid PRIMARY KEY DEFAULT uuidv7(),
  ptm_event_id uuid NOT NULL REFERENCES com.ptm_event(id) ON DELETE CASCADE,
  staff_id     uuid NOT NULL,
  starts_at    timestamptz NOT NULL,
  ends_at      timestamptz NOT NULL,
  location     text,
  meeting_url  text,
  UNIQUE (staff_id, starts_at)
);

CREATE TABLE com.ptm_booking (
  ptm_slot_id  uuid PRIMARY KEY REFERENCES com.ptm_slot(id) ON DELETE CASCADE,   -- one booking per slot
  student_id   uuid NOT NULL,
  guardian_user_id uuid NOT NULL,
  booked_at    timestamptz NOT NULL DEFAULT now(),
  attended     boolean,
  notes        text                               -- recorded against the student
);

CREATE TABLE com.survey (                          -- COM-07
  id           uuid PRIMARY KEY DEFAULT uuidv7(),
  org_id       uuid NOT NULL,
  campus_id    uuid,
  title        text NOT NULL,
  audience     jsonb NOT NULL,
  is_anonymous boolean NOT NULL DEFAULT false,
  opens_at     timestamptz NOT NULL,
  closes_at    timestamptz NOT NULL,
  status       text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','open','closed')),
  LIKE core.std_cols INCLUDING DEFAULTS
);

CREATE TABLE com.survey_question (
  id         uuid PRIMARY KEY DEFAULT uuidv7(),
  survey_id  uuid NOT NULL REFERENCES com.survey(id) ON DELETE CASCADE,
  seq        smallint NOT NULL,
  kind       text NOT NULL CHECK (kind IN ('rating','single','multi','text','nps')),
  prompt_en  text NOT NULL,
  prompt_bn  text,
  options    jsonb,
  UNIQUE (survey_id, seq)
);

CREATE TABLE com.survey_response (
  id              uuid PRIMARY KEY DEFAULT uuidv7(),
  survey_id       uuid NOT NULL REFERENCES com.survey(id),
  respondent_hash bytea NOT NULL,                  -- HMAC(user) -> one response per user even when anonymous
  respondent_user_id uuid,                         -- NULL when survey is anonymous
  answers         jsonb NOT NULL,
  submitted_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (survey_id, respondent_hash)
);

CREATE TABLE com.complaint (                       -- COM-08 ticketed complaints with SLA
  id            uuid PRIMARY KEY DEFAULT uuidv7(),
  org_id        uuid NOT NULL,
  campus_id     uuid NOT NULL,
  ticket_no     text NOT NULL,
  raised_by     uuid NOT NULL,
  student_id    uuid,
  category_code text NOT NULL,
  subject       text NOT NULL,
  description   text NOT NULL,
  assignee_id   uuid,
  priority      text NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high','urgent')),
  sla_due_at    timestamptz,
  status        text NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','awaiting_parent','resolved','closed')),
  resolution    text,
  resolved_at   timestamptz,
  LIKE core.std_cols INCLUDING DEFAULTS,
  UNIQUE (org_id, ticket_no)
);

CREATE TABLE com.complaint_note (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  complaint_id uuid NOT NULL REFERENCES com.complaint(id) ON DELETE CASCADE,
  author_id    uuid NOT NULL,
  is_internal  boolean NOT NULL DEFAULT true,
  body         text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);
