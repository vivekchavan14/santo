-- Migration: Create llm_calls table for detailed LLM interaction tracking
-- This table stores individual LLM API calls for analytics and insights

CREATE TABLE IF NOT EXISTS llm_calls (
  call_id          TEXT PRIMARY KEY,           -- Unique call identifier (ULID)
  query_id         TEXT REFERENCES voice_queries(id), -- Optional link to query
  customer_id      TEXT,                       -- Customer identifier
  session_id       TEXT,                       -- Session tracking
  timestamp        INTEGER NOT NULL,           -- Epoch milliseconds
  model_name       TEXT NOT NULL,              -- e.g., 'gpt-4', 'claude-3', 'gemini-pro'
  provider         TEXT NOT NULL,              -- 'openai', 'anthropic', 'google'
  prompt_text      TEXT,                       -- The actual prompt sent
  completion_text  TEXT,                       -- The response received
  tokens_prompt    INTEGER DEFAULT 0,          -- Input token count
  tokens_completion INTEGER DEFAULT 0,         -- Output token count
  latency_ms       INTEGER NOT NULL,           -- Processing time in milliseconds
  cost_usd         REAL DEFAULT 0,             -- Cost in USD
  temperature      REAL,                       -- Model temperature setting
  max_tokens       INTEGER,                    -- Max tokens setting
  system_prompt    TEXT,                       -- System message if used
  error_message    TEXT,                       -- Error details if failed
  request_metadata TEXT,                       -- JSON string of additional data
  created_at       INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

-- Create indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_llm_calls_timestamp ON llm_calls(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_llm_calls_customer ON llm_calls(customer_id);
CREATE INDEX IF NOT EXISTS idx_llm_calls_session ON llm_calls(session_id);
CREATE INDEX IF NOT EXISTS idx_llm_calls_model ON llm_calls(model_name);
CREATE INDEX IF NOT EXISTS idx_llm_calls_provider ON llm_calls(provider);
CREATE INDEX IF NOT EXISTS idx_llm_calls_query ON llm_calls(query_id);

-- Create customer insights aggregation table
CREATE TABLE IF NOT EXISTS customer_insights (
  customer_id      TEXT PRIMARY KEY,
  total_interactions INTEGER DEFAULT 0,
  total_cost_usd   REAL DEFAULT 0,
  avg_latency_ms   REAL DEFAULT 0,
  preferred_topics TEXT,                       -- JSON array of topics
  satisfaction_score REAL DEFAULT 0,          -- 0-1 score
  last_active      INTEGER,                    -- Last interaction timestamp
  insights_updated INTEGER DEFAULT (unixepoch() * 1000)
);

-- Create LLM usage stats aggregation table (hourly)
CREATE TABLE IF NOT EXISTS llm_usage_hourly (
  hour_bucket      INTEGER NOT NULL,           -- Hour timestamp
  model_name       TEXT NOT NULL,
  provider         TEXT NOT NULL,
  total_calls      INTEGER DEFAULT 0,
  total_tokens     INTEGER DEFAULT 0,
  total_cost_usd   REAL DEFAULT 0,
  total_latency_ms INTEGER DEFAULT 0,
  error_count      INTEGER DEFAULT 0,
  
  PRIMARY KEY (hour_bucket, model_name, provider)
);

CREATE INDEX IF NOT EXISTS idx_llm_usage_time ON llm_usage_hourly(hour_bucket DESC);

INSERT INTO migration_metadata (version, applied_at, description) 
VALUES (5, unixepoch() * 1000, 'Create LLM calls and insights tables');
