-- Migration: Create views for common analytics queries
-- These views simplify complex queries for the admin interface

-- View: Queries with full details (joins all tables)
CREATE VIEW IF NOT EXISTS voice_query_details AS
SELECT 
  q.id,
  q.store_id,
  q.session_id,
  q.user_id,
  q.created_at,
  q.query_text,
  q.transcription_conf,
  q.intent,
  q.fast_path,
  o.answer_text,
  o.model_name,
  o.latency_ms,
  o.tokens_prompt,
  o.tokens_completion,
  o.cost_usd,
  o.action_taken,
  o.action_success,
  o.error_flag,
  o.tool_calls,
  e.label as eval_label,
  e.reason as eval_reason,
  e.confidence_score as eval_confidence
FROM voice_queries q
LEFT JOIN voice_outcomes o ON o.query_id = q.id
LEFT JOIN voice_evaluations e ON e.query_id = q.id;

-- View: Unanswered or problematic queries
CREATE VIEW IF NOT EXISTS voice_queries_need_review AS
SELECT 
  q.store_id,
  q.query_text,
  q.intent,
  COUNT(*) as occurrence_count,
  MAX(q.created_at) as last_seen,
  AVG(o.latency_ms) as avg_latency_ms
FROM voice_queries q
LEFT JOIN voice_outcomes o ON o.query_id = q.id
LEFT JOIN voice_evaluations e ON e.query_id = q.id
WHERE 
  o.action_success = 0 
  OR o.error_flag = 1
  OR e.label = 'REVIEW'
  OR e.label = 'BAD'
  OR o.latency_ms > 8000  -- Slow queries
GROUP BY q.store_id, q.query_text, q.intent;

-- View: High-quality training examples
CREATE VIEW IF NOT EXISTS voice_training_examples AS
SELECT 
  q.query_text as prompt,
  o.answer_text as completion,
  q.store_id,
  q.intent,
  o.model_name,
  o.action_taken,
  q.created_at
FROM voice_queries q
JOIN voice_outcomes o ON o.query_id = q.id
JOIN voice_evaluations e ON e.query_id = q.id
WHERE 
  e.label = 'GOOD'
  AND e.confidence_score > 0.8
  AND o.action_success = 1
  AND o.error_flag = 0
  AND o.latency_ms < 5000;

INSERT INTO migration_metadata (version, applied_at, description) 
VALUES (4, unixepoch() * 1000, 'Create analytics views');