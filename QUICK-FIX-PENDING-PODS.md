# ⚡ Quick Fix: Pending Pods Issue

## Problem
Monitoring pods are stuck in "Pending" state due to storage class issues.

## Quick Fix (3 Steps)

### Step 1: Check Your Storage Class
```bash
kubectl get storageclass
```

### Step 2: Clean Up Failed Deployment
```bash
./scripts/fix-monitoring-storage.sh staging
```

### Step 3: Redeploy
```bash
git add .
git commit -m "fix: update storage class configuration"
git push origin feature/scaling
```

## What Changed

I've updated the PVC files to use the **default storage class** instead of hardcoding `gp2`:

- `k8s/monitoring/prometheus-pvc.yaml` ✅
- `k8s/monitoring/grafana-pvc.yaml` ✅

This should work with any Kubernetes cluster regardless of the storage class name.

## Verify It Works

After pushing, wait 2-3 minutes and check:

```bash
# Check pods are running
kubectl get pods -n monitoring-staging

# Should show:
# NAME                          READY   STATUS    RESTARTS   AGE
# prometheus-xxx                1/1     Running   0          2m
# grafana-xxx                   1/1     Running   0          2m
```

## If Still Pending

Check what storage classes you have:
```bash
kubectl get storageclass
```

If you see `gp3` or another name, update the PVC files:

```yaml
# In k8s/monitoring/prometheus-pvc.yaml and grafana-pvc.yaml
# Uncomment and set:
storageClassName: gp3  # or whatever you have
```

Then commit and push again.

## Access Monitoring

Once pods are running:
- Grafana: https://api-dev-jomo.dazzeldigital.com/grafana
- Prometheus: https://api-dev-jomo.dazzeldigital.com/prometheus

Login: admin / <your GRAFANA_ADMIN_PASSWORD>

---

**TL;DR**: Run the cleanup script, then push your code. The updated PVCs will use the default storage class.
