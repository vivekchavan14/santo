// Export handler - Fine-tuning data export

import { AnalyticsEnv } from '../types';
import { Logger } from '../utils';

export async function handleTrainingExport(
  url: URL,
  env: AnalyticsEnv,
  logger: Logger
): Promise<string> {
  const searchParams = url.searchParams;
  
  // Parse query parameters
  const label = searchParams.get('label') || 'GOOD';
  const since = searchParams.get('since') || '2025-01-01';
  const minConfidence = parseFloat(searchParams.get('min_confidence') || '0.8');
  const maxLatency = parseInt(searchParams.get('max_latency') || '8000');
  const limit = parseInt(searchParams.get('limit') || '5000');
  const storeId = searchParams.get('store_id');
  const format = searchParams.get('format') || 'openai'; // 'openai' or 'anthropic'
  
  // Convert since date to epoch ms
  const sinceEpoch = new Date(since).getTime();
  
  logger.info('Exporting training data', {
    label,
    since,
    minConfidence,
    maxLatency,
    limit,
    storeId,
    format
  });
  
  // Build query
  let query = `
    SELECT 
      q.query_text,
      o.answer_text,
      q.store_id,
      q.intent,
      o.action_taken,
      o.model_name,
      q.created_at,
      e.confidence_score
    FROM voice_queries q
    JOIN voice_outcomes o ON o.query_id = q.id
    JOIN voice_evaluations e ON e.query_id = q.id
    WHERE e.label = ?1
      AND e.confidence_score >= ?2
      AND o.action_success = 1
      AND o.error_flag = 0
      AND o.latency_ms <= ?3
      AND q.created_at >= ?4
      AND LENGTH(q.query_text) > 3
      AND LENGTH(o.answer_text) > 3
  `;
  
  const bindings: any[] = [label, minConfidence, maxLatency, sinceEpoch];
  
  if (storeId) {
    query += ' AND q.store_id = ?5';
    bindings.push(storeId);
  }
  
  query += ' ORDER BY q.created_at DESC LIMIT ?';
  bindings.push(limit);
  
  const results = await env.AURA_DB.prepare(query).bind(...bindings).all();
  
  if (!results.results || results.results.length === 0) {
    logger.warn('No training data found matching criteria');
    return '';
  }
  
  logger.info(`Found ${results.results.length} training examples`);
  
  // Format as JSONL
  const jsonlLines = results.results.map(row => {
    if (format === 'anthropic') {
      // Anthropic format
      return JSON.stringify({
        messages: [
          { role: 'human', content: row.query_text },
          { role: 'assistant', content: row.answer_text }
        ],
        metadata: {
          store_id: row.store_id,
          intent: row.intent,
          action_taken: row.action_taken,
          model_name: row.model_name,
          confidence_score: row.confidence_score,
          created_at: new Date(row.created_at as number).toISOString()
        }
      });
    } else {
      // OpenAI format (default)
      return JSON.stringify({
        messages: [
          { role: 'user', content: row.query_text as string },
          { role: 'assistant', content: row.answer_text as string }
        ],
        metadata: {
          store_id: row.store_id,
          intent: row.intent,
          action_taken: row.action_taken,
          model_name: row.model_name,
          confidence_score: row.confidence_score,
          created_at: new Date(row.created_at as number).toISOString()
        }
      });
    }
  });
  
  return jsonlLines.join('\n');
}