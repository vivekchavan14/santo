#!/bin/bash

# Analytics Worker Setup Script
# Sets up the analytics worker as a standalone project

set -e

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}🚀 Setting up Aura Analytics Worker${NC}"
echo ""

# Check dependencies
echo -e "${YELLOW}📋 Checking dependencies...${NC}"

if ! command -v wrangler &> /dev/null; then
    echo -e "${RED}❌ Wrangler CLI not found. Install with: npm install -g wrangler${NC}"
    exit 1
fi

if ! command -v jq &> /dev/null; then
    echo -e "${RED}❌ jq not found. Install with: brew install jq${NC}"
    exit 1
fi

echo -e "${GREEN}✅ Dependencies OK${NC}"

# Install npm dependencies
echo -e "${YELLOW}📦 Installing dependencies...${NC}"
npm install

# Build the worker
echo -e "${YELLOW}🔨 Building worker...${NC}"
npm run build

# Create KV namespace if it doesn't exist
echo -e "${YELLOW}🗂️  Setting up KV namespace...${NC}"
KV_OUTPUT=$(wrangler kv namespace create "EVAL_QUEUE" 2>&1 || true)

if echo "$KV_OUTPUT" | grep -q "already exists"; then
    echo -e "${BLUE}ℹ️  KV namespace already exists${NC}"
else
    echo -e "${GREEN}✅ KV namespace created${NC}"
    echo "$KV_OUTPUT"
fi

# Check if database exists
echo -e "${YELLOW}🗄️  Checking D1 database...${NC}"
if wrangler d1 list | grep -q "aura-db"; then
    echo -e "${GREEN}✅ D1 database found${NC}"
else
    echo -e "${YELLOW}⚠️  D1 database 'aura-db' not found. Creating...${NC}"
    wrangler d1 create aura-db
    echo -e "${RED}⚠️  Update wrangler.toml with the new database ID${NC}"
fi

# Apply migrations
echo -e "${YELLOW}📊 Applying database migrations...${NC}"
for migration in migrations/*.sql; do
    if [ -f "$migration" ]; then
        echo "Applying $(basename "$migration")..."
        wrangler d1 execute aura-db --file="$migration" || true
    fi
done

echo -e "${GREEN}✅ Migrations applied${NC}"

# Create .dev.vars template if it doesn't exist
if [ ! -f ".dev.vars" ]; then
    echo -e "${YELLOW}📝 Creating .dev.vars template...${NC}"
    cat > .dev.vars << EOF
# Required for LLM evaluation
GEMINI_API_KEY=your_gemini_api_key_here

# Optional - defaults shown
LOG_LEVEL=info
EVAL_BATCH_SIZE=50
EOF
    echo -e "${YELLOW}⚠️  Please update .dev.vars with your actual API keys${NC}"
fi

# Test deployment
echo -e "${YELLOW}🚀 Testing deployment...${NC}"
if wrangler deploy --dry-run; then
    echo -e "${GREEN}✅ Deployment test passed${NC}"
else
    echo -e "${RED}❌ Deployment test failed${NC}"
    exit 1
fi

echo ""
echo -e "${GREEN}🎉 Setup complete!${NC}"
echo ""
echo -e "${BLUE}Next steps:${NC}"
echo "1. Update .dev.vars with your Gemini API key"
echo "2. Deploy: ${YELLOW}wrangler deploy${NC}"
echo "3. Test: ${YELLOW}./test-analytics-with-logs.sh health${NC}"
echo ""
echo -e "${BLUE}Useful commands:${NC}"
echo "• ${YELLOW}wrangler dev${NC} - Start local development"
echo "• ${YELLOW}wrangler tail${NC} - View live logs"
echo "• ${YELLOW}./test-analytics-with-logs.sh [endpoint]${NC} - Test with logs"