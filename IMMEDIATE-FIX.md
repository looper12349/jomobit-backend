# ⚡ Immediate Fix - Get Monitoring Working Now

## The Problem

Your pods are stuck in "Pending" because of persistent storage issues. This needs cluster-level investigation.

## Quick Solution: Deploy Without Persistent Storage

I've created a version that uses `emptyDir` instead of PVCs. This will get your monitoring working immediately.

**Trade-off**: Data will be lost when pods restart, but you can access and test the monitoring stack right now.

## Steps to Fix

### Option 1: Manual Deployment (Recommended)

```bash
# 1. First, run diagnostics to see what's wrong
./scripts/diagnose-pending-pods.sh

# 2. Clean up the failed deployment
kubectl delete namespace monitoring-staging

# 3. Deploy without PVC
./scripts/deploy-monitoring-no-pvc.sh staging
```

### Option 2: Update CI/CD to Use No-PVC Version

Update `.github/workflows/cicd.yml` to use the no-PVC deployment files:

Change these lines in the "Deploy Prometheus" step:
```yaml
# FROM:
for file in k8s/monitoring/prometheus-*.yaml; do

# TO:
for file in k8s/monitoring/prometheus-alerts.yaml k8s/monitoring/prometheus-deployment-no-pvc.yaml; do
```

Change these lines in the "Deploy Grafana" step:
```yaml
# FROM:
for file in k8s/monitoring/grafana-*.yaml; do

# TO:
for file in k8s/monitoring/grafana-datasource.yaml k8s/monitoring/grafana-deployment-no-pvc.yaml; do
```

Then push:
```bash
git add .
git commit -m "fix: use emptyDir for monitoring storage"
git push origin feature/scaling
```

## What's Different

### With PVC (Original - Not Working)
- Uses AWS EBS volumes
- Data persists across pod restarts
- Requires storage class configuration
- **Currently failing to provision**

### With emptyDir (Quick Fix - Works)
- Uses node's local storage
- Data lost on pod restart
- No storage class needed
- **Works immediately**

## Access Your Monitoring

Once deployed:
- Grafana: https://api-dev-jomo.dazzeldigital.com/grafana
- Prometheus: https://api-dev-jomo.dazzeldigital.com/prometheus

Login: admin / <your-password>

## Root Cause Investigation

Run the diagnostic script to find the real issue:

```bash
./scripts/diagnose-pending-pods.sh
```

Look for:
1. **Storage class issues**: "no persistent volumes available"
2. **Resource issues**: "Insufficient cpu" or "Insufficient memory"
3. **Node issues**: "0/X nodes are available"

## Permanent Fix (After Investigation)

Once you identify the issue:

### If Storage Class is Wrong:
```bash
# Check available storage classes
kubectl get storageclass

# Update PVC files to use the correct one
# Edit k8s/monitoring/prometheus-pvc.yaml
# Edit k8s/monitoring/grafana-pvc.yaml
```

### If No Storage Class Exists:
```bash
# Create a storage class or use the cluster default
kubectl get storageclass
kubectl patch storageclass <name> -p '{"metadata": {"annotations":{"storageclass.kubernetes.io/is-default-class":"true"}}}'
```

### If Resource Limits Too High:
Reduce the resource requests in the deployment files.

## Summary

**Right now**: Use the no-PVC version to get monitoring working
```bash
kubectl delete namespace monitoring-staging
./scripts/deploy-monitoring-no-pvc.sh staging
```

**Later**: Investigate and fix the storage issue for persistent data
```bash
./scripts/diagnose-pending-pods.sh
```

Your monitoring will be accessible immediately with the no-PVC version! 🚀
