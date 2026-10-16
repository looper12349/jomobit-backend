#!/bin/bash

echo "✅ Everything looks good! Testing now..."
echo ""

LB="ac0313d2e870f42a9a775e60144d1f3a-799e9ec9e60eab7b.elb.ap-south-1.amazonaws.com"

echo "LoadBalancer: $LB"
echo ""

echo "Testing Grafana..."
echo "URL: http://$LB/grafana"
curl -I "http://$LB/grafana"

echo ""
echo "Testing Prometheus..."
echo "URL: http://$LB/prometheus"
curl -I "http://$LB/prometheus"

echo ""
echo "Testing with HTTPS (if DNS is updated)..."
echo "URL: https://api-dev-jomo.dazzeldigital.com/grafana"
curl -I "https://api-dev-jomo.dazzeldigital.com/grafana"

echo ""
echo "📋 Summary:"
echo "==========="
echo ""
echo "If you see HTTP 302 or 200 above, monitoring is working!"
echo ""
echo "Next step: Update DNS to point to this LoadBalancer:"
echo "  $LB"
