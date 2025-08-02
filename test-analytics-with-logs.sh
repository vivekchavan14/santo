#!/bin/bash

# Test Analytics Worker endpoints with synchronized log capture
# Usage: ./test-analytics-with-logs.sh [endpoint] [correlationId]

# Color codes for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Get parameters with defaults
ENDPOINT="${1:-stats/general}"
CORRELATION_ID="${2:-analytics-test-$(date +%s)}"
BASE_URL="https://aura-analytics-worker.feisty-agency.workers.dev"
FULL_URL="$BASE_URL/$ENDPOINT"

echo -e "${YELLOW}🚀 Starting Analytics Worker test with live log capture${NC}"
echo -e "Endpoint: ${GREEN}$ENDPOINT${NC}"
echo -e "Full URL: ${GREEN}$FULL_URL${NC}"
echo -e "Correlation ID: ${GREEN}$CORRELATION_ID${NC}"
echo ""

# Create temporary log file
LOG_FILE="/tmp/analytics-test-logs-${CORRELATION_ID}.txt"

# Start wrangler tail in background with formatted output
echo -e "${YELLOW}📡 Starting log capture...${NC}"
wrangler tail --format=pretty > "$LOG_FILE" 2>&1 &
TAIL_PID=$!

# Give wrangler time to connect
sleep 3

echo -e "${BLUE}🌐 Making request to analytics worker...${NC}"

# Make the request with correlation header
if [[ "$ENDPOINT" == "health" ]]; then
    RESPONSE=$(curl -s -w "\n%{http_code}" "$FULL_URL")
elif [[ "$ENDPOINT" == "stats/"* ]]; then
    RESPONSE=$(curl -s -w "\n%{http_code}" "$FULL_URL?period=24h")
elif [[ "$ENDPOINT" == "ingest" ]]; then
    # Test ingest endpoint with sample data
    RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$FULL_URL" \
        -H "Content-Type: application/json" \
        -H "X-Correlation-ID: $CORRELATION_ID" \
        -d '{
            "event_type": "voice_query",
            "timestamp": "'$(date -u +%Y-%m-%dT%H:%M:%S.%3NZ)'",
            "query_id": "test-'$CORRELATION_ID'",
            "store_id": "test-store",
            "session_id": "test-session",
            "user_id": "test-user",
            "query_text": "test query",
            "query_source": "test"
        }')
else
    RESPONSE=$(curl -s -w "\n%{http_code}" "$FULL_URL" -H "X-Correlation-ID: $CORRELATION_ID")
fi

# Wait for logs to be captured
sleep 2

# Stop log capture
kill $TAIL_PID 2>/dev/null || true
sleep 1

# Parse response
HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | head -n -1)

echo -e "${BLUE}📊 Response Details:${NC}"
echo -e "Status Code: ${GREEN}$HTTP_CODE${NC}"
echo -e "Response Body:"
echo "$BODY" | jq . 2>/dev/null || echo "$BODY"
echo ""

echo -e "${YELLOW}📋 Captured Logs:${NC}"
if [ -f "$LOG_FILE" ] && [ -s "$LOG_FILE" ]; then
    # Filter logs by correlation ID if available
    if grep -q "$CORRELATION_ID" "$LOG_FILE" 2>/dev/null; then
        echo -e "${GREEN}✅ Found correlated logs:${NC}"
        grep "$CORRELATION_ID" "$LOG_FILE" || echo "No correlation matches found"
    else
        echo -e "${BLUE}📄 Recent logs (last 20 lines):${NC}"
        tail -n 20 "$LOG_FILE"
    fi
else
    echo -e "${RED}❌ No logs captured or log file empty${NC}"
fi

echo ""
echo -e "${BLUE}🔍 Log file saved to: ${GREEN}$LOG_FILE${NC}"
echo -e "${YELLOW}💡 Tip: Use './log-analyzer.sh correlation $CORRELATION_ID' for detailed analysis${NC}"