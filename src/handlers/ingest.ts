// Ingest handler - receives and stores analytics events

import { AnalyticsEnv, VoiceQueryEvent, VoiceOutcomeEvent, LLMCallEvent } from '../types';
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

    // Process LLM call event
    if (payload.type === 'llm_call') {
      const event = payload as LLMCallEvent;
      
      // Ensure we have a call ID
      if (!event.callId) {
        event.callId = generateULID();
      }

      logger.debug('Ingesting LLM call event', { 
        callId: event.callId, 
        modelName: event.modelName,
        provider: event.provider,
        customerId: event.customerId 
      });

      // Insert into llm_calls table
      await db.prepare(
        `INSERT INTO llm_calls
          (call_id, query_id, customer_id, session_id, timestamp,
           model_name, provider, prompt_text, completion_text,
           tokens_prompt, tokens_completion, latency_ms, cost_usd,
           temperature, max_tokens, system_prompt, error_message, request_metadata)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18)`
      ).bind(
        event.callId,
        event.queryId || null,
        event.customerId || null,
        event.sessionId || null,
        event.timestamp,
        event.modelName,
        event.provider,
        event.promptText || null,
        event.completionText || null,
        event.tokensPrompt,
        event.tokensCompletion,
        event.latencyMs,
        event.costUsd,
        event.temperature || null,
        event.maxTokens || null,
        event.systemPrompt || null,
        event.errorMessage || null,
        event.requestMetadata || null
      ).run();

      // Update LLM usage stats (fire-and-forget)
      ctx.waitUntil(updateLLMUsageStats(db, event, logger));

      // Update customer insights (fire-and-forget)
      if (event.customerId) {
        ctx.waitUntil(updateCustomerInsights(db, event, logger));
      }

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
<<<<<<< HEAD
}

// Update LLM usage statistics
async function updateLLMUsageStats(
  db: D1Database,
  event: LLMCallEvent,
  logger: Logger
): Promise<void> {
  try {
    const hourBucket = getHourBucket(event.timestamp);
    const hasError = event.errorMessage ? 1 : 0;
    
    // Try to update existing row first
    const result = await db.prepare(
      `UPDATE llm_usage_hourly 
       SET total_calls = total_calls + 1,
           total_tokens = total_tokens + ?3,
           total_cost_usd = total_cost_usd + ?4,
           total_latency_ms = total_latency_ms + ?5,
           error_count = error_count + ?6
       WHERE hour_bucket = ?1 AND model_name = ?2`
    ).bind(
      hourBucket, 
      event.modelName,
      event.tokensPrompt + event.tokensCompletion,
      event.costUsd,
      event.latencyMs,
      hasError
    ).run();

    // If no rows updated, insert new row
    if (result.meta.changes === 0) {
      await db.prepare(
        `INSERT INTO llm_usage_hourly 
         (hour_bucket, model_name, provider, total_calls, total_tokens, 
          total_cost_usd, total_latency_ms, error_count)
         VALUES (?1, ?2, ?3, 1, ?4, ?5, ?6, ?7)`
      ).bind(
        hourBucket,
        event.modelName,
        event.provider,
        event.tokensPrompt + event.tokensCompletion,
        event.costUsd,
        event.latencyMs,
        hasError
      ).run();
    }
  } catch (error) {
    logger.error('Failed to update LLM usage stats', error);
  }
}

// Update customer insights
async function updateCustomerInsights(
  db: D1Database,
  event: LLMCallEvent,
  logger: Logger
): Promise<void> {
  try {
    if (!event.customerId) return;
    
    // Get current customer insights
    const existing = await db.prepare(
      `SELECT total_interactions, total_cost_usd, avg_latency_ms, preferred_topics 
       FROM customer_insights WHERE customer_id = ?1`
    ).bind(event.customerId).first();

    if (existing) {
      // Update existing customer
      const newInteractions = (existing.total_interactions as number) + 1;
      const newCost = (existing.total_cost_usd as number) + event.costUsd;
      const newAvgLatency = (
        ((existing.avg_latency_ms as number) * (existing.total_interactions as number) + event.latencyMs) / 
        newInteractions
      );

      await db.prepare(
        `UPDATE customer_insights 
         SET total_interactions = ?1,
             total_cost_usd = ?2,
             avg_latency_ms = ?3,
             last_active = ?4,
             insights_updated = ?5
         WHERE customer_id = ?6`
      ).bind(
        newInteractions,
        newCost,
        newAvgLatency,
        event.timestamp,
        Date.now(),
        event.customerId
      ).run();
    } else {
      // Insert new customer
      await db.prepare(
        `INSERT INTO customer_insights 
         (customer_id, total_interactions, total_cost_usd, avg_latency_ms, 
          satisfaction_score, last_active, insights_updated)
         VALUES (?1, 1, ?2, ?3, 0.5, ?4, ?5)`
      ).bind(
        event.customerId,
        event.costUsd,
        event.latencyMs,
        event.timestamp,
        Date.now()
      ).run();
    }
  } catch (error) {
    logger.error('Failed to update customer insights', error);
  }
}
=======
}
>>>>>>> 8b3927b8c812312452cd3c6a3c537aa35dc65819
