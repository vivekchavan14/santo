// Stats handler - Provides analytics query endpoints

import { 
  AnalyticsEnv, 
  StatsQueryParams, 
  StoreSummaryStats, 
  TopQuery, 
  UnansweredQuery 
} from '../types';
import { Logger, parsePeriod } from '../utils';

export async function handleStats(
  url: URL, 
  env: AnalyticsEnv, 
  logger: Logger
): Promise<any> {
  const pathname = url.pathname.replace('/stats/', '');
  const params = parseQueryParams(url);
  
  logger.debug(`Handling stats request: ${pathname}`, params);
  
  switch (pathname) {
    case 'summary':
      return await getStoreSummary(params, env, logger);
    
    case 'top-queries':
      return await getTopQueries(params, env, logger);
    
    case 'unanswered':
      return await getUnansweredQueries(params, env, logger);
    
    case 'dataset':
      return await getTrainingDataset(params, env, logger);
    
    case 'hourly':
      return await getHourlyStats(params, env, logger);
    
    default:
      throw new Error(`Unknown stats endpoint: ${pathname}`);
  }
}

function parseQueryParams(url: URL): StatsQueryParams {
  const searchParams = url.searchParams;
  return {
    storeId: searchParams.get('store') || searchParams.get('storeId') || undefined,
    period: searchParams.get('period') || '24h',
    limit: parseInt(searchParams.get('limit') || '20'),
    since: searchParams.get('since') ? parseInt(searchParams.get('since')!) : undefined
  };
}

async function getStoreSummary(
  params: StatsQueryParams,
  env: AnalyticsEnv,
  logger: Logger
): Promise<StoreSummaryStats> {
  const { start, end } = parsePeriod(params.period || '24h');
  
  // Build query with optional store filter
  let query = `
    SELECT 
      COUNT(DISTINCT q.id) as total_queries,
      COUNT(DISTINCT CASE WHEN o.action_success = 1 THEN q.id END) as successful_queries,
      COUNT(DISTINCT CASE WHEN o.error_flag = 1 OR o.action_success = 0 THEN q.id END) as failed_queries,
      AVG(o.latency_ms) as avg_latency,
      SUM(o.cost_usd) as total_cost,
      COUNT(DISTINCT q.session_id) as unique_sessions
    FROM voice_queries q
    LEFT JOIN voice_outcomes o ON o.query_id = q.id
    WHERE q.created_at >= ?1 AND q.created_at <= ?2
  `;
  
  const bindings: any[] = [start, end];
  
  if (params.storeId) {
    query += ' AND q.store_id = ?3';
    bindings.push(params.storeId);
  }
  
  const result = await env.AURA_DB.prepare(query).bind(...bindings).first();
  
  if (!result) {
    throw new Error('Failed to get store summary');
  }
  
  // Calculate conversion rate (simplified - you might want to join with purchase events)
  const conversionRate = 0; // TODO: Implement actual conversion tracking
  
  // Calculate unanswered rate
  const unansweredCount = await env.AURA_DB.prepare(`
    SELECT COUNT(DISTINCT q.id) as count
    FROM voice_queries q
    LEFT JOIN voice_outcomes o ON o.query_id = q.id
    LEFT JOIN voice_evaluations e ON e.query_id = q.id
    WHERE q.created_at >= ?1 AND q.created_at <= ?2
      AND (o.action_success = 0 OR e.label IN ('REVIEW', 'BAD'))
      ${params.storeId ? 'AND q.store_id = ?3' : ''}
  `).bind(...bindings).first();
  
  const unansweredRate = (result as any).total_queries > 0 
    ? ((unansweredCount as any)?.count || 0) / (result as any).total_queries 
    : 0;
  
  return {
    storeId: params.storeId || 'all',
    period: params.period || '24h',
    totalQueries: (result as any).total_queries || 0,
    successfulQueries: (result as any).successful_queries || 0,
    failedQueries: (result as any).failed_queries || 0,
    averageLatencyMs: Math.round((result as any).avg_latency || 0),
    totalCostUsd: (result as any).total_cost || 0,
    uniqueSessions: (result as any).unique_sessions || 0,
    conversionRate,
    unansweredRate
  };
}

async function getTopQueries(
  params: StatsQueryParams,
  env: AnalyticsEnv,
  logger: Logger
): Promise<TopQuery[]> {
  const { start, end } = parsePeriod(params.period || '24h');
  
  let query = `
    SELECT 
      q.query_text,
      q.intent,
      COUNT(*) as query_count,
      AVG(o.latency_ms) as avg_latency,
      SUM(CASE WHEN o.action_success = 1 THEN 1 ELSE 0 END) * 100.0 / COUNT(*) as success_rate
    FROM voice_queries q
    LEFT JOIN voice_outcomes o ON o.query_id = q.id
    WHERE q.created_at >= ?1 AND q.created_at <= ?2
  `;
  
  const bindings: any[] = [start, end];
  
  if (params.storeId) {
    query += ' AND q.store_id = ?3';
    bindings.push(params.storeId);
  }
  
  query += `
    GROUP BY q.query_text, q.intent
    ORDER BY query_count DESC
    LIMIT ?${bindings.length + 1}
  `;
  bindings.push(params.limit || 20);
  
  const results = await env.AURA_DB.prepare(query).bind(...bindings).all();
  
  return results.results.map(row => ({
    queryText: row.query_text as string,
    intent: row.intent as string | undefined,
    count: row.query_count as number,
    avgLatencyMs: Math.round(row.avg_latency as number || 0),
    successRate: Math.round(row.success_rate as number || 0)
  }));
}

async function getUnansweredQueries(
  params: StatsQueryParams,
  env: AnalyticsEnv,
  logger: Logger
): Promise<UnansweredQuery[]> {
  const { start, end } = parsePeriod(params.period || '24h');
  
  let query = `
    SELECT 
      q.query_text,
      q.intent,
      COUNT(*) as occurrence_count,
      MAX(q.created_at) as last_seen,
      GROUP_CONCAT(DISTINCT 
        CASE 
          WHEN o.error_flag = 1 THEN 'error'
          WHEN o.action_success = 0 THEN 'action_failed'
          WHEN e.label = 'BAD' THEN 'bad_quality'
          WHEN e.label = 'REVIEW' THEN 'needs_review'
          WHEN o.latency_ms > 8000 THEN 'slow_response'
          ELSE 'unknown'
        END
      ) as reasons
    FROM voice_queries q
    LEFT JOIN voice_outcomes o ON o.query_id = q.id
    LEFT JOIN voice_evaluations e ON e.query_id = q.id
    WHERE q.created_at >= ?1 AND q.created_at <= ?2
      AND (
        o.action_success = 0 
        OR o.error_flag = 1
        OR e.label IN ('REVIEW', 'BAD')
        OR o.latency_ms > 8000
      )
  `;
  
  const bindings: any[] = [start, end];
  
  if (params.storeId) {
    query += ' AND q.store_id = ?3';
    bindings.push(params.storeId);
  }
  
  query += `
    GROUP BY q.query_text, q.intent
    ORDER BY occurrence_count DESC
    LIMIT ?${bindings.length + 1}
  `;
  bindings.push(params.limit || 20);
  
  const results = await env.AURA_DB.prepare(query).bind(...bindings).all();
  
  return results.results.map(row => ({
    queryText: row.query_text as string,
    intent: row.intent as string | undefined,
    occurrences: row.occurrence_count as number,
    lastSeen: row.last_seen as number,
    reasons: (row.reasons as string || '').split(',').filter(r => r)
  }));
}

async function getTrainingDataset(
  params: StatsQueryParams,
  env: AnalyticsEnv,
  logger: Logger
): Promise<any[]> {
  const since = params.since || Date.now() - 30 * 24 * 60 * 60 * 1000; // Default 30 days
  const label = new URL(params as any).searchParams.get('label') || 'GOOD';
  
  let query = `
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
    WHERE e.label = ?1
      AND q.created_at >= ?2
      AND o.action_success = 1
      AND o.error_flag = 0
  `;
  
  const bindings: any[] = [label, since];
  
  if (params.storeId) {
    query += ' AND q.store_id = ?3';
    bindings.push(params.storeId);
  }
  
  query += ' ORDER BY q.created_at DESC LIMIT 1000'; // Limit to prevent huge responses
  
  const results = await env.AURA_DB.prepare(query).bind(...bindings).all();
  
  return results.results;
}

async function getHourlyStats(
  params: StatsQueryParams,
  env: AnalyticsEnv,
  logger: Logger
): Promise<any[]> {
  const { start, end } = parsePeriod(params.period || '24h');
  
  let query = `
    SELECT 
      hour_bucket,
      SUM(total_queries) as queries,
      SUM(successful_queries) as successes,
      SUM(failed_queries) as failures,
      AVG(total_latency_ms / NULLIF(total_queries, 0)) as avg_latency,
      SUM(total_cost_usd) as cost,
      SUM(unique_sessions) as sessions
    FROM voice_stats_hourly
    WHERE hour_bucket * 1000 >= ?1 AND hour_bucket * 1000 <= ?2
  `;
  
  const bindings: any[] = [start, end];
  
  if (params.storeId) {
    query += ' AND store_id = ?3';
    bindings.push(params.storeId);
  }
  
  query += ' GROUP BY hour_bucket ORDER BY hour_bucket DESC';
  
  const results = await env.AURA_DB.prepare(query).bind(...bindings).all();
  
  return results.results.map(row => ({
    hour: new Date(row.hour_bucket as number * 1000).toISOString(),
    queries: row.queries || 0,
    successes: row.successes || 0,
    failures: row.failures || 0,
    avgLatencyMs: Math.round(row.avg_latency as number || 0),
    costUsd: row.cost || 0,
    sessions: row.sessions || 0
  }));
}