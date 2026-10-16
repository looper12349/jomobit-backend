#!/bin/bash

echo "🔍 Debugging Ingress Issue..."
echo ""

echo "1️⃣ Check Ingress Controller Pods:"
kubectl get pods -n ingress-nginx
echo ""

echo "2️⃣ Check Ingress Controller Service:"
kubectl get svc -n ingress-nginx
echo ""

echo "3️⃣ Check Ingress Status:"
kubectl get ingress -n monitoring-staging
echo ""

echo "4️⃣ Describe Ingress:"
kubectl describe ingress monitoring-ingress -n monitoring-staging
echo ""

echo "5️⃣ Check Ingress Class:"
kubectl get ingressclass
echo ""

echo "6️⃣ Ingress Controller Logs (last 50 lines):"
kubectl logs -n ingress-nginx -l app.kubernetes.io/name=ingress-nginx --tail=50
echo ""

echo "7️⃣ Check if ingress has ingressClassName set:"
kubectl get ingress monitoring-ingress -n monitoring-staging -o yaml | grep -A 5 "spec:"
echo ""
