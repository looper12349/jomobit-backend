#!/bin/bash

echo "⚡ Applying Ingress Fix..."
echo ""

echo "1️⃣ Deleting old ingress..."
kubectl delete ingress monitoring-ingress -n monitoring-staging

echo ""
echo "2️⃣ Applying fixed ingress..."
kubectl apply -f k8s/monitoring/ingress-staging.yaml

echo ""
echo "3️⃣ Waiting for ingress to be ready..."
sleep 10

echo ""
echo "4️⃣ Getting LoadBalancer address..."
LB=$(kubectl get ingress monitoring-ingress -n monitoring-staging -o jsonpath='{.status.loadBalancer.ingress[0].hostname}')
echo "LoadBalancer: $LB"

echo ""
echo "5️⃣ Testing Grafana..."
echo "URL: http://$LB/grafana"
curl -I "http://$LB/grafana" 2>&1 | head -15

echo ""
echo "6️⃣ Testing Prometheus..."
echo "URL: http://$LB/prometheus"
curl -I "http://$LB/prometheus" 2>&1 | head -15

echo ""
echo "📋 Summary:"
echo "==========="
echo ""
echo "Look for:"
echo "  - HTTP/1.1 302 Found (Grafana redirect to login) ✅"
echo "  - HTTP/1.1 200 OK (Prometheus) ✅"
echo ""
echo "If you see 404, check ingress controller logs:"
echo "  kubectl logs -n ingress-nginx -l app.kubernetes.io/name=ingress-nginx --tail=50"
