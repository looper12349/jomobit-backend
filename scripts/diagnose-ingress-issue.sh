#!/bin/bash

echo "🔍 Diagnosing Ingress/URL Access Issue..."
echo ""

NS="monitoring-staging"
DOMAIN="api-dev-jomo.dazzeldigital.com"

echo "1️⃣ Checking if pods are running:"
echo "================================"
kubectl get pods -n $NS
echo ""

echo "2️⃣ Checking services:"
echo "================================"
kubectl get svc -n $NS
echo ""

echo "3️⃣ Checking ingress:"
echo "================================"
kubectl get ingress -n $NS
echo ""

echo "4️⃣ Describing ingress (detailed):"
echo "================================"
kubectl describe ingress monitoring-ingress -n $NS
echo ""

echo "5️⃣ Checking if Nginx Ingress Controller exists:"
echo "================================"
kubectl get pods -n ingress-nginx 2>/dev/null || echo "⚠️  No ingress-nginx namespace found"
kubectl get svc -n ingress-nginx 2>/dev/null || echo "⚠️  No ingress-nginx services found"
echo ""

echo "6️⃣ Checking ingress class:"
echo "================================"
kubectl get ingressclass
echo ""

echo "7️⃣ Testing service connectivity (from within cluster):"
echo "================================"
echo "Testing Grafana service..."
kubectl run -it --rm debug-grafana --image=curlimages/curl --restart=Never -n $NS -- \
  curl -I http://grafana:3000 2>/dev/null || echo "⚠️  Could not test Grafana service"
echo ""

echo "Testing Prometheus service..."
kubectl run -it --rm debug-prometheus --image=curlimages/curl --restart=Never -n $NS -- \
  curl -I http://prometheus:9090 2>/dev/null || echo "⚠️  Could not test Prometheus service"
echo ""

echo "8️⃣ Checking pod logs for errors:"
echo "================================"
echo "Grafana logs (last 20 lines):"
kubectl logs -n $NS -l app=grafana --tail=20 2>/dev/null || echo "⚠️  No Grafana logs"
echo ""
echo "Prometheus logs (last 20 lines):"
kubectl logs -n $NS -l app=prometheus --tail=20 2>/dev/null || echo "⚠️  No Prometheus logs"
echo ""

echo "9️⃣ Checking if app ingress works (for comparison):"
echo "================================"
kubectl get ingress -A | grep -E "NAME|jomo-backend"
echo ""

echo "🔟 DNS and connectivity test:"
echo "================================"
echo "Testing DNS resolution for $DOMAIN:"
nslookup $DOMAIN 2>/dev/null || echo "⚠️  DNS lookup failed"
echo ""
echo "Testing HTTPS connectivity:"
curl -I https://$DOMAIN/api 2>/dev/null || echo "⚠️  Could not connect to app"
echo ""
echo "Testing Grafana path:"
curl -I https://$DOMAIN/grafana 2>/dev/null || echo "⚠️  Could not connect to Grafana"
echo ""

echo "📋 Summary of Findings:"
echo "================================"
echo ""
echo "Check the output above for:"
echo ""
echo "❌ If pods are NOT Running:"
echo "   → Check pod logs and events"
echo "   → Run: kubectl describe pod -n $NS <pod-name>"
echo ""
echo "❌ If ingress has no ADDRESS:"
echo "   → Ingress controller might not be installed"
echo "   → Check: kubectl get pods -n ingress-nginx"
echo ""
echo "❌ If ingress class is wrong:"
echo "   → Update ingress to use correct ingressClassName"
echo "   → Check available classes: kubectl get ingressclass"
echo ""
echo "❌ If services are not accessible:"
echo "   → Check service endpoints: kubectl get endpoints -n $NS"
echo "   → Check pod labels match service selectors"
echo ""
echo "❌ If curl to /grafana returns 404:"
echo "   → Ingress path routing might be wrong"
echo "   → Check ingress rules and rewrite annotations"
echo ""
echo "❌ If curl to /grafana returns 502/503:"
echo "   → Backend pods might not be ready"
echo "   → Check pod status and logs"
echo ""
