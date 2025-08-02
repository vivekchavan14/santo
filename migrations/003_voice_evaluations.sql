-- Migration: Create voice_evaluations table for quality assessment
-- This table stores auto-evaluation results for training data curation

CREATE TABLE IF NOT EXISTS voice_evaluations (
  query_id         TEXT PRIMARY KEY REFERENCES voice_queries(id),
  label            TEXT NOT NULL CHECK (label IN ('GOOD', 'REVIEW', 'BAD')), -- Quality label
  reason           TEXT,                      -- Explanation for the label
  confidence_score REAL,                      -- Confidence in the evaluation (0-1)
  evaluated_at     INTEGER NOT NULL,          -- Epoch milliseconds when evaluated
  evaluated_by     TEXT DEFAULT 'auto'        -- 'auto' for AI, 'human' for manual review
);

-- Create indexes separately
CREATE INDEX IF NOT EXISTS idx_evals_label ON voice_evaluations(label);
CREATE INDEX IF NOT EXISTS idx_evals_confidence ON voice_evaluations(confidence_score);
CREATE INDEX IF NOT EXISTS idx_evals_time ON voice_evaluations(evaluated_at DESC);

-- Create aggregated stats table for performance
CREATE TABLE IF NOT EXISTS voice_stats_hourly (
  store_id         TEXT NOT NULL,
  hour_bucket      INTEGER NOT NULL,          -- Hour timestamp (epoch seconds / 3600 * 3600)
  total_queries    INTEGER DEFAULT 0,
  successful_queries INTEGER DEFAULT 0,
  failed_queries   INTEGER DEFAULT 0,
  total_latency_ms INTEGER DEFAULT 0,
  total_cost_usd   REAL DEFAULT 0,
  unique_sessions  INTEGER DEFAULT 0,
  
  PRIMARY KEY (store_id, hour_bucket)
);

-- Create index for hourly stats
CREATE INDEX IF NOT EXISTS idx_stats_time ON voice_stats_hourly(hour_bucket DESC);

INSERT INTO migration_metadata (version, applied_at, description) 
VALUES (3, unixepoch() * 1000, 'Create voice_evaluations and stats tables');