-- Migration: Create voice_queries table for tracking all voice/text interactions
-- This table stores the initial query data from users

CREATE TABLE IF NOT EXISTS voice_queries (
  id               TEXT PRIMARY KEY,          -- ULID for time-ordered, unique IDs
  store_id         TEXT NOT NULL,             -- Shopify store identifier
  session_id       TEXT,                      -- Session tracking
  user_id          TEXT,                      -- Optional user identifier
  created_at       INTEGER NOT NULL,          -- Epoch milliseconds
  query_text       TEXT NOT NULL,             -- The actual user query/transcription
  transcription_conf REAL,                    -- Confidence score for voice transcriptions
  intent           TEXT,                      -- Classified intent from the NLU pipeline
  fast_path        INTEGER NOT NULL DEFAULT 0 -- Whether query used fast path (1) or full pipeline (0)
);

-- Create indexes separately
CREATE INDEX IF NOT EXISTS idx_queries_store_time ON voice_queries(store_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_queries_session ON voice_queries(session_id);
CREATE INDEX IF NOT EXISTS idx_queries_created ON voice_queries(created_at DESC);

-- Add metadata table for tracking migration status
CREATE TABLE IF NOT EXISTS migration_metadata (
  version          INTEGER PRIMARY KEY,
  applied_at       INTEGER NOT NULL,
  description      TEXT
);

INSERT INTO migration_metadata (version, applied_at, description) 
VALUES (1, unixepoch() * 1000, 'Create voice_queries table');