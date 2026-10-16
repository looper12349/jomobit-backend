# 🔧 Fix 404 Issue - Ingress Not Routing to Monitoring

## Problem Identified

Your diagnostic shows:
1. ✅ Pods are running
2. ✅ Services exist
3. ✅ Ingress controller installed
4. ❌ **Grafana returns 404**

The issue: Your DNS `api-dev-jomo.dazzeldigital.com` points to an OLD LoadBalancer, but the monitoring ingress created a NEW LoadBalancer.

## Root Cause

```
DNS points to: aa42c7b292285409ba2d300cdb12a265-2030774719.ap-south-1.elb.amazonaws.com
Monitoring LB:  ac0313d2e870f42a9a775e60144d1f3a-799e9ec9e60eab7b.elb.ap-south-1.amazonaws.com
                ^^^^^^^^ DIFFERENT!
```

## Solution Options

### Option 1: Update DNS (Quick Fix)

Update your DNS record for `api-dev-jomo.dazzeldigital.com` to point to the NEW LoadBalancer:

```bash
# Get the new LoadBalancer hostname
kubectl get svc ingress-nginx-controller -n ingress-nginx

# Output will show:
# EXTERNAL-IP: ac0313d2e870f42a9a775e60144d1f3a-799e9ec9e60eab7b.elb.ap-south-1.amazonaws.com
```

Then update your DNS:
- Type: CNAME
- Name: api-dev-jomo
- Value: `ac0313d2e870f42a9a775e60144d1f3a-799e9ec9e60eab7b.elb.ap-south-1.amazonaws.com`

Wait 5-10 minutes for DNS propagation, then test:
```bash
curl -I https://api-dev-jomo.dazzeldigital.com/grafana
```

### Option 2: Use the New LoadBalancer Directly (Test Now)

Test immediately without waiting for DNS:

```bash
# Get the LoadBalancer hostname
LB=$(kubectl get ingress monitoring-ingress -n monitoring-staging -o jsonpath='{.status.loadBalancer.ingress[0].hostname}')

# Test Grafana
curl -I http://$LB/grafana

# Test Prometheus
curl -I http://$LB/prometheus
```

If this works, you just need to update DNS!

### Option 3: Add App Ingress to New Controller

Create an ingress for your app on the new ingress controller:

```bash
# Create staging app ingress
cat <<EOF | kubectl apply -f -
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: jomo-backend-staging-ingress
  namespace: staging
  annotations:
    kubernetes.io/ingress.class: "nginx"
    nginx.ingress.kubernetes.io/limit-rps: "50"
spec:
  rules:
  - host: api-dev-jomo.dazzeldigital.com
    http:
      paths:
      - path: /api
        pathType: Prefix
        backend:
          service:
            name: jomo-backend-service
            port:
              number: 80
EOF
```

Then update DNS to point to the new LoadBalancer.

## Recommended Approach

**Do this now:**

1. **Test with LoadBalancer directly** (no DNS change needed):
   ```bash
   LB=$(kubectl get ingress monitoring-ingress -n monitoring-staging -o jsonpath='{.status.loadBalancer.ingress[0].hostname}')
   echo "Test these URLs:"
   echo "http://$LB/grafana"
   echo "http://$LB/prometheus"
   
   curl -I http://$LB/grafana
   ```

2. **If that works**, update your DNS to point to the new LoadBalancer

3. **Wait 5-10 minutes** for DNS propagation

4. **Test the final URLs**:
   ```bash
   curl -I https://api-dev-jomo.dazzeldigital.com/grafana
   curl -I https://api-dev-jomo.dazzeldigital.com/prometheus
   ```

## Port-Forward Fix

To test Grafana via port-forward, access it at the subpath:

```bash
kubectl port-forward -n monitoring-staging svc/grafana 3000:3000
```

Then open: **http://localhost:3000/grafana** (not just localhost:3000)

Or temporarily disable subpath:
```bash
kubectl set env deployment/grafana -n monitoring-staging \
  GF_SERVER_ROOT_URL="http://localhost:3000/" \
  GF_SERVER_SERVE_FROM_SUB_PATH="false"
```

Then access: http://localhost:3000

## Verify Everything

After DNS update:

```bash
# Check DNS resolves to new LB
nslookup api-dev-jomo.dazzeldigital.com

# Test URLs
curl -I https://api-dev-jomo.dazzeldigital.com/grafana
curl -I https://api-dev-jomo.dazzeldigital.com/prometheus

# Should return 200 or 302 (redirect to login)
```

## Summary

**The issue**: DNS points to old LoadBalancer, monitoring is on new LoadBalancer

**Quick test**: Use LoadBalancer hostname directly
```bash
LB=$(kubectl get ingress monitoring-ingress -n monitoring-staging -o jsonpath='{.status.loadBalancer.ingress[0].hostname}')
curl -I http://$LB/grafana
```

**Permanent fix**: Update DNS to point to new LoadBalancer

**ETA**: 5-10 minutes after DNS update
