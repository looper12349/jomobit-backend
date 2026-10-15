# Monitoring Stack Deployment Guide

## Overview

Your monitoring stack is now integrated into the CI/CD pipeline and will automatically deploy to Kubernetes alongside your application.

## What Was Set Up

### 1. Kubernetes Manifests (`k8s/monitoring/`)

- `namespace.yaml` - Dedicated monitoring namespace
- `prometheus-rbac.yaml` - Service account and permissions for Prometheus
- `prometheus-config.yaml` - Prometheus scraping configuration
- `prometheus-alerts.yaml` - Alert rules for your application
- `prometheus-deployment.yaml` - Prometheus deployment and service
- `prometheus-pvc.yaml` - Persistent storage for metrics
- `grafana-deployment.yaml` - Grafana deployment and LoadBalancer service
- `grafana-datasource.yaml` - Auto-configured Prometheus datasource
- `grafana-pvc.yaml` - Persistent storage for Grafana
- `README.md` - Detailed documentation
- `QUICK-START.md` - Quick reference guide

### 2. CI/CD Integration (`.github/workflows/cicd.yml`)

Added new job: `deploy-monitoring` that runs after successful application deployment

**What it does:**
1. Creates monitoring namespace
2. Sets up Prometheus RBAC
3. Creates Grafana admin password secret
4. Deploys Prometheus with alerts
5. Deploys Grafana with datasource
6. Outputs access URLs in GitHub Actions logs

### 3. Helper Scripts

- `scripts/deploy-monitoring.sh` - Manual deployment script
- `scripts/check-monitoring.sh` - Status check script

### 4. NPM Commands

```bash
npm run monitoring:deploy  # Deploy to Kubernetes manually
npm run monitoring:check   # Check deployment status
npm run monitoring:up      # Run locally with Docker Compose
npm run monitoring:down    # Stop local monitoring
```

## How It Works

### Automatic Deployment Flow

```
Push to main/feature branch
    ↓
Build & Push Docker Image
    ↓
Deploy Application to K8s
    ↓
Deploy Monitoring Stack ← NEW!
    ↓
Output Grafana URL in logs
```

### Metrics Collection

Prometheus automatically discovers and scrapes metrics from:
- Production pods in `production` namespace
- Staging pods in `staging` namespace

Scrape configuration:
```yaml
- job_name: 'jomo-backend-production'
  kubernetes_sd_configs:
    - role: pod
      namespaces:
        names: [production]
```

### Alert Rules

Four alerts are configured:

1. **JomobitServiceDown** - Backend unreachable for 45s
2. **JomobitHigh5xxErrorRate** - >5% error rate for 45s
3. **JomobitP95LatencyHigh** - P95 latency >1.5s for 45s
4. **JomobitPodMemoryPressure** - Memory usage >90% for 45s

## Setup Instructions

### One-Time Setup

1. **Add GitHub Secret** (Required):
   ```
   Repository → Settings → Secrets and variables → Actions
   Add: GRAFANA_ADMIN_PASSWORD = <your-secure-password>
   ```

2. **Push your code**:
   ```bash
   git add .
   git commit -m "feat: add monitoring stack deployment"
   git push origin main
   ```

3. **Monitor deployment**:
   - Go to GitHub Actions
   - Watch "Deploy Monitoring Stack" job
   - Note the Grafana URL from logs

### Accessing Monitoring

#### Grafana (Dashboard)
```bash
# Get LoadBalancer URL
kubectl get svc grafana -n monitoring

# Access at: http://<EXTERNAL-IP>:3000
# Username: admin
# Password: <your GRAFANA_ADMIN_PASSWORD>
```

#### Prometheus (Metrics & Alerts)
```bash
# Port-forward to access locally
kubectl port-forward -n monitoring svc/prometheus 9090:9090

# Open: http://localhost:9090
```

### Import Dashboard

1. Login to Grafana
2. Go to Dashboards → Import
3. Upload: `monitoring/grafana/dashboards/jomobit-overview.json`
4. Select Prometheus datasource
5. Click Import

## Verification Checklist

After deployment, verify:

- [ ] Monitoring namespace exists: `kubectl get ns monitoring`
- [ ] Pods are running: `kubectl get pods -n monitoring`
- [ ] Grafana LoadBalancer has external IP: `kubectl get svc grafana -n monitoring`
- [ ] Prometheus targets are UP: Port-forward and check http://localhost:9090/targets
- [ ] Grafana datasource is configured: Login → Configuration → Data Sources
- [ ] Dashboard displays metrics: Import dashboard and check panels
- [ ] Alerts are loaded: Check http://localhost:9090/alerts

## Quick Commands

```bash
# Check status
npm run monitoring:check

# View pods
kubectl get pods -n monitoring

# View logs
kubectl logs -n monitoring -l app=prometheus -f
kubectl logs -n monitoring -l app=grafana -f

# Get Grafana URL
kubectl get svc grafana -n monitoring

# Access Prometheus locally
kubectl port-forward -n monitoring svc/prometheus 9090:9090

# Restart monitoring
kubectl rollout restart deployment/prometheus -n monitoring
kubectl rollout restart deployment/grafana -n monitoring

# Delete monitoring stack
kubectl delete namespace monitoring
```

## Troubleshooting

### Pods Not Starting

```bash
# Check pod status
kubectl describe pod -n monitoring <pod-name>

# Check events
kubectl get events -n monitoring --sort-by='.lastTimestamp'
```

### PVC Not Binding

```bash
# Check PVC status
kubectl get pvc -n monitoring

# Verify storage class exists
kubectl get storageclass

# For AWS EKS, ensure gp2 storage class exists
```

### Prometheus Not Scraping

```bash
# Verify app exposes /metrics
kubectl port-forward -n production <app-pod> 3000:3000
curl http://localhost:3000/metrics

# Check Prometheus config
kubectl get configmap prometheus-config -n monitoring -o yaml

# Check Prometheus logs
kubectl logs -n monitoring -l app=prometheus -f
```

### Grafana Can't Connect to Prometheus

```bash
# Verify Prometheus service
kubectl get svc prometheus -n monitoring

# Check Grafana datasource config
kubectl get configmap grafana-datasources -n monitoring -o yaml

# Test connectivity from Grafana pod
kubectl exec -n monitoring -it <grafana-pod> -- wget -O- http://prometheus:9090/api/v1/status/config
```

## Architecture

```
┌─────────────────────────────────────────────────┐
│           Kubernetes Cluster (EKS)              │
│                                                 │
│  ┌──────────────────────────────────────────┐  │
│  │  Production Namespace                    │  │
│  │  ┌────────┐  ┌────────┐                 │  │
│  │  │ App    │  │ App    │  /metrics       │  │
│  │  │ Pod 1  │  │ Pod 2  │  exposed        │  │
│  │  └────────┘  └────────┘                 │  │
│  └──────────────────────────────────────────┘  │
│                    ↓ scrape                     │
│  ┌──────────────────────────────────────────┐  │
│  │  Monitoring Namespace                    │  │
│  │                                          │  │
│  │  ┌──────────────┐    ┌──────────────┐  │  │
│  │  │ Prometheus   │───→│ Grafana      │  │  │
│  │  │ - Metrics    │    │ - Dashboard  │  │  │
│  │  │ - Alerts     │    │ - LoadBalancer│ │  │
│  │  └──────────────┘    └──────────────┘  │  │
│  │         ↓                     ↑         │  │
│  │    ┌─────────┐           ┌────────┐    │  │
│  │    │ PVC 10Gi│           │ PVC 5Gi│    │  │
│  │    └─────────┘           └────────┘    │  │
│  └──────────────────────────────────────────┘  │
│                                                 │
└─────────────────────────────────────────────────┘
                    ↓
            Internet (via LoadBalancer)
                    ↓
            Your Browser → Grafana UI
```

## Cost Considerations

AWS resources created:
- 2 EBS volumes (10Gi + 5Gi) ≈ $1.50/month
- 1 LoadBalancer for Grafana ≈ $16/month
- Pod compute resources (minimal)

**Total estimated cost: ~$18/month**

## Next Steps

1. ✅ Monitoring stack is deployed automatically
2. 📊 Import the Grafana dashboard
3. 🔔 Configure alert notifications (Slack, email, etc.)
4. 📈 Create custom dashboards for your specific metrics
5. 🎯 Set up SLOs and SLIs based on your requirements

## References

- [Prometheus Documentation](https://prometheus.io/docs/)
- [Grafana Documentation](https://grafana.com/docs/)
- [Kubernetes Monitoring Best Practices](https://kubernetes.io/docs/tasks/debug/debug-cluster/resource-metrics-pipeline/)
