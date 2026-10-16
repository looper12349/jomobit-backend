# 🔧 Troubleshooting URL Access Issues

## Run Diagnostics First

```bash
./scripts/diagnose-ingress-issue.sh
```

Or for a quick check:
```bash
./scripts/quick-check.sh
```

## Common Issues and Fixes

### Issue 1: Ingress Controller Not Installed

**Symptom**: Ingress has no ADDRESS
```bash
kubectl get ingress -n monitoring-staging
# Shows: ADDRESS = <empty>
```

**Check**:
```bash
kubectl get pods -n ingress-nginx
```

**Fix**: Install Nginx Ingress Controller
```bash
kubectl apply -f https://raw.githubusercontent.com/kubernetes/ingress-nginx/controller-v1.8.1/deploy/static/provider/aws/deploy.yaml
```

---

### Issue 2: Wrong Ingress Class

**Symptom**: Ingress exists but not working

**Check**:
```bash
kubectl get ingressclass
kubectl describe ingress monitoring-ingress -n monitoring-staging
```

**Fix**: Update ingress to use correct class
```yaml
# In k8s/monitoring/ingress-staging.yaml
spec:
  ingressClassName: nginx  # Add this line
```

---

### Issue 3: Pods Not Running

**Symptom**: 404 or 502 errors

**Check**:
```bash
kubectl get pods -n monitoring-staging
```

**Fix**: Check pod logs
```bash
kubectl logs -n monitoring-staging -l app=grafana
kubectl logs -n monitoring-staging -l app=prometheus
```

---

### Issue 4: Service Not Found

**Symptom**: 503 Service Unavailable

**Check**:
```bash
kubectl get svc -n monitoring-staging
kubectl get endpoints -n monitoring-staging
```

**Fix**: Verify service selectors match pod labels
```bash
kubectl describe svc grafana -n monitoring-staging
kubectl get pods -n monitoring-staging --show-labels
```

---

### Issue 5: Path Rewriting Not Working

**Symptom**: 404 on /grafana or /prometheus

**Check**: Look at ingress annotations
```bash
kubectl get ingress monitoring-ingress -n monitoring-staging -o yaml
```

**Expected annotations**:
```yaml
annotations:
  nginx.ingress.kubernetes.io/rewrite-target: /$2
```

**Expected paths**:
```yaml
paths:
  - path: /grafana(/|$)(.*)
    pathType: Prefix
```

**Fix**: If annotations are missing, update the ingress file and reapply.

---

### Issue 6: SSL/TLS Certificate Issues

**Symptom**: Certificate errors or HTTPS not working

**Check**:
```bash
kubectl get certificate -n monitoring-staging
kubectl describe certificate -n monitoring-staging
```

**Fix**: If using cert-manager, check if it's installed:
```bash
kubectl get pods -n cert-manager
```

If not using cert-manager, remove TLS section from ingress:
```yaml
# Remove this section from ingress-staging.yaml:
spec:
  tls:
    - hosts:
        - api-dev-jomo.dazzeldigital.com
      secretName: monitoring-staging-tls
```

---

### Issue 7: Grafana Subpath Not Configured

**Symptom**: Grafana loads but CSS/JS broken

**Check**: Grafana environment variables
```bash
kubectl get deployment grafana -n monitoring-staging -o yaml | grep -A 5 "env:"
```

**Expected**:
```yaml
env:
  - name: GF_SERVER_ROOT_URL
    value: "%(protocol)s://%(domain)s/grafana/"
  - name: GF_SERVER_SERVE_FROM_SUB_PATH
    value: "true"
```

**Fix**: If missing, update grafana-deployment.yaml and reapply.

---

## Step-by-Step Diagnosis

### Step 1: Check Pods
```bash
kubectl get pods -n monitoring-staging

# Should show:
# NAME                          READY   STATUS    RESTARTS   AGE
# grafana-xxx                   1/1     Running   0          5m
# prometheus-xxx                1/1     Running   0          5m
```

If not Running, check logs:
```bash
kubectl logs -n monitoring-staging <pod-name>
kubectl describe pod -n monitoring-staging <pod-name>
```

### Step 2: Check Services
```bash
kubectl get svc -n monitoring-staging

# Should show:
# NAME         TYPE        CLUSTER-IP      EXTERNAL-IP   PORT(S)
# grafana      ClusterIP   10.100.x.x      <none>        3000/TCP
# prometheus   ClusterIP   10.100.x.x      <none>        9090/TCP
```

Test service internally:
```bash
kubectl run -it --rm debug --image=curlimages/curl --restart=Never -n monitoring-staging -- \
  curl http://grafana:3000
```

### Step 3: Check Ingress
```bash
kubectl get ingress -n monitoring-staging

# Should show ADDRESS (LoadBalancer hostname)
# NAME                 HOSTS                            ADDRESS
# monitoring-ingress   api-dev-jomo.dazzeldigital.com   a1b2c3...elb.amazonaws.com
```

If ADDRESS is empty, ingress controller might not be installed.

### Step 4: Check Ingress Rules
```bash
kubectl describe ingress monitoring-ingress -n monitoring-staging
```

Look for:
- Correct host: `api-dev-jomo.dazzeldigital.com`
- Correct paths: `/grafana(/|$)(.*)` and `/prometheus(/|$)(.*)`
- Backend services: `grafana:3000` and `prometheus:9090`

### Step 5: Test Connectivity
```bash
# Test app (should work)
curl -I https://api-dev-jomo.dazzeldigital.com/api

# Test Grafana
curl -I https://api-dev-jomo.dazzeldigital.com/grafana

# Test Prometheus
curl -I https://api-dev-jomo.dazzeldigital.com/prometheus
```

Expected responses:
- 200 OK
- 302 Redirect (to login)
- 401 Unauthorized

NOT expected:
- 404 Not Found → Path routing issue
- 502 Bad Gateway → Backend not ready
- 503 Service Unavailable → Service not found
- Connection refused → Ingress controller issue

---

## Quick Fixes

### Fix 1: Restart Pods
```bash
kubectl rollout restart deployment/grafana -n monitoring-staging
kubectl rollout restart deployment/prometheus -n monitoring-staging
```

### Fix 2: Recreate Ingress
```bash
kubectl delete ingress monitoring-ingress -n monitoring-staging
kubectl apply -f k8s/monitoring/ingress-staging.yaml
```

### Fix 3: Check Ingress Controller Logs
```bash
kubectl logs -n ingress-nginx -l app.kubernetes.io/name=ingress-nginx
```

### Fix 4: Port Forward (Bypass Ingress)
```bash
# Test Grafana directly
kubectl port-forward -n monitoring-staging svc/grafana 3000:3000
# Then open: http://localhost:3000

# Test Prometheus directly
kubectl port-forward -n monitoring-staging svc/prometheus 9090:9090
# Then open: http://localhost:9090
```

If port-forward works but URL doesn't, it's an ingress issue.

---

## Most Likely Issues

Based on your setup, the most likely issues are:

1. **Ingress Controller Not Installed** (most common)
   - Check: `kubectl get pods -n ingress-nginx`
   - Fix: Install nginx ingress controller

2. **Wrong Ingress Class**
   - Check: `kubectl get ingressclass`
   - Fix: Add `ingressClassName: nginx` to ingress spec

3. **Path Rewriting Not Working**
   - Check: Ingress annotations
   - Fix: Ensure `nginx.ingress.kubernetes.io/rewrite-target: /$2` is set

4. **Pods Not Ready**
   - Check: `kubectl get pods -n monitoring-staging`
   - Fix: Check logs and fix pod issues first

---

## Get Help

Run the diagnostic script and share the output:
```bash
./scripts/diagnose-ingress-issue.sh > diagnosis.txt
cat diagnosis.txt
```

This will show exactly what's wrong!
