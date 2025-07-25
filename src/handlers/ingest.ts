// Ingest handler - receives and stores analytics events

import { AnalyticsEnv, VoiceQueryEvent, VoiceOutcomeEvent } from '../types';
import { Logger, generateULID, getHourBucket } from '../utils';

export async function handleIngest(
  request: Request,
  env: AnalyticsEnv,
  ctx: ExecutionContext,
  logger: Logger
): Promise<Response> {
  try {
    const payload = await request.json() as any;
    const db = env.AURA_DB;

    // Process query event
    if (payload.type === 'query') {
      const event = payload as VoiceQueryEvent;
      
      // Ensure we have an ID
      if (!event.id) {
        event.id = generateULID();
      }

      logger.debug('Ingesting query event', { 
        id: event.id, 
        storeId: event.storeId,
        intent: event.intent 
      });

      // Insert into voice_queries table
      await db.prepare(
        `INSERT INTO voice_queries
          (id, store_id, session_id, user_id, created_at,
           query_text, transcription_conf, intent, fast_path)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`
      ).bind(
        event.id,
        event.storeId,
        event.sessionId || null,
        event.userId || null,
        event.createdAt,
        event.queryText,
        event.transcriptionConf || null,
        event.intent || null,
        event.fastPath ? 1 : 0
      ).run();

      // Queue for evaluation (fire-and-forget)
      ctx.waitUntil(
        env.EVAL_QUEUE.put(event.id, JSON.stringify(event), { 
          expirationTtl: 3600  // 1 hour TTL
        }).catch(error => logger.error('Failed to queue for evaluation', error))
      );

      // Update hourly stats (fire-and-forget)
      ctx.waitUntil(updateHourlyStats(db, event, logger));

      return new Response('ok', { status: 200 });
    }

    // Process outcome event
    if (payload.type === 'outcome') {
      const event = payload as VoiceOutcomeEvent;
      
      logger.debug('Ingesting outcome event', { 
        queryId: event.queryId,
        actionTaken: event.actionTaken,
        success: event.actionSuccess 
      });

      // Insert into voice_outcomes table
      await db.prepare(
        `INSERT INTO voice_outcomes
          (query_id, answer_text, model_name, latency_ms,
           tokens_prompt, tokens_completion, cost_usd,
           action_taken, action_success, error_flag, tool_calls)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)`
      ).bind(
        event.queryId,
        event.answerText || null,
        event.modelName || null,
        event.latencyMs,
        event.tokensPrompt || null,
        event.tokensCompletion || null,
        event.costUsd || null,
        event.actionTaken || null,
        event.actionSuccess ? 1 : 0,
        event.errorFlag ? 1 : 0,
        event.toolCalls || null
      ).run();

      return new Response('ok', { status: 200 });
    }

    // Handle other event types (e.g., purchase, visit) if needed
    logger.warn('Unknown event type', { type: payload.type });
    return new Response('bad request', { status: 400 });

  } catch (error) {
    logger.error('Ingest error', error);
    return new Response('internal error', { status: 500 });
  }
}

// Update aggregated hourly statistics
async function updateHourlyStats(
  db: D1Database,
  event: VoiceQueryEvent,
  logger: Logger
): Promise<void> {
  try {
    const hourBucket = getHourBucket(event.createdAt);
    
    // Try to update existing row first
    const result = await db.prepare(
      `UPDATE voice_stats_hourly 
       SET total_queries = total_queries + 1
       WHERE store_id = ?1 AND hour_bucket = ?2`
    ).bind(event.storeId, hourBucket).run();

    // If no rows updated, insert new row
    if (result.meta.changes === 0) {
      await db.prepare(
        `INSERT INTO voice_stats_hourly 
         (store_id, hour_bucket, total_queries, successful_queries, 
          failed_queries, total_latency_ms, total_cost_usd, unique_sessions)
         VALUES (?1, ?2, 1, 0, 0, 0, 0, 0)`
      ).bind(event.storeId, hourBucket).run();
    }

    // Update unique sessions if we have a session ID
    if (event.sessionId) {
      // This is a simplified approach - in production you might want to use HyperLogLog
      // or a separate table to track unique sessions more accurately
      await db.prepare(
        `UPDATE voice_stats_hourly 
         SET unique_sessions = (
           SELECT COUNT(DISTINCT session_id) 
           FROM voice_queries 
           WHERE store_id = ?1 
           AND created_at >= ?2 * 1000 
           AND created_at < (?2 + 3600) * 1000
         )
         WHERE store_id = ?1 AND hour_bucket = ?2`
      ).bind(event.storeId, hourBucket).run();
    }
  } catch (error) {
    logger.error('Failed to update hourly stats', error);
  }
}