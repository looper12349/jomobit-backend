# 🚨 Can't Access Monitoring URLs? Run This Now!

## Quick Diagnosis

Run this command and share the output:

```bash
./scripts/diagnose-ingress-issue.sh
```

This will check:
- ✅ Are pods running?
- ✅ Are services created?
- ✅ Is ingress configured?
- ✅ Is ingress controller installed?
- ✅ Can services be reached?
- ✅ What errors are in logs?

## Most Likely Issues

### 1. Ingress Controller Not Installed ⚠️

**Check**:
```bash
kubectl get pods -n ingress-nginx
```

If you see "No resources found" or "namespace not found", you need to install it.

**Fix**:
```bash
kubectl apply -f https://raw.githubusercontent.com/kubernetes/ingress-nginx/controller-v1.8.1/deploy/static/provider/aws/deploy.yaml
```

Wait 2-3 minutes, then check:
```bash
kubectl get svc -n ingress-nginx
```

### 2. Pods Not Running

**Check**:
```bash
kubectl get pods -n monitoring-staging
```

If STATUS is not "Running", check logs:
```bash
kubectl logs -n monitoring-staging -l app=grafana
kubectl logs -n monitoring-staging -l app=prometheus
```

### 3. Wrong Ingress Class

**Check**:
```bash
kubectl get ingressclass
kubectl describe ingress monitoring-ingress -n monitoring-staging | grep -i class
```

**Fix**: Update ingress file to use correct class.

## Quick Test

Test if services work internally (bypass ingress):

```bash
# Port-forward Grafana
kubectl port-forward -n monitoring-staging svc/grafana 3000:3000
# Open: http://localhost:3000

# Port-forward Prometheus  
kubectl port-forward -n monitoring-staging svc/prometheus 9090:9090
# Open: http://localhost:9090
```

If this works, the issue is with ingress, not the pods.

## What to Share

Run these commands and share the output:

```bash
# 1. Pod status
kubectl get pods -n monitoring-staging

# 2. Service status
kubectl get svc -n monitoring-staging

# 3. Ingress status
kubectl get ingress -n monitoring-staging

# 4. Ingress details
kubectl describe ingress monitoring-ingress -n monitoring-staging

# 5. Ingress controller
kubectl get pods -n ingress-nginx

# 6. Test URL
curl -I https://api-dev-jomo.dazzeldigital.com/grafana
```

## Expected vs Actual

### Expected (Working):
```
Pods: Running
Services: ClusterIP with endpoints
Ingress: Has ADDRESS field populated
Ingress Controller: Pods running in ingress-nginx namespace
curl: Returns 200 or 302
```

### If Not Working:
- Pods Pending → Storage issue (already fixed)
- Pods CrashLoopBackOff → Check logs
- Ingress no ADDRESS → Ingress controller not installed
- curl 404 → Path routing issue
- curl 502/503 → Backend not ready

## Full Diagnostic

For complete diagnosis:
```bash
./scripts/diagnose-ingress-issue.sh > diagnosis.txt
cat diagnosis.txt
```

Share the `diagnosis.txt` output to identify the exact issue.

---

**TL;DR**: Run `./scripts/diagnose-ingress-issue.sh` and share the output!
