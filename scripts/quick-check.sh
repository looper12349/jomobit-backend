#!/bin/bash

NS="monitoring-staging"

echo "🚀 Quick Status Check"
echo ""

echo "Pods:"
kubectl get pods -n $NS 2>/dev/null || echo "Namespace not found"
echo ""

echo "Services:"
kubectl get svc -n $NS 2>/dev/null
echo ""

echo "Ingress:"
kubectl get ingress -n $NS 2>/dev/null
echo ""

echo "Ingress Details:"
kubectl get ingress monitoring-ingress -n $NS -o yaml 2>/dev/null | grep -A 20 "spec:"
echo ""

echo "Test URLs:"
echo "curl -I https://api-dev-jomo.dazzeldigital.com/grafana"
curl -I https://api-dev-jomo.dazzeldigital.com/grafana 2>&1 | head -5
echo ""
echo "curl -I https://api-dev-jomo.dazzeldigital.com/prometheus"
curl -I https://api-dev-jomo.dazzeldigital.com/prometheus 2>&1 | head -5
