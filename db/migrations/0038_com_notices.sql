-- 0038_com_notices: notice board and circulars (COM-01) on top of 0015_com
--   * category, numbered circulars, publish / withdraw bookkeeping
--   * recipients are resolved once at publishing (audience -> users) and kept: the feed, push / SMS and the read
--     receipt percentage all use the same list
--   * notice_audience / notice_read have no tenant columns: they are reached through the RLS-protected notice

ALTER TABLE com.notice
  ADD COLUMN category        text NOT NULL DEFAULT 'general'
                             CHECK (category IN ('general','academic','exam','event','holiday','fee','transport','circular')),
  ADD COLUMN is_circular     boolean NOT NULL DEFAULT false,
  ADD COLUMN circular_no     text,
  ADD COLUMN published_at    timestamptz,
  ADD COLUMN published_by    uuid,
  ADD COLUMN withdrawn_at    timestamptz,
  ADD COLUMN recipient_count integer;
CREATE UNIQUE INDEX ux_notice_circular_no ON com.notice (org_id, circular_no) WHERE circular_no IS NOT NULL;
CREATE INDEX ix_notice_due ON com.notice (publish_at) WHERE status = 'scheduled';

CREATE TABLE com.notice_recipient (
  notice_id uuid NOT NULL REFERENCES com.notice(id) ON DELETE CASCADE,
  user_id   uuid NOT NULL,
  org_id    uuid NOT NULL,
  PRIMARY KEY (notice_id, user_id)
);
CREATE INDEX ix_notice_recipient_user ON com.notice_recipient (user_id, notice_id);

CALL core.enable_org_rls('com.notice_recipient');

COMMENT ON TABLE com.notice_recipient IS 'Users a published notice was addressed to (feed, notifications, read receipts). [COM-01]';
COMMENT ON COLUMN com.notice.circular_no IS 'Formal circular number (CIR-{YY}-{SEQ}); NULL for ordinary notices';
