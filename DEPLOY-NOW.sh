#!/bin/bash

echo "🎯 Final Fix - Deploy Monitoring with gp2 Storage Class"
echo ""
echo "Root cause: PVCs didn't specify storage class, and cluster has no default"
echo "Solution: Updated PVCs to use gp2 explicitly"
echo ""

echo "Step 1: Cleaning up failed deployment..."
kubectl delete namespace monitoring-staging --ignore-not-found=true
echo "✅ Cleaned up"
echo ""

echo "Step 2: Waiting for namespace to be fully deleted..."
sleep 5
echo "✅ Ready"
echo ""

echo "Step 3: Commit and push the fix..."
echo "Run these commands:"
echo ""
echo "  git add k8s/monitoring/prometheus-pvc.yaml k8s/monitoring/grafana-pvc.yaml"
echo "  git commit -m 'fix: explicitly set gp2 storage class for PVCs'"
echo "  git push origin feature/scaling"
echo ""
echo "Step 4: Wait 2-3 minutes and verify:"
echo ""
echo "  kubectl get pods -n monitoring-staging"
echo "  kubectl get pvc -n monitoring-staging"
echo ""
echo "Step 5: Access monitoring:"
echo ""
echo "  Grafana:    https://api-dev-jomo.dazzeldigital.com/grafana"
echo "  Prometheus: https://api-dev-jomo.dazzeldigital.com/prometheus"
echo ""
echo "🎉 This will work now!"
