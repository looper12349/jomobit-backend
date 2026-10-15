# DNS Setup for Monitoring Tools

## Overview

Your monitoring tools will be accessible via custom domains:

### Production
- **Grafana**: `https://grafana-prod.dazzeldigital.com`
- **Prometheus**: `https://prometheus-prod.dazzeldigital.com` (optional)

### Staging
- **Grafana**: `https://grafana-staging.dazzeldigital.com`
- **Prometheus**: `https://prometheus-staging.dazzeldigital.com` (optional)

## Prerequisites

You need:
1. Nginx Ingress Controller running in your cluster (you already have this)
2. DNS access to `dazzeldigital.com` domain
3. (Optional) cert-manager for automatic SSL certificates

## Step 1: Get Nginx Ingress Controller IP/Hostname

```bash
# Get the LoadBalancer address of your Nginx Ingress Controller
kubectl get svc -n ingress-nginx

# Look for something like:
# NAME                                 TYPE           EXTERNAL-IP
# ingress-nginx-controller             LoadBalancer   a1b2c3d4-xxx.ap-south-1.elb.amazonaws.com
```

The EXTERNAL-IP is what you'll use for DNS records.

## Step 2: Configure DNS Records

Go to your DNS provider (where `dazzeldigital.com` is managed) and add these records:

### If Ingress has a hostname (AWS ELB):
```
Type: CNAME
Name: grafana-prod
Value: <your-ingress-controller-hostname>
TTL: 300

Type: CNAME
Name: grafana-staging
Value: <your-ingress-controller-hostname>
TTL: 300

Type: CNAME
Name: prometheus-prod
Value: <your-ingress-controller-hostname>
TTL: 300

Type: CNAME
Name: prometheus-staging
Value: <your-ingress-controller-hostname>
TTL: 300
```

### If Ingress has an IP address:
```
Type: A
Name: grafana-prod
Value: <your-ingress-controller-ip>
TTL: 300

Type: A
Name: grafana-staging
Value: <your-ingress-controller-ip>
TTL: 300

Type: A
Name: prometheus-prod
Value: <your-ingress-controller-ip>
TTL: 300

Type: A
Name: prometheus-staging
Value: <your-ingress-controller-ip>
TTL: 300
```

## Step 3: Verify DNS Propagation

```bash
# Check if DNS is resolving
nslookup grafana-prod.dazzeldigital.com
nslookup grafana-staging.dazzeldigital.com

# Or use dig
dig grafana-prod.dazzeldigital.com
```

Wait 5-10 minutes for DNS to propagate.

## Step 4: Deploy Monitoring with Ingress

The CI/CD pipeline will automatically deploy the Ingress resources. Or deploy manually:

```bash
# Production
kubectl apply -f k8s/monitoring/ingress-prod.yaml

# Staging
kubectl apply -f k8s/monitoring/ingress-staging.yaml
```

## Step 5: Verify Ingress

```bash
# Check production ingress
kubectl get ingress -n monitoring-prod

# Check staging ingress
kubectl get ingress -n monitoring-staging

# Expected output:
# NAME                 HOSTS                              ADDRESS         PORTS
# monitoring-ingress   grafana-prod.dazzeldigital.com    <ingress-ip>    80, 443
```

## Step 6: Test Access

```bash
# Test Grafana (production)
curl -I https://grafana-prod.dazzeldigital.com

# Should return HTTP 200 or redirect to login page
```

Open in browser:
- Production: https://grafana-prod.dazzeldigital.com
- Staging: https://grafana-staging.dazzeldigital.com

## SSL/TLS Certificates

### Option 1: Using cert-manager (Recommended)

If you have cert-manager installed:

```bash
# Check if cert-manager is installed
kubectl get pods -n cert-manager

# Check if ClusterIssuer exists
kubectl get clusterissuer
```

The Ingress manifests already include cert-manager annotations. Certificates will be automatically provisioned.

### Option 2: Manual Certificate

If you don't have cert-manager, you can:

1. **Remove TLS section** from ingress files (use HTTP only):
   ```bash
   # Edit the ingress files and remove the tls: section
   # Or use this command to deploy without TLS
   ```

2. **Or provide your own certificate**:
   ```bash
   kubectl create secret tls monitoring-prod-tls \
     --namespace=monitoring-prod \
     --cert=path/to/cert.crt \
     --key=path/to/cert.key
   
   kubectl create secret tls monitoring-staging-tls \
     --namespace=monitoring-staging \
     --cert=path/to/cert.crt \
     --key=path/to/cert.key
   ```

### Option 3: Use HTTP Only (Not Recommended for Production)

Edit the ingress files and remove:
- The `tls:` section
- The SSL redirect annotations

```yaml
# Remove these lines:
spec:
  tls:
    - hosts:
        - grafana-prod.dazzeldigital.com
      secretName: monitoring-prod-tls
```

Then access via HTTP:
- http://grafana-prod.dazzeldigital.com
- http://grafana-staging.dazzeldigital.com

## Troubleshooting

### DNS Not Resolving
```bash
# Check your DNS records
nslookup grafana-prod.dazzeldigital.com

# If it doesn't resolve, verify:
# 1. DNS records are created correctly
# 2. Wait 5-10 minutes for propagation
# 3. Check with your DNS provider
```

### 404 Not Found
```bash
# Check if ingress is created
kubectl get ingress -n monitoring-prod

# Check ingress details
kubectl describe ingress monitoring-ingress -n monitoring-prod

# Verify service exists
kubectl get svc grafana -n monitoring-prod
```

### SSL Certificate Issues
```bash
# Check certificate status (if using cert-manager)
kubectl get certificate -n monitoring-prod

# Check certificate details
kubectl describe certificate monitoring-prod-tls -n monitoring-prod

# Check cert-manager logs
kubectl logs -n cert-manager -l app=cert-manager
```

### Connection Refused
```bash
# Check if Grafana pod is running
kubectl get pods -n monitoring-prod

# Check Grafana logs
kubectl logs -n monitoring-prod -l app=grafana

# Test service internally
kubectl run -it --rm debug --image=curlimages/curl --restart=Never -- \
  curl http://grafana.monitoring-prod.svc.cluster.local:3000
```

## Security Considerations

### 1. Restrict Prometheus Access

Prometheus should typically be internal-only. Consider:

```yaml
# Option A: Remove Prometheus from Ingress entirely
# Delete the prometheus host section from ingress files

# Option B: Add authentication
annotations:
  nginx.ingress.kubernetes.io/auth-type: basic
  nginx.ingress.kubernetes.io/auth-secret: prometheus-basic-auth
  nginx.ingress.kubernetes.io/auth-realm: 'Authentication Required'
```

### 2. Add IP Whitelisting

Restrict access to specific IPs:

```yaml
annotations:
  nginx.ingress.kubernetes.io/whitelist-source-range: "1.2.3.4/32,5.6.7.8/32"
```

### 3. Enable Rate Limiting

```yaml
annotations:
  nginx.ingress.kubernetes.io/limit-rps: "10"
  nginx.ingress.kubernetes.io/limit-connections: "5"
```

## Quick Reference

### Your Monitoring URLs

| Environment | Tool | URL |
|-------------|------|-----|
| Production | Grafana | https://grafana-prod.dazzeldigital.com |
| Production | Prometheus | https://prometheus-prod.dazzeldigital.com |
| Staging | Grafana | https://grafana-staging.dazzeldigital.com |
| Staging | Prometheus | https://prometheus-staging.dazzeldigital.com |

### Your Application URLs

| Environment | URL |
|-------------|-----|
| Production | https://api.jomo.dazzeldigital.com |
| Dev/Staging | https://api-dev-jomo.dazzeldigital.com/api |

### Commands

```bash
# Get Ingress Controller address
kubectl get svc -n ingress-nginx

# Check monitoring ingress
kubectl get ingress -n monitoring-prod
kubectl get ingress -n monitoring-staging

# Test DNS
nslookup grafana-prod.dazzeldigital.com

# Test HTTPS
curl -I https://grafana-prod.dazzeldigital.com
```

## Next Steps

1. ✅ Get Nginx Ingress Controller address
2. ✅ Add DNS records for monitoring subdomains
3. ✅ Wait for DNS propagation (5-10 minutes)
4. ✅ Deploy monitoring stack (CI/CD will deploy Ingress)
5. ✅ Verify access via custom domains
6. ✅ Configure SSL certificates (if not using cert-manager)
7. ✅ Add security restrictions (IP whitelist, rate limiting)
