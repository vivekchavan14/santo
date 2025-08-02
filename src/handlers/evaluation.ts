// Evaluation handler - Auto-labels interactions for quality assessment

import { AnalyticsEnv, EvaluationResult } from '../types';
import { Logger } from '../utils';

interface QueryData {
  id: string;
  queryText: string;
  intent?: string;
  fastPath: boolean;
  transcriptionConf?: number;
}

export async function evaluateBatch(env: AnalyticsEnv, logger: Logger): Promise<void> {
  const batchSize = parseInt(env.EVAL_BATCH_SIZE || '50');
  
  try {
    // Get queued items from KV
    const keys = await env.EVAL_QUEUE.list({ limit: batchSize });
    
    logger.info(`Evaluating batch of ${keys.keys.length} queries`);
    
    for (const key of keys.keys) {
      try {
        const queryData = await env.EVAL_QUEUE.get<QueryData>(key.name, 'json');
        if (!queryData) continue;
        
        // Evaluate the query
        const evaluation = await evaluateQuery(queryData, env, logger);
        
        // Store evaluation result
        await env.AURA_DB.prepare(
          `INSERT OR REPLACE INTO voice_evaluations
           (query_id, label, reason, confidence_score, evaluated_at, evaluated_by)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6)`
        ).bind(
          evaluation.queryId,
          evaluation.label,
          evaluation.reason,
          evaluation.confidenceScore,
          evaluation.evaluatedAt,
          evaluation.evaluatedBy
        ).run();
        
        // Remove from queue
        await env.EVAL_QUEUE.delete(key.name);
        
        logger.debug(`Evaluated query ${queryData.id}: ${evaluation.label} (${evaluation.reason})`);
      } catch (error) {
        logger.error(`Failed to evaluate query ${key.name}`, error);
      }
    }
    
    logger.info(`Batch evaluation complete`);
  } catch (error) {
    logger.error('Batch evaluation failed', error);
    throw error;
  }
}

async function evaluateQuery(
  queryData: QueryData,
  env: AnalyticsEnv,
  logger: Logger
): Promise<EvaluationResult> {
  const { id, queryText, intent, fastPath, transcriptionConf } = queryData;
  
  // Phase 1: Fast heuristic checks
  const heuristicResult = evaluateWithHeuristics(queryData);
  if (heuristicResult) {
    return {
      queryId: id,
      ...heuristicResult,
      evaluatedAt: Date.now(),
      evaluatedBy: 'auto'
    };
  }
  
  // Phase 2: Check outcome data for success indicators
  const outcomeResult = await evaluateWithOutcome(id, env, logger);
  if (outcomeResult) {
    return {
      queryId: id,
      ...outcomeResult,
      evaluatedAt: Date.now(),
      evaluatedBy: 'auto'
    };
  }
  
  // Phase 3: LLM evaluation (if configured)
  if (env.GEMINI_API_KEY) {
    const llmResult = await evaluateWithLLM(queryData, env, logger);
    return {
      queryId: id,
      ...llmResult,
      evaluatedAt: Date.now(),
      evaluatedBy: 'auto'
    };
  }
  
  // Default: needs review
  return {
    queryId: id,
    label: 'REVIEW',
    reason: 'no_evaluation_criteria_met',
    confidenceScore: 0.5,
    evaluatedAt: Date.now(),
    evaluatedBy: 'auto'
  };
}

function evaluateWithHeuristics(queryData: QueryData): {
  label: 'GOOD' | 'REVIEW' | 'BAD';
  reason: string;
  confidenceScore: number;
} | null {
  const { queryText, transcriptionConf, fastPath } = queryData;
  
  // Bad: Very low transcription confidence
  if (transcriptionConf !== undefined && transcriptionConf < 0.5) {
    return { label: 'BAD', reason: 'very_low_transcription_confidence', confidenceScore: 0.9 };
  }
  
  // Bad: Too short queries
  if (queryText.length < 3) {
    return { label: 'BAD', reason: 'query_too_short', confidenceScore: 0.9 };
  }
  
  // Review: Low transcription confidence
  if (transcriptionConf !== undefined && transcriptionConf < 0.8) {
    return { label: 'REVIEW', reason: 'low_transcription_confidence', confidenceScore: 0.7 };
  }
  
  // Good: High confidence voice with fast path
  if (fastPath && transcriptionConf && transcriptionConf > 0.95) {
    return { label: 'GOOD', reason: 'high_confidence_fast_path', confidenceScore: 0.8 };
  }
  
  // No conclusive heuristic result
  return null;
}

async function evaluateWithOutcome(
  queryId: string,
  env: AnalyticsEnv,
  logger: Logger
): Promise<{
  label: 'GOOD' | 'REVIEW' | 'BAD';
  reason: string;
  confidenceScore: number;
} | null> {
  try {
    const outcome = await env.AURA_DB.prepare(
      `SELECT action_success, error_flag, latency_ms, action_taken
       FROM voice_outcomes
       WHERE query_id = ?1`
    ).bind(queryId).first();
    
    if (!outcome) return null;
    
    // Bad: Error occurred
    if (outcome.error_flag) {
      return { label: 'BAD', reason: 'error_occurred', confidenceScore: 0.95 };
    }
    
    // Bad: Very slow response
    if (typeof outcome.latency_ms === 'number' && outcome.latency_ms > 10000) {
      return { label: 'BAD', reason: 'extreme_latency', confidenceScore: 0.9 };
    }
    
    // Review: Slow response
    if (typeof outcome.latency_ms === 'number' && outcome.latency_ms > 8000) {
      return { label: 'REVIEW', reason: 'high_latency', confidenceScore: 0.8 };
    }
    
    // Bad: Action failed
    if (outcome.action_success === 0 && outcome.action_taken) {
      return { label: 'REVIEW', reason: 'action_failed', confidenceScore: 0.8 };
    }
    
    // Good: Successful action with reasonable latency
    if (outcome.action_success === 1 && typeof outcome.latency_ms === 'number' && outcome.latency_ms < 5000) {
      return { label: 'GOOD', reason: 'successful_fast_action', confidenceScore: 0.85 };
    }
    
  } catch (error) {
    logger.error('Failed to evaluate with outcome', error);
  }
  
  return null;
}

async function evaluateWithLLM(
  queryData: QueryData,
  env: AnalyticsEnv,
  logger: Logger
): Promise<{
  label: 'GOOD' | 'REVIEW' | 'BAD';
  reason: string;
  confidenceScore: number;
}> {
  try {
    // Get additional context
    const outcome = await env.AURA_DB.prepare(
      `SELECT answer_text, action_taken, action_success
       FROM voice_outcomes
       WHERE query_id = ?1`
    ).bind(queryData.id).first();
    
    const prompt = `
You are evaluating voice assistant interactions for quality. Analyze this interaction:

Query: "${queryData.queryText}"
Intent: ${queryData.intent || 'unknown'}
Response: "${outcome?.answer_text || 'no response'}"
Action: ${outcome?.action_taken || 'none'}
Success: ${outcome?.action_success ? 'yes' : 'no'}

Evaluate this as:
- GOOD: The assistant understood correctly and provided a helpful response
- REVIEW: The interaction needs human review (unclear intent, partial success)
- BAD: Clear failure (misunderstanding, error, unhelpful response)

Respond with JSON only:
{"label": "GOOD|REVIEW|BAD", "reason": "brief_explanation", "confidence": 0.0-1.0}
`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000); // 10 second timeout
    
    let response;
    try {
      response = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite-preview-06-17:generateContent', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': env.GEMINI_API_KEY || ''
        },
        signal: controller.signal,
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.3,
            maxOutputTokens: 100,
            responseMimeType: 'application/json'
          }
        })
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      throw new Error(`LLM evaluation failed: ${response.statusText}`);
    }

    const result = await response.json() as any;
    const evaluation = JSON.parse(result.candidates[0].content.parts[0].text);
    
    return {
      label: evaluation.label as 'GOOD' | 'REVIEW' | 'BAD',
      reason: evaluation.reason || 'llm_evaluation',
      confidenceScore: evaluation.confidence || 0.7
    };
    
  } catch (error) {
    logger.error('LLM evaluation failed', error);
    return {
      label: 'REVIEW',
      reason: 'llm_evaluation_failed',
      confidenceScore: 0.5
    };
  }
}