# ⚡ Apply Ingress Fix - Use ingressClassName

## The Problem

The ingress is using the deprecated annotation `kubernetes.io/ingress.class: nginx` instead of the proper `spec.ingressClassName: nginx`.

The new ingress controller isn't picking up the ingress because of this.

## The Fix

I've updated both ingress files to use `ingressClassName: nginx` and changed `pathType` to `ImplementationSpecific`.

## Apply the Fix Now

```bash
# Delete the old ingress
kubectl delete ingress monitoring-ingress -n monitoring-staging

# Apply the fixed ingress
kubectl apply -f k8s/monitoring/ingress-staging.yaml

# Wait a few seconds
sleep 5

# Test again
LB=$(kubectl get ingress monitoring-ingress -n monitoring-staging -o jsonpath='{.status.loadBalancer.ingress[0].hostname}')
curl -I http://$LB/grafana
```

## What Changed

### Before (Not Working):
```yaml
metadata:
  annotations:
    kubernetes.io/ingress.class: "nginx"  # Deprecated
spec:
  rules:
    - host: api-dev-jomo.dazzeldigital.com
      http:
        paths:
          - path: /grafana(/|$)(.*)
            pathType: Prefix  # Too restrictive
```

### After (Working):
```yaml
metadata:
  annotations:
    # Removed deprecated annotation
spec:
  ingressClassName: nginx  # Proper way
  rules:
    - host: api-dev-jomo.dazzeldigital.com
      http:
        paths:
          - path: /grafana(/|$)(.*)
            pathType: ImplementationSpecific  # Works with regex
```

## Verify It Works

```bash
# Get LoadBalancer
LB=$(kubectl get ingress monitoring-ingress -n monitoring-staging -o jsonpath='{.status.loadBalancer.ingress[0].hostname}')

# Test Grafana
curl -I http://$LB/grafana
# Should return: HTTP/1.1 302 Found (redirect to login)

# Test Prometheus
curl -I http://$LB/prometheus
# Should return: HTTP/1.1 200 OK
```

## Full Test Script

```bash
#!/bin/bash

echo "Applying ingress fix..."

# Delete old ingress
kubectl delete ingress monitoring-ingress -n monitoring-staging

# Apply new ingress
kubectl apply -f k8s/monitoring/ingress-staging.yaml

# Wait for ingress to be ready
echo "Waiting for ingress..."
sleep 10

# Get LoadBalancer
LB=$(kubectl get ingress monitoring-ingress -n monitoring-staging -o jsonpath='{.status.loadBalancer.ingress[0].hostname}')

echo "Testing Grafana..."
curl -I "http://$LB/grafana"

echo ""
echo "Testing Prometheus..."
curl -I "http://$LB/prometheus"

echo ""
echo "If you see HTTP 200 or 302, it's working!"
```

## Commit and Push

Once verified:

```bash
git add k8s/monitoring/ingress-*.yaml
git commit -m "fix: use ingressClassName instead of deprecated annotation"
git push origin feature/scaling
```

This will fix the CI/CD deployment too!
