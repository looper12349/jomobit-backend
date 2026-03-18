#!/bin/bash

echo "🧪 Testing LoadBalancer with Host Headers..."
echo ""

LB="ac0313d2e870f42a9a775e60144d1f3a-799e9ec9e60eab7b.elb.ap-south-1.amazonaws.com"
HOST="api-dev-jomo.dazzeldigital.com"

echo "❌ WITHOUT Host Header (will fail with 404):"
echo "============================================="
echo "Command: curl -I http://$LB/api"
curl -I http://$LB/api 2>&1 | head -5
echo ""

echo "✅ WITH Host Header (works!):"
echo "============================================="
echo "Command: curl -I -H 'Host: $HOST' http://$LB/api"
curl -I -H "Host: $HOST" http://$LB/api 2>&1 | head -10
echo ""

echo "📋 Explanation:"
echo "==============="
echo "Nginx Ingress requires the Host header to match the ingress rules."
echo ""
echo "Current ingress rules:"
echo "  - Host: api-dev-jomo.dazzeldigital.com"
echo "    Paths: /api, /grafana, /prometheus"
echo ""
echo "When you access via LoadBalancer URL directly, nginx doesn't know"
echo "which ingress rule to use, so it returns 404."
echo ""
echo "Once you update DNS to point api-dev-jomo.dazzeldigital.com to this"
echo "LoadBalancer, browsers will automatically send the correct Host header."
echo ""
echo "🎯 Action Required:"
echo "==================="
echo "Update DNS for: api-dev-jomo.dazzeldigital.com"
echo "Point to: $LB"
echo ""
echo "After DNS update, these will work:"
echo "  - https://api-dev-jomo.dazzeldigital.com/api"
echo "  - https://api-dev-jomo.dazzeldigital.com/grafana/"
echo "  - https://api-dev-jomo.dazzeldigital.com/prometheus/"
