# Standalone Analytics Worker Setup

This directory contains everything needed to run the Aura Analytics Worker as a completely separate project.

## ✅ What's Included

### Core Application
- `src/` - Complete TypeScript source code
- `dist/` - Compiled JavaScript (generated)
- `wrangler.toml` - Cloudflare Worker configuration
- `tsconfig.json` - TypeScript configuration
- `package.json` - Dependencies and scripts

### Database
- `migrations/` - Complete D1 database schema
  - `001_voice_queries.sql` - Query tracking table
  - `002_voice_outcomes.sql` - Interaction results
  - `003_voice_evaluations.sql` - LLM quality scores
  - `004_create_views.sql` - Analytics views

### Documentation
- `README.md` - Complete API documentation and usage
- `INTEGRATION.md` - Integration guide with main Aura worker
- This file - Standalone setup instructions

### Testing & Development
- `test-analytics-with-logs.sh` - Test script with live log capture
- `setup.sh` - Automated setup script
- `.dev.vars` template - Environment configuration

## 🚀 Quick Start for New Developers

```bash
# 1. Install and setup
npm install
npm run setup

# 2. Configure environment
cp .dev.vars.example .dev.vars
# Edit .dev.vars with your Gemini API key

# 3. Deploy
npm run deploy

# 4. Test
npm test
```

## 🔗 Integration Points

### With Main Aura Worker
The analytics worker receives events via HTTP POST from the main worker:

```typescript
// Main worker sends:
POST /ingest
{
  "event_type": "voice_query",
  "query_id": "...",
  "store_id": "...",
  // ... other fields
}
```

### Database Dependency
- Uses the same D1 database as main worker
- Requires specific tables (created by migrations)
- Shares `database_id` in wrangler.toml

### External Dependencies
- **Gemini API** - For LLM-powered quality evaluation
- **Cloudflare KV** - For evaluation queue management
- **Cloudflare D1** - For data storage

## 📊 Key Features

1. **Real-time Ingestion** - Receives voice interaction data
2. **Automated Evaluation** - LLM quality assessment via cron
3. **Rich Analytics APIs** - Stats, top queries, performance metrics
4. **Training Export** - JSONL export for model fine-tuning
5. **Comprehensive Logging** - Structured logs with correlation IDs

## 🛠️ Development Workflow

```bash
# Local development
wrangler dev

# View logs
wrangler tail --format=pretty

# Test specific endpoints
./test-analytics-with-logs.sh [endpoint] [correlation-id]

# Apply database changes
npm run migrations

# Deploy changes
npm run deploy
```

## 🏗️ Architecture

```
Voice Query → Main Aura Worker → Analytics Worker → D1 Database
                                        ↓
                                 Cron Evaluation → Gemini API
                                        ↓
                               Analytics APIs → Admin Dashboard
```

## 🚨 Important Notes

1. **Database Schema**: Must apply migrations before first use
2. **API Keys**: Gemini API key required for evaluation features
3. **Cron Jobs**: Automatic evaluation runs every minute
4. **Non-blocking**: Designed to never block main worker requests
5. **CORS Enabled**: Ready for admin dashboard integration

## 📝 Environment Variables

```bash
# Required
GEMINI_API_KEY=your_key_here

# Optional (with defaults)
LOG_LEVEL=info
EVAL_BATCH_SIZE=50
```

## 🔍 Monitoring

- Health: `GET /health`
- Logs: `wrangler tail`
- Database: `wrangler d1 execute aura-db --command "SELECT COUNT(*) FROM voice_queries"`

This setup enables complete independence from the main Aura codebase while maintaining full integration capability.