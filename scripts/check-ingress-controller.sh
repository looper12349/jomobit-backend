#!/bin/bash

echo "🔍 Checking Ingress Controller Configuration..."
echo ""

echo "1️⃣ Ingress Controller Pods:"
kubectl get pods -n ingress-nginx
echo ""

echo "2️⃣ Ingress Controller Service:"
kubectl get svc -n ingress-nginx
echo ""

echo "3️⃣ Ingress Controller Logs (last 30 lines):"
kubectl logs -n ingress-nginx -l app.kubernetes.io/name=ingress-nginx --tail=30
echo ""

echo "4️⃣ Ingress Class:"
kubectl get ingressclass
echo ""

echo "5️⃣ Monitoring Ingress Details:"
kubectl get ingress monitoring-ingress -n monitoring-staging -o yaml
echo ""

echo "6️⃣ Check if ingress is using the right class:"
kubectl get ingress monitoring-ingress -n monitoring-staging -o jsonpath='{.spec.ingressClassName}'
echo ""
echo ""

echo "7️⃣ Check ingress annotations:"
kubectl get ingress monitoring-ingress -n monitoring-staging -o jsonpath='{.metadata.annotations}'
echo ""
echo ""
