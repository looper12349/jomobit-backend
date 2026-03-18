# 🌐 Monitoring Stack - Path-Based Routing

## Your Monitoring URLs (Same Domain, Different Paths)

### Production Environment
```
🔹 Application:  https://api.jomo.dazzeldigital.com/api
📊 Grafana:      https://api.jomo.dazzeldigital.com/grafana
🔍 Prometheus:   https://api.jomo.dazzeldigital.com/prometheus
```

### Staging/Dev Environment
```
🔹 Application:  https://api-dev-jomo.dazzeldigital.com/api
📊 Grafana:      https://api-dev-jomo.dazzeldigital.com/grafana
🔍 Prometheus:   https://api-dev-jomo.dazzeldigital.com/prometheus
```

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Internet / Users                         │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│              Nginx Ingress Controller                       │
│         (Single LoadBalancer, Single Domain)                │
│                                                             │
│  api.jomo.dazzeldigital.com                                │
│    /api        → production/jomo-backend-service           │
│    /grafana    → monitoring-prod/grafana                   │
│    /prometheus → monitoring-prod/prometheus                │
│                                                             │
│  api-dev-jomo.dazzeldigital.com                            │
│    /api        → staging/jomo-backend-service              │
│    /grafana    → monitoring-staging/grafana                │
│    /prometheus → monitoring-staging/prometheus             │
└─────────────────────────────────────────────────────────────┘
```

## Benefits

✅ **Single Domain** - All services under one domain
✅ **No DNS Changes** - Uses your existing domains
✅ **No Additional Costs** - Uses existing LoadBalancer
✅ **Clean URLs** - Path-based routing
✅ **Same SSL Certificate** - One cert for all paths

## How It Works

### Path-Based Routing
The Nginx Ingress Controller routes requests based on the URL path:

**Production:**
- `https://api.jomo.dazzeldigital.com/api` → Your app (production namespace)
- `https://api.jomo.dazzeldigital.com/grafana` → Grafana (monitoring-prod namespace)
- `https://api.jomo.dazzeldigital.com/prometheus` → Prometheus (monitoring-prod namespace)

**Staging:**
- `https://api-dev-jomo.dazzeldigital.com/api` → Your app (staging namespace)
- `https://api-dev-jomo.dazzeldigital.com/grafana` → Grafana (monitoring-staging namespace)
- `https://api-dev-jomo.dazzeldigital.com/prometheus` → Prometheus (monitoring-staging namespace)

### URL Rewriting
The Ingress automatically rewrites URLs:
- External: `https://api.jomo.dazzeldigital.com/grafana/dashboard`
- Internal: `http://grafana:3000/dashboard`

## Setup Steps

### Step 1: Add GitHub Secret (One-time)
```bash
# Go to GitHub repo settings and add:
GRAFANA_ADMIN_PASSWORD=<your-secure-password>
```

### Step 2: Deploy
```bash
git add .
git commit -m "feat: add monitoring with path-based routing"
git push origin main  # For production
# OR
git push origin feature/scaling  # For staging
```

### Step 3: Access Monitoring
**Production:**
- Open: https://api.jomo.dazzeldigital.com/grafana
- Login with username `admin` and your password

**Staging:**
- Open: https://api-dev-jomo.dazzeldigital.com/grafana
- Login with username `admin` and your password

## No DNS Changes Required!

✅ Uses your existing domains
✅ No new DNS records needed
✅ Works immediately after deployment

## Configuration Details

### Grafana Configuration
Grafana is configured to serve from subpath `/grafana`:
```yaml
env:
  - name: GF_SERVER_ROOT_URL
    value: "%(protocol)s://%(domain)s/grafana/"
  - name: GF_SERVER_SERVE_FROM_SUB_PATH
    value: "true"
```

### Prometheus Configuration
Prometheus is configured to serve from subpath `/prometheus`:
```yaml
args:
  - '--web.external-url=/prometheus'
  - '--web.route-prefix=/prometheus'
```

### Ingress Configuration
Path-based routing with URL rewriting:
```yaml
annotations:
  nginx.ingress.kubernetes.io/rewrite-target: /$2

paths:
  - path: /grafana(/|$)(.*)
    pathType: Prefix
    backend:
      service:
        name: grafana
        port:
          number: 3000
```

## Verification

### Check Deployment
```bash
# Check production monitoring
kubectl get pods -n monitoring-prod
kubectl get ingress -n monitoring-prod

# Check staging monitoring
kubectl get pods -n monitoring-staging
kubectl get ingress -n monitoring-staging
```

### Test URLs
```bash
# Production
curl -I https://api.jomo.dazzeldigital.com/grafana
curl -I https://api.jomo.dazzeldigital.com/prometheus

# Staging
curl -I https://api-dev-jomo.dazzeldigital.com/grafana
curl -I https://api-dev-jomo.dazzeldigital.com/prometheus
```

### Expected Response
```
HTTP/2 200
# or
HTTP/2 302 (redirect to login)
```

## Import Dashboard

1. Access Grafana: https://api.jomo.dazzeldigital.com/grafana
2. Login with admin credentials
3. Go to: Dashboards → Import
4. Upload: `monitoring/grafana/dashboards/jomobit-overview.json`
5. Select datasource: "Prometheus"
6. Click "Import"

## Security Considerations

### 1. Keep Prometheus Internal (Recommended)
Consider removing Prometheus from public access and use port-forward:
```bash
kubectl port-forward -n monitoring-prod svc/prometheus 9090:9090
```

Then access locally at: http://localhost:9090

### 2. Add Authentication to Prometheus
If you want to keep it public, add basic auth:
```yaml
annotations:
  nginx.ingress.kubernetes.io/auth-type: basic
  nginx.ingress.kubernetes.io/auth-secret: prometheus-basic-auth
```

### 3. IP Whitelisting (Optional)
Restrict access to specific IPs:
```yaml
annotations:
  nginx.ingress.kubernetes.io/whitelist-source-range: "YOUR.IP.ADDRESS/32"
```

## Troubleshooting

### 404 Not Found
```bash
# Check if Ingress is created
kubectl get ingress -n monitoring-prod

# Check Ingress details
kubectl describe ingress monitoring-ingress -n monitoring-prod

# Verify paths are correct
kubectl get ingress monitoring-ingress -n monitoring-prod -o yaml
```

### Grafana Shows Blank Page
```bash
# Check Grafana logs
kubectl logs -n monitoring-prod -l app=grafana

# Verify subpath configuration
kubectl get deployment grafana -n monitoring-prod -o yaml | grep GF_SERVER
```

### Prometheus Not Loading
```bash
# Check Prometheus logs
kubectl logs -n monitoring-prod -l app=prometheus

# Verify external URL configuration
kubectl get deployment prometheus -n monitoring-prod -o yaml | grep external-url
```

### CSS/JS Not Loading
This usually means the subpath configuration is incorrect. Verify:
```bash
# For Grafana
kubectl exec -n monitoring-prod -it <grafana-pod> -- env | grep GF_SERVER

# For Prometheus
kubectl exec -n monitoring-prod -it <prometheus-pod> -- cat /etc/prometheus/prometheus.yml
```

## Quick Commands

```bash
# Check monitoring status
npm run monitoring:check

# View production monitoring
kubectl get all -n monitoring-prod

# View staging monitoring
kubectl get all -n monitoring-staging

# Check Ingress
kubectl get ingress -n monitoring-prod
kubectl get ingress -n monitoring-staging

# View logs
kubectl logs -n monitoring-prod -l app=grafana -f
kubectl logs -n monitoring-prod -l app=prometheus -f
```

## Cost Impact

✅ **No Additional Costs!**
- Uses existing Nginx Ingress Controller
- Uses existing domain and SSL certificate
- No new LoadBalancers needed
- Same infrastructure, more functionality

## Summary

Your monitoring tools are now accessible at:

**Production:**
- 🔹 App: https://api.jomo.dazzeldigital.com/api
- 📊 Grafana: https://api.jomo.dazzeldigital.com/grafana
- 🔍 Prometheus: https://api.jomo.dazzeldigital.com/prometheus

**Staging:**
- 🔹 App: https://api-dev-jomo.dazzeldigital.com/api
- 📊 Grafana: https://api-dev-jomo.dazzeldigital.com/grafana
- 🔍 Prometheus: https://api-dev-jomo.dazzeldigital.com/prometheus

✅ Same domain
✅ Same LoadBalancer
✅ No DNS changes
✅ No additional costs
✅ Clean path-based routing

Just push your code and access the monitoring tools! 🚀
