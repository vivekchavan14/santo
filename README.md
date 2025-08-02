# Aura Analytics Worker

A standalone Cloudflare Worker that provides comprehensive analytics and evaluation services for the Aura Voice Assistant platform.

## Overview

The Analytics Worker is a separate microservice that collects, processes, and analyzes voice interaction data from the main Aura Backend Worker. It provides real-time ingestion, automated evaluation, and rich analytics APIs.

## Architecture

```
Main Aura Worker → Analytics Worker → D1 Database
                                   ↓
                                Analytics APIs
                                   ↓
                              Admin Dashboard
```

## Features

- **Real-time Data Ingestion**: Receives voice query and outcome events
- **Automated Evaluation**: LLM-powered quality assessment of interactions
- **Analytics APIs**: Rich statistics and insights endpoints
- **Training Data Export**: JSONL export for model fine-tuning
- **Scheduled Processing**: Automatic batch evaluation via cron

## Quick Start

### Prerequisites

- Node.js 18+
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/install-and-update/)
- Cloudflare account with Workers and D1 enabled

### Installation

```bash
# Clone and install dependencies
npm install

# Build the worker
npm run build

# Create required KV namespace (done automatically during setup)
wrangler kv namespace create "EVAL_QUEUE"

# Deploy to Cloudflare
wrangler deploy
```

### Environment Configuration

Create a `.dev.vars` file for local development:

```bash
# Required for LLM evaluation
GEMINI_API_KEY=your_gemini_api_key_here

# Optional - defaults shown
LOG_LEVEL=info
EVAL_BATCH_SIZE=50
```

Update `wrangler.toml` with your actual resource IDs:
- Replace `database_id` with your D1 database ID
- Replace KV namespace `id` with created namespace ID

## API Reference

### Health Check
```bash
GET /health
# Response: {"status": "healthy", "worker": "analytics"}
```

### Data Ingestion
```bash
POST /ingest
Content-Type: application/json

{
  "event_type": "voice_query",
  "timestamp": "2025-07-25T12:00:00.000Z",
  "query_id": "query_123",
  "store_id": "store_456",
  "session_id": "session_789",
  "user_id": "user_abc",
  "query_text": "search for red shoes",
  "query_source": "voice"
}
```

### Analytics Endpoints

#### Store Summary
```bash
GET /stats/summary?period=24h&store=store_id
```

#### Top Queries
```bash
GET /stats/top-queries?period=7d&limit=10
```

#### Unanswered Queries
```bash
GET /stats/unanswered?period=24h
```

#### Hourly Stats
```bash
GET /stats/hourly?period=24h
```

### Training Data Export
```bash
GET /export/training-data?store=store_id&period=7d
# Returns JSONL file for model fine-tuning
```

## Integration with Main Aura Worker

### Required Database Schema

The analytics worker requires specific D1 database tables. Apply migrations:

```bash
# From the backend-worker directory
./scripts/apply-analytics-migrations.sh
```

### Event Ingestion

The main Aura Worker should send events to the analytics worker:

```typescript
// In your main worker
async function sendAnalyticsEvent(event: AnalyticsEvent, env: Env) {
  try {
    await fetch(`${env.ANALYTICS_WORKER_URL}/ingest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(event)
    });
  } catch (error) {
    console.warn('Analytics ingestion failed:', error);
    // Non-blocking - don't fail main request
  }
}
```

### Event Types

#### Voice Query Event
```typescript
{
  event_type: "voice_query",
  timestamp: string,
  query_id: string,
  store_id: string,
  session_id: string,
  user_id?: string,
  query_text: string,
  query_source: "voice" | "text" | "test",
  audio_duration_ms?: number,
  transcription_confidence?: number
}
```

#### Voice Outcome Event
```typescript
{
  event_type: "voice_outcome",
  timestamp: string,
  query_id: string,
  answer_text: string,
  latency_ms: number,
  action_taken?: boolean,
  action_success?: 0 | 1,
  tools_used?: string[],
  cost_usd?: number,
  tokens_used?: number,
  error_flag?: boolean,
  error_message?: string
}
```

## Development

### Local Testing

```bash
# Start local development server
wrangler dev

# Test endpoints with logging
./test-analytics-with-logs.sh health
./test-analytics-with-logs.sh stats/summary
./test-analytics-with-logs.sh ingest
```

### Testing Scripts

- `test-analytics-with-logs.sh` - Test endpoints with live log capture
- Use existing `log-analyzer.sh` from main project for detailed analysis

### Configuration

The worker automatically handles:
- CORS headers for admin interfaces
- Request validation and error handling
- Structured logging with correlation IDs
- Background processing with `waitUntil()`

## Database Schema

Required tables (created by migrations):

- `voice_queries` - Stores all voice interaction queries
- `voice_outcomes` - Stores interaction results and performance
- `voice_evaluations` - Stores LLM-generated quality scores
- Analytics views for reporting

## Deployment

### Production Deployment

```bash
# Build and deploy
npm run build && wrangler deploy

# Verify deployment
curl https://your-worker.workers.dev/health
```

### Custom Domain Setup

Update `wrangler.toml` routes section:
```toml
routes = [
  { pattern = "analytics.yourdomain.com/*", zone_name = "yourdomain.com" }
]
```

## Monitoring

### Health Monitoring
- Health endpoint: `/health`
- Logs via `wrangler tail`
- Custom dashboard via analytics APIs

### Performance Metrics
- Request latency tracking
- Database query performance
- LLM evaluation success rates
- Background job processing

## Troubleshooting

### Common Issues

1. **Database table not found**
   - Apply analytics migrations from backend-worker
   - Verify D1 database binding

2. **LLM evaluation failures**
   - Check GEMINI_API_KEY environment variable
   - Monitor evaluation logs for rate limits

3. **Ingestion errors**
   - Verify event format matches schema
   - Check CORS configuration for client requests

### Debug Commands

```bash
# Check logs with correlation
./test-analytics-with-logs.sh [endpoint] [correlation-id]

# Monitor live logs
wrangler tail --format=pretty

# Database inspection
wrangler d1 execute aura-db --command "SELECT COUNT(*) FROM voice_queries"
```

## Contributing

1. Follow existing code patterns and TypeScript types
2. Add tests for new endpoints
3. Update this README for API changes
4. Use structured logging with correlation IDs

## License

Part of the Aura Voice Assistant platform.