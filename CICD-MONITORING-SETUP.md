# CI/CD Monitoring Setup - Complete

## What Was Fixed

### 1. Service Type Changed
- Changed `jomo-backend-service` from `LoadBalancer` to `ClusterIP`
- All traffic now goes through nginx ingress controller (single LoadBalancer)

### 2. SSL Certificates
- Installed cert-manager for automatic SSL certificate management
- Created Let's Encrypt ClusterIssuer for production certificates
- Certificates auto-renew every 90 days

### 3. Unified Ingress
Created environment-specific ingresses that route:
- `/api` → Application backend
- `/grafana` → Grafana monitoring
- `/prometheus` → Prometheus monitoring

### 4. CI/CD Pipeline Updates

The pipeline now:
1. Installs cert-manager (if not exists)
2. Creates Let's Encrypt ClusterIssuer (if not exists)
3. Deploys monitoring stack to environment-specific namespace
4. Creates ExternalName services for cross-namespace access
5. Deploys unified ingress with SSL

## Environment Configuration

### Staging (feature/* branches)
- App Namespace: `staging`
- Monitoring Namespace: `monitoring-staging`
- Domain: `api-dev-jomo.dazzeldigital.com`
- Ingress: `k8s/staging-ingress.yaml`
- Services: `k8s/staging-monitoring-services.yaml`

### Production (main branch)
- App Namespace: `production`
- Monitoring Namespace: `monitoring-prod`
- Domain: `api.jomo.dazzeldigital.com`
- Ingress: `k8s/production-ingress.yaml`
- Services: `k8s/production-monitoring-services.yaml`

## Access URLs

### Staging
- Application: https://api-dev-jomo.dazzeldigital.com/api
- Grafana: https://api-dev-jomo.dazzeldigital.com/grafana/
- Prometheus: https://api-dev-jomo.dazzeldigital.com/prometheus/

### Production
- Application: https://api.jomo.dazzeldigital.com/api
- Grafana: https://api.jomo.dazzeldigital.com/grafana/
- Prometheus: https://api.jomo.dazzeldigital.com/prometheus/

## Required GitHub Secrets

Make sure these secrets are set in your repository:

### Existing Secrets (already configured)
- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`
- `DOCKERHUB_USERNAME`
- `DOCKERHUB_TOKEN`
- All application secrets (MongoDB, Redis, Auth0, etc.)

### New Secret (optional)
- `GRAFANA_ADMIN_PASSWORD` - Custom Grafana admin password (defaults to 'admin123' if not set)

## How It Works

### On Push to Feature Branch (staging)
1. Builds Docker image with tag `feature-<branch>-<sha>`
2. Deploys to `staging` namespace
3. Deploys monitoring to `monitoring-staging` namespace
4. Creates ExternalName services in `staging` namespace
5. Deploys unified ingress with SSL certificate
6. Accessible at `api-dev-jomo.dazzeldigital.com`

### On Push to Main Branch (production)
1. Builds Docker image with tag `main-<sha>`
2. Deploys to `production` namespace
3. Deploys monitoring to `monitoring-prod` namespace
4. Creates ExternalName services in `production` namespace
5. Deploys unified ingress with SSL certificate
6. Accessible at `api.jomo.dazzeldigital.com`

## First-Time Setup

The CI/CD will automatically:
1. Install cert-manager (first run only)
2. Create ClusterIssuer (first run only)
3. Request SSL certificates from Let's Encrypt
4. Deploy monitoring stack
5. Configure ingress with SSL

## SSL Certificate Status

Check certificate status:
```bash
# Staging
kubectl get certificate -n staging

# Production
kubectl get certificate -n production
```

Expected output:
```
NAME            READY   SECRET          AGE
staging-tls     True    staging-tls     5m
```

## Monitoring Stack Components

Each environment gets:
- Prometheus (metrics collection)
- Grafana (visualization)
- Alert rules (configured in `k8s/monitoring/prometheus-alerts.yaml`)
- Persistent storage (5Gi for Prometheus, 2Gi for Grafana)

## Troubleshooting

### Certificate Not Ready
```bash
kubectl describe certificate staging-tls -n staging
```

Look for events showing certificate issuance progress.

### Monitoring Not Accessible
```bash
# Check ingress
kubectl get ingress -n staging

# Check services
kubectl get svc -n staging
kubectl get svc -n monitoring-staging

# Check pods
kubectl get pods -n monitoring-staging
```

### Application Not Accessible
```bash
# Check deployment
kubectl get deployment jomo-backend -n staging

# Check pods
kubectl get pods -n staging -l app=jomo-backend

# Check logs
kubectl logs -n staging -l app=jomo-backend --tail=50
```

## Manual Deployment

To manually trigger deployment:
1. Go to Actions tab in GitHub
2. Select "CI/CD Pipeline - JOMO Backend (Kubernetes)"
3. Click "Run workflow"
4. Select environment (staging/production)
5. Click "Run workflow"

## Cleanup Old LoadBalancer (Optional)

The old LoadBalancer service is no longer needed. To remove it and save costs:

```bash
# This is already done in CI/CD - service is now ClusterIP
# But if you have an old LoadBalancer service, you can patch it:
kubectl patch svc jomo-backend-service -n staging -p '{"spec":{"type":"ClusterIP"}}'
```

## Next Steps

1. Push to feature branch to test staging deployment
2. Verify monitoring is accessible
3. Check SSL certificate is valid
4. Merge to main to deploy to production
5. Set up Grafana dashboards for your metrics

## Files Modified/Created

### Modified
- `.github/workflows/cicd.yml` - Updated deployment pipeline
- `Docker/Dockerfile.dev` - Removed duplicate CMD

### Created
- `k8s/cert-manager-issuer.yaml` - Let's Encrypt configuration
- `k8s/staging-ingress.yaml` - Staging unified ingress
- `k8s/staging-monitoring-services.yaml` - Staging ExternalName services
- `k8s/production-ingress.yaml` - Production unified ingress
- `k8s/production-monitoring-services.yaml` - Production ExternalName services
- `k8s/monitoring/*` - All monitoring stack manifests

## Support

If you encounter issues:
1. Check the Actions tab for deployment logs
2. Use the troubleshooting commands above
3. Check ingress controller logs: `kubectl logs -n ingress-nginx -l app.kubernetes.io/name=ingress-nginx`
