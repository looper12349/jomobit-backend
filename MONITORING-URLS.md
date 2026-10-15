# 🌐 Monitoring URLs - Your Custom Domains

## Your Monitoring Stack URLs

After DNS configuration, your monitoring tools will be accessible at:

### Production Environment
```
🔹 Application:  https://api.jomo.dazzeldigital.com
📊 Grafana:      https://grafana-prod.dazzeldigital.com
🔍 Prometheus:   https://prometheus-prod.dazzeldigital.com
```

### Staging/Dev Environment
```
🔹 Application:  https://api-dev-jomo.dazzeldigital.com/api
📊 Grafana:      https://grafana-staging.dazzeldigital.com
🔍 Prometheus:   https://prometheus-staging.dazzeldigital.com
```

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    Internet / Users                             │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│                    DNS (dazzeldigital.com)                      │
│                                                                 │
│  api.jomo.dazzeldigital.com          → Nginx Ingress           │
│  api-dev-jomo.dazzeldigital.com      → Nginx Ingress           │
│  grafana-prod.dazzeldigital.com      → Nginx Ingress           │
│  grafana-staging.dazzeldigital.com   → Nginx Ingress           │
│  prometheus-prod.dazzeldigital.com   → Nginx Ingress           │
│  prometheus-staging.dazzeldigital.com → Nginx Ingress          │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│              Nginx Ingress Controller (EKS)                     │
│         (Single LoadBalancer for all domains)                   │
└─────────────────────────────────────────────────────────────────┘
                              ↓
        ┌─────────────────────┴─────────────────────┐
        ↓                                           ↓
┌──────────────────────┐                  ┌──────────────────────┐
│  Production          │                  │  Staging             │
│                      │                  │                      │
│  ┌────────────────┐  │                  │  ┌────────────────┐ │
│  │ production ns  │  │                  │  │ staging ns     │ │
│  │ - App Pods     │  │                  │  │ - App Pods     │ │
│  └────────────────┘  │                  │  └────────────────┘ │
│         ↓            │                  │         ↓           │
│  ┌────────────────┐  │                  │  ┌────────────────┐ │
│  │monitoring-prod │  │                  │  │monitoring-stg  │ │
│  │ - Prometheus   │  │                  │  │ - Prometheus   │ │
│  │ - Grafana      │  │                  │  │ - Grafana      │ │
│  └────────────────┘  │                  │  └────────────────┘ │
└──────────────────────┘                  └──────────────────────┘
```

## How It Works

### 1. Single Ingress Controller
You already have an Nginx Ingress Controller that handles:
- `api.jomo.dazzeldigital.com` → Your production app
- `api-dev-jomo.dazzeldigital.com` → Your staging app

### 2. Add Monitoring Domains
We're adding 4 new subdomains that route through the same Ingress Controller:
- `grafana-prod.dazzeldigital.com` → Production Grafana
- `grafana-staging.dazzeldigital.com` → Staging Grafana
- `prometheus-prod.dazzeldigital.com` → Production Prometheus (optional)
- `prometheus-staging.dazzeldigital.com` → Staging Prometheus (optional)

### 3. No Additional LoadBalancers
- ✅ Uses your existing Nginx Ingress Controller
- ✅ No extra AWS LoadBalancer costs
- ✅ All domains route through one entry point
- ✅ SSL certificates managed by cert-manager (if installed)

## Setup Steps

### Step 1: Get Ingress Controller Address
```bash
kubectl get svc -n ingress-nginx

# Output example:
# NAME                       TYPE           EXTERNAL-IP
# ingress-nginx-controller   LoadBalancer   a1b2c3d4-xxx.ap-south-1.elb.amazonaws.com
```

### Step 2: Add DNS Records

Go to your DNS provider and add these CNAME records:

| Type | Name | Value | TTL |
|------|------|-------|-----|
| CNAME | grafana-prod | <your-ingress-controller-hostname> | 300 |
| CNAME | grafana-staging | <your-ingress-controller-hostname> | 300 |
| CNAME | prometheus-prod | <your-ingress-controller-hostname> | 300 |
| CNAME | prometheus-staging | <your-ingress-controller-hostname> | 300 |

**Example:**
```
CNAME  grafana-prod      a1b2c3d4-xxx.ap-south-1.elb.amazonaws.com
CNAME  grafana-staging   a1b2c3d4-xxx.ap-south-1.elb.amazonaws.com
```

### Step 3: Deploy Monitoring
```bash
# Push your code - CI/CD will deploy everything including Ingress
git push origin main
```

### Step 4: Wait for DNS (5-10 minutes)
```bash
# Check DNS propagation
nslookup grafana-prod.dazzeldigital.com
```

### Step 5: Access Grafana
Open in browser:
- Production: https://grafana-prod.dazzeldigital.com
- Staging: https://grafana-staging.dazzeldigital.com

Login with:
- Username: `admin`
- Password: `<your GRAFANA_ADMIN_PASSWORD>`

## SSL Certificates

### If you have cert-manager installed:
✅ Certificates will be automatically provisioned
✅ HTTPS will work automatically
✅ No additional configuration needed

### If you DON'T have cert-manager:
You have two options:

**Option 1: Install cert-manager** (Recommended)
```bash
kubectl apply -f https://github.com/cert-manager/cert-manager/releases/download/v1.13.0/cert-manager.yaml
```

**Option 2: Use HTTP only**
Edit the ingress files and remove the TLS sections, then access via:
- http://grafana-prod.dazzeldigital.com
- http://grafana-staging.dazzeldigital.com

## Cost Impact

### Before (with LoadBalancers)
- Production monitoring LoadBalancer: $16/month
- Staging monitoring LoadBalancer: $16/month
- **Total: $32/month**

### After (with Ingress)
- Uses existing Nginx Ingress Controller: $0 additional
- **Total: $0 additional** (you already pay for the Ingress Controller)

**Savings: $32/month!** 💰

## Security Recommendations

### 1. Keep Prometheus Internal
Consider removing Prometheus from public Ingress and access it via port-forward:
```bash
kubectl port-forward -n monitoring-prod svc/prometheus 9090:9090
```

### 2. Add IP Whitelisting (Optional)
Restrict Grafana access to your office/VPN IP:
```yaml
annotations:
  nginx.ingress.kubernetes.io/whitelist-source-range: "YOUR.IP.ADDRESS/32"
```

### 3. Enable Rate Limiting
Already included in the Ingress configuration.

## Verification Checklist

- [ ] Get Nginx Ingress Controller hostname
- [ ] Add 4 DNS CNAME records
- [ ] Wait 5-10 minutes for DNS propagation
- [ ] Verify DNS: `nslookup grafana-prod.dazzeldigital.com`
- [ ] Push code to deploy monitoring
- [ ] Check Ingress: `kubectl get ingress -n monitoring-prod`
- [ ] Access Grafana via custom domain
- [ ] Verify SSL certificate (if using cert-manager)
- [ ] Login to Grafana and import dashboard

## Troubleshooting

### DNS not resolving?
```bash
# Check DNS records with your provider
# Wait 5-10 minutes for propagation
nslookup grafana-prod.dazzeldigital.com
```

### 404 Not Found?
```bash
# Check if Ingress is created
kubectl get ingress -n monitoring-prod

# Check Ingress details
kubectl describe ingress monitoring-ingress -n monitoring-prod
```

### SSL Certificate error?
```bash
# Check if cert-manager is installed
kubectl get pods -n cert-manager

# Check certificate status
kubectl get certificate -n monitoring-prod
```

## Quick Commands

```bash
# Check Ingress Controller
kubectl get svc -n ingress-nginx

# Check monitoring Ingress
kubectl get ingress -n monitoring-prod
kubectl get ingress -n monitoring-staging

# Test DNS
nslookup grafana-prod.dazzeldigital.com

# Test HTTPS
curl -I https://grafana-prod.dazzeldigital.com

# View Ingress details
kubectl describe ingress monitoring-ingress -n monitoring-prod
```

## Documentation

- **DNS Setup Guide**: `k8s/monitoring/DNS-SETUP.md`
- **Deployment Checklist**: `DEPLOYMENT-CHECKLIST.md`
- **Architecture**: `docs/MONITORING-ARCHITECTURE.md`

---

**Summary:** Your monitoring tools will be accessible at custom subdomains using your existing Nginx Ingress Controller - no additional LoadBalancers needed! 🎉
