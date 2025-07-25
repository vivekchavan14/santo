# Analytics Worker Integration Guide

This document provides complete integration instructions for developers working on the Analytics Worker as a standalone project.

## Main Aura Worker Integration Points

### 1. Database Schema Dependency

The Analytics Worker requires specific D1 database tables that are created by the main Aura project. 

**Required Migration Files** (from `backend-worker/migrations/analytics/`):
- `001_voice_queries.sql` - Core query tracking table
- `002_voice_outcomes.sql` - Interaction results and performance
- `003_voice_evaluations.sql` - LLM quality assessments  
- `004_create_views.sql` - Analytics reporting views

**To apply migrations manually:**
```bash
# Connect to your D1 database
wrangler d1 execute aura-db --file=001_voice_queries.sql
wrangler d1 execute aura-db --file=002_voice_outcomes.sql
wrangler d1 execute aura-db --file=003_voice_evaluations.sql
wrangler d1 execute aura-db --file=004_create_views.sql
```

### 2. Event Integration

The main Aura Worker sends analytics events via HTTP POST to `/ingest`. 

**Integration Code Example:**
```typescript
// Add to your main worker's response pipeline
async function logAnalyticsEvent(
  eventType: 'voice_query' | 'voice_outcome', 
  data: any, 
  env: Env
) {
  // Non-blocking analytics call
  env.waitUntil?.(
    fetch(`${env.ANALYTICS_WORKER_URL}/ingest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event_type: eventType,
        timestamp: new Date().toISOString(),
        ...data
      })
    }).catch(err => console.warn('Analytics failed:', err))
  );
}
```

### 3. Environment Variables

**Required in main worker:**
```bash
ANALYTICS_WORKER_URL=https://aura-analytics-worker.feisty-agency.workers.dev
```

**Required in analytics worker:**
```bash
GEMINI_API_KEY=your_gemini_api_key_here
LOG_LEVEL=info
EVAL_BATCH_SIZE=50
```

### 4. Data Flow

```
User Voice Query → Main Aura Worker → Process Query → Generate Response
                            ↓
                   Send voice_query event → Analytics Worker → Store in D1
                            ↓
                   Send voice_outcome event → Analytics Worker → Store + Queue for Evaluation
                            ↓
                   Cron Job (every minute) → Evaluate Batch → Store Evaluations
```

## Standalone Development Setup

### 1. Database Setup

**Option A: Create New D1 Database**
```bash
wrangler d1 create aura-analytics-db
# Update database_id in wrangler.toml
```

**Option B: Use Existing Database**
```bash
# Get database ID from main project
wrangler d1 list
# Update database_id in wrangler.toml with existing aura-db ID
```

### 2. Required External Services

**Gemini API** (for LLM evaluations):
1. Get API key from [Google AI Studio](https://aistudio.google.com/app/apikey)
2. Add to `.dev.vars` file
3. Set as secret: `wrangler secret put GEMINI_API_KEY`

### 3. KV Namespace Setup

```bash
# Create evaluation queue namespace
wrangler kv namespace create "EVAL_QUEUE"
# Update the ID in wrangler.toml
```

## Testing Integration

### 1. End-to-End Test

```bash
# Test complete flow
./test-analytics-with-logs.sh ingest
./test-analytics-with-logs.sh stats/summary
```

### 2. Verify Data Pipeline

```bash
# Check database has data
wrangler d1 execute aura-db --command "SELECT COUNT(*) FROM voice_queries"
wrangler d1 execute aura-db --command "SELECT COUNT(*) FROM voice_outcomes"
wrangler d1 execute aura-db --command "SELECT COUNT(*) FROM voice_evaluations"
```

### 3. Monitor Cron Jobs

```bash
# Check scheduled evaluation runs
wrangler tail --format=pretty | grep "evaluation"
```

## API Authentication (Future)

Currently no authentication required. For production deployment, consider:

1. **API Keys**: Add X-API-Key header validation
2. **IP Allowlisting**: Restrict to main worker IPs
3. **Request Signatures**: HMAC-based request signing

## Performance Considerations

### 1. Database Optimization

- Indexes on `store_id`, `created_at` for fast queries
- Partitioning for large datasets (by date/store)
- Archive old data periodically

### 2. Rate Limiting

```typescript
// In main worker - batch analytics events
const analyticsQueue = [];
const BATCH_SIZE = 10;

function queueAnalyticsEvent(event) {
  analyticsQueue.push(event);
  if (analyticsQueue.length >= BATCH_SIZE) {
    flushAnalyticsQueue();
  }
}
```

### 3. Caching

- Cache frequently accessed stats
- Use KV for computed aggregations
- Implement cache invalidation strategy

## Troubleshooting

### Common Integration Issues

1. **CORS Errors**
   ```typescript
   // Ensure main worker allows analytics domain
   'Access-Control-Allow-Origin': 'https://your-main-domain.com'
   ```

2. **Database Connection**
   ```bash
   # Verify D1 binding
   wrangler dev --local
   # Check logs for binding errors
   ```

3. **Missing Environment Variables**
   ```bash
   # Check all required vars are set
   wrangler secret list
   ```

### Debug Workflow

1. **Check Event Format**
   ```bash
   # Validate event structure matches expected schema
   ./test-analytics-with-logs.sh ingest
   ```

2. **Verify Database Schema**
   ```bash
   # Ensure all tables exist
   wrangler d1 execute aura-db --command ".schema"
   ```

3. **Monitor Evaluation Pipeline**
   ```bash
   # Watch cron job execution
   wrangler tail --format=pretty | grep -E "(evaluation|cron)"
   ```

## Deployment Checklist

- [ ] Database migrations applied
- [ ] Environment variables configured
- [ ] KV namespace created and bound
- [ ] Gemini API key set
- [ ] Health endpoint responding
- [ ] Ingestion endpoint accepting events
- [ ] Analytics endpoints returning data
- [ ] Cron jobs running successfully
- [ ] Main worker integration tested

## Support

For integration issues:
1. Check this documentation
2. Review test scripts and logs
3. Verify environment configuration
4. Test with minimal data set first