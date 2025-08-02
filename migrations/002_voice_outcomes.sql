-- Migration: Create voice_outcomes table for tracking query results
-- This table stores the outcome/response data for each query

CREATE TABLE IF NOT EXISTS voice_outcomes (
  query_id         TEXT PRIMARY KEY REFERENCES voice_queries(id),
  answer_text      TEXT,                      -- The generated response text
  model_name       TEXT,                      -- AI model used (e.g., 'gemini-flash-thinking')
  latency_ms       INTEGER,                   -- Total processing time in milliseconds
  tokens_prompt    INTEGER,                   -- Input token count
  tokens_completion INTEGER,                  -- Output token count
  cost_usd         REAL,                      -- Estimated cost in USD
  action_taken     TEXT,                      -- Type of action: 'PRODUCT_LOOKUP', 'FAQ', 'CART_ADD', 'FALLBACK'
  action_success   INTEGER DEFAULT 0,         -- Whether the action succeeded (1) or failed (0)
  error_flag       INTEGER DEFAULT 0,         -- Whether an error occurred
  tool_calls       TEXT                       -- JSON array of tool calls made
);

-- Create indexes separately
CREATE INDEX IF NOT EXISTS idx_outcomes_model ON voice_outcomes(model_name);
CREATE INDEX IF NOT EXISTS idx_outcomes_action ON voice_outcomes(action_taken);
CREATE INDEX IF NOT EXISTS idx_outcomes_success ON voice_outcomes(action_success);
CREATE INDEX IF NOT EXISTS idx_outcomes_error ON voice_outcomes(error_flag);

INSERT INTO migration_metadata (version, applied_at, description) 
VALUES (2, unixepoch() * 1000, 'Create voice_outcomes table');