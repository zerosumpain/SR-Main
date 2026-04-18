CREATE INDEX IF NOT EXISTS jkai_attachments_message_idx
  ON jkai_attachments(message_id);
CREATE INDEX IF NOT EXISTS jkai_attachments_conversation_idx
  ON jkai_attachments(conversation_id);
CREATE INDEX IF NOT EXISTS jkai_attachments_orphan_idx
  ON jkai_attachments(created_at) WHERE message_id IS NULL;
