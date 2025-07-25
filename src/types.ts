// Analytics Event Types

export interface VoiceQueryEvent {
  type: 'query';
  id: string;                    // ULID
  storeId: string;
  sessionId?: string;
  userId?: string;
  createdAt: number;             // epoch ms
  queryText: string;
  transcriptionConf?: number;    // 0-1 confidence for voice
  intent?: string;               // classified intent
  fastPath: boolean;
  correlationId?: string;        // for tracing
}

export interface VoiceOutcomeEvent {
  type: 'outcome';
  queryId: string;               // references query ID
  answerText?: string;
  modelName?: string;
  latencyMs: number;
  tokensPrompt?: number;
  tokensCompletion?: number;
  costUsd?: number;
  actionTaken?: string;          // PRODUCT_LOOKUP, FAQ, CART_ADD, etc.
  actionSuccess: boolean;
  errorFlag: boolean;
  toolCalls?: string;            // JSON array of tool calls
}

export interface EvaluationResult {
  queryId: string;
  label: 'GOOD' | 'REVIEW' | 'BAD';
  reason: string;
  confidenceScore: number;
  evaluatedAt: number;
  evaluatedBy: 'auto' | 'human';
}

export interface AnalyticsEnv {
  AURA_DB: D1Database;
  EVAL_QUEUE: KVNamespace;
  LOG_LEVEL: string;
  EVAL_BATCH_SIZE: string;
  GEMINI_API_KEY?: string;       // For evaluation LLM
}

export interface StatsQueryParams {
  storeId?: string;
  period?: string;               // 1h, 24h, 7d, 30d
  limit?: number;
  since?: number;                // epoch ms
}

// Analytics API response types
export interface StoreSummaryStats {
  storeId: string;
  period: string;
  totalQueries: number;
  successfulQueries: number;
  failedQueries: number;
  averageLatencyMs: number;
  totalCostUsd: number;
  uniqueSessions: number;
  conversionRate: number;
  unansweredRate: number;
}

export interface TopQuery {
  queryText: string;
  intent?: string;
  count: number;
  avgLatencyMs: number;
  successRate: number;
}

export interface UnansweredQuery {
  queryText: string;
  intent?: string;
  occurrences: number;
  lastSeen: number;
  reasons: string[];
}