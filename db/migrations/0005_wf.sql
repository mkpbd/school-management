-- 0005_wf: generated from SYSTEM_DESIGN.md section 6, then extended.
-- Run as sms_owner. Standard triggers/RLS are applied in 0030_standardize.sql.

CREATE TABLE wf.workflow_definition (
  id          uuid PRIMARY KEY DEFAULT uuidv7(),
  org_id      uuid NOT NULL,
  code        text NOT NULL,                       -- 'student_leave','staff_leave','fee_concession','fee_waiver',
                                                   -- 'refund','certificate_issue','marks_reopen','payroll','purchase'
  name_en     text NOT NULL,
  version     integer NOT NULL DEFAULT 1,
  is_active   boolean NOT NULL DEFAULT true,
  LIKE core.std_cols INCLUDING DEFAULTS,
  UNIQUE (org_id, code, version)
);

CREATE TABLE wf.workflow_step (
  id              uuid PRIMARY KEY DEFAULT uuidv7(),
  definition_id   uuid NOT NULL REFERENCES wf.workflow_definition(id) ON DELETE CASCADE,
  step_no         smallint NOT NULL,
  name_en         text NOT NULL,
  approver_type   text NOT NULL CHECK (approver_type IN ('role','user','class_teacher','head_of_section',
                                                         'reporting_manager','campus_head')),
  approver_role_id uuid REFERENCES iam.role(id),
  approver_user_id uuid REFERENCES iam.user_account(id),
  condition       jsonb,                           -- e.g. {"amount_paisa": {"gt": 500000}} => step applies
  min_approvals   smallint NOT NULL DEFAULT 1,
  escalate_after  interval,                        -- e.g. '48 hours'
  escalate_to_role_id uuid REFERENCES iam.role(id),
  UNIQUE (definition_id, step_no)
);

CREATE TABLE wf.approval_request (
  id             uuid PRIMARY KEY DEFAULT uuidv7(),
  org_id         uuid NOT NULL,
  campus_id      uuid,
  definition_id  uuid NOT NULL REFERENCES wf.workflow_definition(id),
  subject_module text NOT NULL,                    -- 'fee'
  subject_type   text NOT NULL,                    -- 'student_concession'
  subject_id     uuid NOT NULL,
  summary        text NOT NULL,                    -- shown in approver inbox
  payload        jsonb NOT NULL DEFAULT '{}',      -- snapshot used for conditions (amount etc.)
  requested_by   uuid NOT NULL,
  status         text NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending','approved','rejected','returned','cancelled')),
  current_step   smallint NOT NULL DEFAULT 1,
  due_at         timestamptz,                      -- escalation timer
  decided_at     timestamptz,
  LIKE core.std_cols INCLUDING DEFAULTS
);  -- std(audit, rls)
CREATE INDEX ix_approval_subject ON wf.approval_request (subject_type, subject_id);
CREATE INDEX ix_approval_pending ON wf.approval_request (org_id, status, due_at) WHERE status = 'pending';

CREATE TABLE wf.approval_task (                    -- materialised inbox per approver for the current step
  id           uuid PRIMARY KEY DEFAULT uuidv7(),
  request_id   uuid NOT NULL REFERENCES wf.approval_request(id) ON DELETE CASCADE,
  step_no      smallint NOT NULL,
  assignee_user_id uuid NOT NULL,
  status       text NOT NULL DEFAULT 'open' CHECK (status IN ('open','done','skipped','escalated')),
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_approval_task_inbox ON wf.approval_task (assignee_user_id) WHERE status = 'open';

CREATE TABLE wf.approval_action (                  -- append-only history
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  request_id    uuid NOT NULL REFERENCES wf.approval_request(id),
  step_no       smallint NOT NULL,
  actor_user_id uuid NOT NULL,
  on_behalf_of  uuid,                              -- delegation
  action        text NOT NULL CHECK (action IN ('submit','approve','reject','return','delegate','escalate','comment','cancel')),
  comment       text,
  acted_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE wf.delegation (
  id            uuid PRIMARY KEY DEFAULT uuidv7(),
  from_user_id  uuid NOT NULL,
  to_user_id    uuid NOT NULL,
  definition_id uuid REFERENCES wf.workflow_definition(id),   -- NULL = all workflows
  starts_on     date NOT NULL,
  ends_on       date NOT NULL,
  CHECK (ends_on >= starts_on)
);
