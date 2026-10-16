#!/bin/bash

echo "🔍 Diagnosing Pending Pods Issue..."
echo ""

NS="monitoring-staging"

echo "1️⃣ Checking Storage Classes:"
echo "================================"
kubectl get storageclass
echo ""

echo "2️⃣ Checking PVC Status:"
echo "================================"
kubectl get pvc -n $NS
echo ""

echo "3️⃣ Describing PVCs:"
echo "================================"
echo "Prometheus PVC:"
kubectl describe pvc prometheus-pvc -n $NS | grep -A 20 "Events:"
echo ""
echo "Grafana PVC:"
kubectl describe pvc grafana-pvc -n $NS | grep -A 20 "Events:"
echo ""

echo "4️⃣ Checking Pod Status:"
echo "================================"
kubectl get pods -n $NS -o wide
echo ""

echo "5️⃣ Describing Pending Pods:"
echo "================================"
for pod in $(kubectl get pods -n $NS -o name); do
    echo "Describing $pod:"
    kubectl describe $pod -n $NS | grep -A 30 "Events:"
    echo ""
done

echo "6️⃣ Checking Node Resources:"
echo "================================"
kubectl top nodes 2>/dev/null || echo "Metrics server not available"
kubectl describe nodes | grep -A 5 "Allocated resources:"
echo ""

echo "7️⃣ Checking for Resource Quotas:"
echo "================================"
kubectl get resourcequota -n $NS
echo ""

echo "8️⃣ Recommended Actions:"
echo "================================"
echo "Based on the output above:"
echo ""
echo "If PVCs are Pending:"
echo "  - Check if storage class exists and is available"
echo "  - Try: kubectl get storageclass"
echo "  - Solution: Update PVC files to use correct storage class"
echo ""
echo "If 'Insufficient CPU/Memory':"
echo "  - Reduce resource requests in deployment files"
echo "  - Or scale up your cluster nodes"
echo ""
echo "If 'No nodes available':"
echo "  - Check node status: kubectl get nodes"
echo "  - Check node taints: kubectl describe nodes | grep Taints"
echo ""
