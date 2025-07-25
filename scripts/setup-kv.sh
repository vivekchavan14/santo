#!/usr/bin/env bash
set -euo pipefail

echo "Creating KV namespace for evaluation queue..."

# Create the namespace and grab the *production* id
KV_ID=$(wrangler kv:namespace create "EVAL_QUEUE" --preview=false | awk -F'"' '/id = / && !/preview_id/ {print $2}')

if [ -z "$KV_ID" ]; then
    echo "❌ Failed to create KV namespace"
    exit 1
fi

echo "✅ Created KV namespace with ID: $KV_ID"
echo ""
echo "Update your analytics-worker/wrangler.toml with:"
echo ""
echo "[[kv_namespaces]]"
echo "binding = \"EVAL_QUEUE\""
echo "id = \"$KV_ID\""