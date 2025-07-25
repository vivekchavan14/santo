// Analytics Worker - Main entry point

import { AnalyticsEnv, VoiceQueryEvent, VoiceOutcomeEvent } from './types';
import { Logger, generateULID, getHourBucket } from './utils';
import { handleIngest } from './handlers/ingest';
import { handleStats } from './handlers/stats';
import { evaluateBatch } from './handlers/evaluation';
import { handleTrainingExport } from './handlers/export';

export default {
  async fetch(
    request: Request,
    env: AnalyticsEnv,
    ctx: ExecutionContext
  ): Promise<Response> {
    const logger = new Logger(env.LOG_LEVEL);
    const url = new URL(request.url);

    // CORS headers for admin UI
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    // Handle preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      // Route: POST /ingest - receive analytics events
      if (url.pathname === '/ingest' && request.method === 'POST') {
        return await handleIngest(request, env, ctx, logger);
      }

      // Route: GET /stats/* - analytics queries
      if (url.pathname.startsWith('/stats/') && request.method === 'GET') {
        const response = await handleStats(url, env, logger);
        return new Response(JSON.stringify(response), {
          headers: {
            'Content-Type': 'application/json',
            ...corsHeaders,
          },
        });
      }

      // Route: GET /export/training-data - fine-tuning data export
      if (url.pathname === '/export/training-data' && request.method === 'GET') {
        const response = await handleTrainingExport(url, env, logger);
        const filename = `training_data_${Date.now()}.jsonl`;
        
        return new Response(response, {
          headers: {
            'Content-Type': 'application/x-ndjson',
            'Content-Disposition': `attachment; filename="${filename}"`,
            ...corsHeaders,
          },
        });
      }

      // Route: GET /health
      if (url.pathname === '/health') {
        return new Response(JSON.stringify({ status: 'healthy', worker: 'analytics' }), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }

      return new Response('Not Found', { status: 404 });
    } catch (error) {
      logger.error('Worker error', error);
      return new Response(JSON.stringify({ error: 'Internal Server Error' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }
  },

  // Scheduled cron handler for evaluation
  async scheduled(
    event: ScheduledEvent,
    env: AnalyticsEnv,
    ctx: ExecutionContext
  ): Promise<void> {
    const logger = new Logger(env.LOG_LEVEL);
    logger.info('Starting scheduled evaluation batch');

    try {
      await evaluateBatch(env, logger);
    } catch (error) {
      logger.error('Evaluation batch failed', error);
    }
  },
};