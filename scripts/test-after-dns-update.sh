#!/bin/bash

echo "🧪 Testing Staging Services After DNS Update..."
echo ""

DOMAIN="api-dev-jomo.dazzeldigital.com"

echo "1️⃣ Checking DNS resolution..."
echo "================================"
nslookup $DOMAIN
echo ""

echo "2️⃣ Testing Application API..."
echo "================================"
echo "URL: https://$DOMAIN/api/health"
curl -I https://$DOMAIN/api/health
echo ""

echo "3️⃣ Testing Grafana..."
echo "================================"
echo "URL: https://$DOMAIN/grafana/"
curl -I https://$DOMAIN/grafana/
echo ""

echo "4️⃣ Testing Prometheus..."
echo "================================"
echo "URL: https://$DOMAIN/prometheus/"
curl -I https://$DOMAIN/prometheus/
echo ""

echo "📋 Summary:"
echo "==========="
echo "Look for:"
echo "- HTTP/1.1 200 OK (Application API) ✅"
echo "- HTTP/1.1 302 Found (Grafana redirect to login) ✅"
echo "- HTTP/1.1 405 Method Not Allowed (Prometheus - HEAD not supported) ✅"
echo ""
echo "Access URLs:"
echo "- Application: https://$DOMAIN/api"
echo "- Grafana: https://$DOMAIN/grafana/"
echo "- Prometheus: https://$DOMAIN/prometheus/"
echo ""
echo "Grafana Login:"
echo "- Username: admin"
echo "- Password: jomo@fnz7n"
