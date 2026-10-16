# Metrics Endpoint Fix

## Issue
The `/metrics` endpoint was returning 404 after switching to nginx ingress.

## Root Cause
The ingress was only configured to route `/api/*` paths to the application. The `/metrics` endpoint is defined at the root level (not under `/api`), so it wasn't being routed.

## Solution
Added `/metrics` path to both staging and production ingress configurations.

## Changes Made

### Files Updated
1. `k8s/staging-ingress.yaml` - Added `/metrics` path
2. `k8s/production-ingress.yaml` - Added `/metrics` path

### Ingress Configuration
```yaml
paths:
  - path: /api
    pathType: Prefix
    backend:
      service:
        name: jomo-backend-service
        port:
          number: 80
  
  - path: /metrics
    pathType: Exact
    backend:
      service:
        name: jomo-backend-service
        port:
          number: 80
```

## Verification

### Staging
```bash
curl -I https://api-dev-jomo.dazzeldigital.com/metrics
# Expected: HTTP/2 200
# Content-Type: text/plain; charset=utf-8; version=0.0.4
```

### Production
```bash
curl -I https://api.jomo.dazzeldigital.com/metrics
# Expected: HTTP/2 200
# Content-Type: text/plain; charset=utf-8; version=0.0.4
```

## Metrics Format
The endpoint returns Prometheus-compatible metrics:
```
# HELP process_cpu_user_seconds_total Total user CPU time spent in seconds.
# TYPE process_cpu_user_seconds_total counter
process_cpu_user_seconds_total{service="jomobit-backend-api",environment="staging"} 37.30

# HELP http_request_duration_seconds HTTP request duration in seconds
# TYPE http_request_duration_seconds histogram
...
```

## Prometheus Scraping
Prometheus is configured to scrape this endpoint automatically via Kubernetes service discovery. The metrics are available at:
- Staging: `https://api-dev-jomo.dazzeldigital.com/metrics`
- Production: `https://api.jomo.dazzeldigital.com/metrics`

## All Working Endpoints

### Staging (api-dev-jomo.dazzeldigital.com)
- ✅ `/api` - Application API
- ✅ `/metrics` - Prometheus metrics
- ✅ `/grafana/` - Grafana dashboard
- ✅ `/prometheus/` - Prometheus UI

### Production (api.jomo.dazzeldigital.com)
- ✅ `/api` - Application API
- ✅ `/metrics` - Prometheus metrics
- ✅ `/grafana/` - Grafana dashboard
- ✅ `/prometheus/` - Prometheus UI

## Notes
- The `/metrics` endpoint uses `pathType: Exact` to match only `/metrics` (not `/metrics/*`)
- The endpoint is publicly accessible but doesn't expose sensitive data
- Prometheus scrapes this endpoint every 15 seconds (configured in `prometheus-config.yaml`)
