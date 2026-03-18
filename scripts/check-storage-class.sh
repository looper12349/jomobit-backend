#!/bin/bash

echo "🔍 Checking available storage classes in your cluster..."
echo ""

kubectl get storageclass

echo ""
echo "📊 Checking PVC status in monitoring namespaces..."
echo ""

echo "Production:"
kubectl get pvc -n monitoring-prod 2>/dev/null || echo "No monitoring-prod namespace yet"

echo ""
echo "Staging:"
kubectl get pvc -n monitoring-staging 2>/dev/null || echo "No monitoring-staging namespace yet"

echo ""
echo "📋 Checking pod status..."
echo ""

echo "Production pods:"
kubectl get pods -n monitoring-prod 2>/dev/null || echo "No monitoring-prod namespace yet"

echo ""
echo "Staging pods:"
kubectl get pods -n monitoring-staging 2>/dev/null || echo "No monitoring-staging namespace yet"

echo ""
echo "🔍 Describing pending pods (if any)..."
echo ""

# Check staging pods
for pod in $(kubectl get pods -n monitoring-staging -o name 2>/dev/null | grep -v Running); do
    echo "Describing $pod in monitoring-staging:"
    kubectl describe $pod -n monitoring-staging | grep -A 10 "Events:"
    echo ""
done

# Check production pods
for pod in $(kubectl get pods -n monitoring-prod -o name 2>/dev/null | grep -v Running); do
    echo "Describing $pod in monitoring-prod:"
    kubectl describe $pod -n monitoring-prod | grep -A 10 "Events:"
    echo ""
done
