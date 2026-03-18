#!/bin/bash

echo "🧪 Testing Monitoring on New LoadBalancer..."
echo ""

# Get the LoadBalancer hostname
LB=$(kubectl get ingress monitoring-ingress -n monitoring-staging -o jsonpath='{.status.loadBalancer.ingress[0].hostname}')

if [ -z "$LB" ]; then
    echo "❌ Could not get LoadBalancer hostname"
    echo "Run: kubectl get ingress monitoring-ingress -n monitoring-staging"
    exit 1
fi

echo "LoadBalancer: $LB"
echo ""

echo "Testing Grafana..."
echo "URL: http://$LB/grafana"
curl -I "http://$LB/grafana" 2>&1 | head -10
echo ""

echo "Testing Prometheus..."
echo "URL: http://$LB/prometheus"
curl -I "http://$LB/prometheus" 2>&1 | head -10
echo ""

echo "📋 Summary:"
echo "==========="
echo ""
echo "If you see HTTP 200 or 302 above, monitoring is working!"
echo ""
echo "Next steps:"
echo "1. Update DNS for api-dev-jomo.dazzeldigital.com"
echo "2. Point it to: $LB"
echo "3. Wait 5-10 minutes for DNS propagation"
echo "4. Access: https://api-dev-jomo.dazzeldigital.com/grafana"
echo ""
echo "Or test now with:"
echo "  curl -I http://$LB/grafana"
echo "  curl -I http://$LB/prometheus"
