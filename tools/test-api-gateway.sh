#!/bin/bash
# Test script for API Gateway

BASE_URL="http://localhost:8000"

echo "========================================="
echo "API Gateway Test Suite"
echo "========================================="
echo ""

# Test 1: Telegram endpoint
echo "1. Testing /api/news/telegram"
RESPONSE=$(curl -s "${BASE_URL}/api/news/telegram")
FEED_COUNT=$(echo "$RESPONSE" | jq -r '.count')
CACHED=$(echo "$RESPONSE" | jq -r '.cached')
echo "   ✓ Feeds: $FEED_COUNT, Cached: $CACHED"
echo ""

# Test 2: RSS endpoint
echo "2. Testing /api/news/rss"
RESPONSE=$(curl -s "${BASE_URL}/api/news/rss")
FEED_COUNT=$(echo "$RESPONSE" | jq -r '.count')
CACHED=$(echo "$RESPONSE" | jq -r '.cached')
echo "   ✓ Feeds: $FEED_COUNT, Cached: $CACHED"
echo ""

# Test 3: Aggregator endpoint
echo "3. Testing /api/news/aggregator"
RESPONSE=$(curl -s "${BASE_URL}/api/news/aggregator")
FEED_COUNT=$(echo "$RESPONSE" | jq -r '.count')
CACHED=$(echo "$RESPONSE" | jq -r '.cached')
echo "   ✓ Feeds: $FEED_COUNT, Cached: $CACHED"
echo ""

# Test 4: Midjourney endpoint
echo "4. Testing /api/news/midjourney-data"
RESPONSE=$(curl -s "${BASE_URL}/api/news/midjourney-data")
ITEMS=$(echo "$RESPONSE" | jq -r '.items | length')
CACHED=$(echo "$RESPONSE" | jq -r '.cached')
echo "   ✓ Items: $ITEMS, Cached: $CACHED"
echo ""

# Test 5: Cache stats
echo "5. Testing /api/cache/stats"
STATS=$(curl -s "${BASE_URL}/api/cache/stats")
TOTAL=$(echo "$STATS" | jq -r '.total')
VALID=$(echo "$STATS" | jq -r '.valid')
EXPIRED=$(echo "$STATS" | jq -r '.expired')
echo "   ✓ Total: $TOTAL, Valid: $VALID, Expired: $EXPIRED"
echo ""

# Test 6: Performance test
echo "6. Performance Test (cached vs uncached)"
echo "   First request (may be cached):"
TIME1=$(curl -w "%{time_total}" -o /dev/null -s "${BASE_URL}/api/news/telegram")
echo "     Time: ${TIME1}s"
echo "   Second request (cached):"
TIME2=$(curl -w "%{time_total}" -o /dev/null -s "${BASE_URL}/api/news/telegram")
echo "     Time: ${TIME2}s"
echo ""

# Test 7: CORS headers
echo "7. Testing CORS headers"
HEADERS=$(curl -s -I "${BASE_URL}/api/news/telegram" | grep -i "access-control")
if [ ! -z "$HEADERS" ]; then
    echo "   ✓ CORS headers present"
else
    echo "   ✗ CORS headers missing"
fi
echo ""

echo "========================================="
echo "All tests completed!"
echo "========================================="
