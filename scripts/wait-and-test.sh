#!/bin/bash

echo "⏳ Waiting for Ingress Controller and LoadBalancer..."
echo ""

echo "Step 1: Checking ingress controller pods..."
kubectl get pods -n ingress-nginx

echo ""
echo "Step 2: Checking ingress controller service..."
kubectl get svc ingress-nginx-controller -n ingress-nginx

echo ""
echo "Waiting 2 minutes for everything to be ready..."
for i in {120..1}; do
    echo -ne "Time remaining: $i seconds\r"
    sleep 1
done
echo ""

echo ""
echo "Step 3: Checking ingress controller again..."
kubectl get pods -n ingress-nginx
kubectl get svc ingress-nginx-controller -n ingress-nginx

echo ""
echo "Step 4: Checking monitoring ingress..."
kubectl get ingress -n monitoring-staging

echo ""
echo "Step 5: Getting LoadBalancer address..."
LB=$(kubectl get ingress monitoring-ingress -n monitoring-staging -o jsonpath='{.status.loadBalancer.ingress[0].hostname}')

if [ -z "$LB" ]; then
    echo "⚠️  LoadBalancer address still not assigned"
    echo ""
    echo "Try these:"
    echo "1. Wait another 2-3 minutes"
    echo "2. Run: kubectl describe ingress monitoring-ingress -n monitoring-staging"
    echo "3. Run: kubectl logs -n ingress-nginx -l app.kubernetes.io/name=ingress-nginx --tail=50"
    exit 1
fi

echo "✅ LoadBalancer: $LB"
echo ""

echo "Step 6: Testing Grafana..."
curl -I "http://$LB/grafana" 2>&1 | head -10

echo ""
echo "Step 7: Testing Prometheus..."
curl -I "http://$LB/prometheus" 2>&1 | head -10

echo ""
echo "✅ Done! Check the HTTP responses above."
echo ""
echo "Expected:"
echo "  - Grafana: HTTP/1.1 302 Found (redirect to login)"
echo "  - Prometheus: HTTP/1.1 200 OK"
