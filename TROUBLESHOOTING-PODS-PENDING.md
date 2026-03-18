# 🔧 Troubleshooting: Pods Stuck in Pending State

## Issue

Your monitoring pods are stuck in "Pending" status:
```
prometheus-69b6bb445b-h4cxv   0/1     Pending
grafana-fd754b9f5-bdtkv       0/1     Pending
```

## Root Cause

This is typically caused by:
1. **Storage Class Issue**: The PVCs are requesting `gp2` storage class which might not exist in your cluster
2. **No Default Storage Class**: Your cluster doesn't have a default storage class configured
3. **Insufficient Resources**: Not enough CPU/memory (less likely)

## Quick Fix

### Step 1: Check Available Storage Classes

```bash
kubectl get storageclass
```

Look for the output. You should see something like:
```
NAME            PROVISIONER             RECLAIMPOLICY   VOLUMEBINDINGMODE
gp2 (default)   kubernetes.io/aws-ebs   Delete          WaitForFirstConsumer
gp3             kubernetes.io/aws-ebs   Delete          WaitForFirstConsumer
```

### Step 2: Fix Based on What You See

#### Option A: You have `gp2` storage class
If you see `gp2` in the list, the PVCs should work. The issue might be temporary. Try:

```bash
# Delete and recreate the monitoring namespace
./scripts/fix-monitoring-storage.sh staging

# Then push to redeploy
git push origin feature/scaling
```

#### Option B: You have `gp3` or another storage class
Update the PVC files to use the correct storage class:

```bash
# Edit both PVC files
# k8s/monitoring/prometheus-pvc.yaml
# k8s/monitoring/grafana-pvc.yaml

# Uncomment and set the correct storage class:
storageClassName: gp3  # or whatever you have
```

Then commit and push:
```bash
git add k8s/monitoring/*-pvc.yaml
git commit -m "fix: update storage class for monitoring PVCs"
git push origin feature/scaling
```

#### Option C: Use Default Storage Class (Recommended)
The PVC files are already configured to use the default storage class. If you have a default storage class, just clean up and redeploy:

```bash
# Clean up the failed deployment
./scripts/fix-monitoring-storage.sh staging

# Push to redeploy
git push origin feature/scaling
```

### Step 3: Verify the Fix

After redeploying, check the status:

```bash
# Check PVCs
kubectl get pvc -n monitoring-staging

# Should show "Bound" status:
# NAME              STATUS   VOLUME                                     CAPACITY
# prometheus-pvc    Bound    pvc-abc123...                              10Gi
# grafana-pvc       Bound    pvc-def456...                              5Gi

# Check pods
kubectl get pods -n monitoring-staging

# Should show "Running" status:
# NAME                          READY   STATUS    RESTARTS   AGE
# prometheus-69b6bb445b-h4cxv   1/1     Running   0          2m
# grafana-fd754b9f5-bdtkv       1/1     Running   0          2m
```

## Detailed Diagnosis

### Check Why Pods Are Pending

```bash
# Describe the pods to see events
kubectl describe pod -n monitoring-staging -l app=prometheus
kubectl describe pod -n monitoring-staging -l app=grafana

# Look for messages like:
# - "pod has unbound immediate PersistentVolumeClaims"
# - "0/2 nodes are available: 2 pod has unbound immediate PersistentVolumeClaims"
```

### Check PVC Status

```bash
kubectl get pvc -n monitoring-staging

# If status is "Pending", describe it:
kubectl describe pvc prometheus-pvc -n monitoring-staging
kubectl describe pvc grafana-pvc -n monitoring-staging

# Look for error messages in Events section
```

### Check Storage Class

```bash
# List all storage classes
kubectl get storageclass

# Check if there's a default
kubectl get storageclass -o jsonpath='{.items[?(@.metadata.annotations.storageclass\.kubernetes\.io/is-default-class=="true")].metadata.name}'
```

## Alternative: Use EmptyDir (Not Recommended for Production)

If you just want to test and don't care about data persistence, you can use emptyDir instead of PVCs:

### For Prometheus

Edit `k8s/monitoring/prometheus-deployment.yaml`:

```yaml
volumes:
  - name: storage
    emptyDir: {}  # Replace persistentVolumeClaim section
```

### For Grafana

Edit `k8s/monitoring/grafana-deployment.yaml`:

```yaml
volumes:
  - name: storage
    emptyDir: {}  # Replace persistentVolumeClaim section
```

**Warning**: Data will be lost when pods restart!

## Manual Cleanup Commands

If the scripts don't work, manually clean up:

```bash
# Delete monitoring namespace
kubectl delete namespace monitoring-staging

# Wait for it to be fully deleted
kubectl get namespace monitoring-staging

# Should show: Error from server (NotFound)

# Then redeploy by pushing your code
git push origin feature/scaling
```

## Prevention

To avoid this in the future:

1. **Check storage class before deploying**:
   ```bash
   kubectl get storageclass
   ```

2. **Set a default storage class** if you don't have one:
   ```bash
   kubectl patch storageclass gp3 -p '{"metadata": {"annotations":{"storageclass.kubernetes.io/is-default-class":"true"}}}'
   ```

3. **Use the default storage class** in PVCs (already configured in the updated files)

## Quick Commands Reference

```bash
# Check storage classes
kubectl get storageclass

# Check PVCs
kubectl get pvc -n monitoring-staging

# Check pods
kubectl get pods -n monitoring-staging

# Describe pending pod
kubectl describe pod <pod-name> -n monitoring-staging

# Clean up and redeploy
./scripts/fix-monitoring-storage.sh staging
git push origin feature/scaling

# Check deployment progress
kubectl get pods -n monitoring-staging -w
```

## Still Having Issues?

1. Check cluster resources:
   ```bash
   kubectl top nodes
   kubectl describe nodes
   ```

2. Check for resource quotas:
   ```bash
   kubectl get resourcequota -n monitoring-staging
   ```

3. Check events:
   ```bash
   kubectl get events -n monitoring-staging --sort-by='.lastTimestamp'
   ```

## Summary

The most common fix is:
1. Run: `./scripts/fix-monitoring-storage.sh staging`
2. Push: `git push origin feature/scaling`
3. Wait 2-3 minutes for pods to start
4. Verify: `kubectl get pods -n monitoring-staging`

If pods are still pending, check the storage class and update the PVC files accordingly.
