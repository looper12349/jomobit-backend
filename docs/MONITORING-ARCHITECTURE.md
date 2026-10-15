# Monitoring Architecture - Environment Isolation

## Overview

The monitoring stack is deployed with complete environment isolation, ensuring production and staging metrics are kept separate.

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                    Kubernetes Cluster (EKS)                         │
│                                                                     │
│  ┌───────────────────────────────────────────────────────────────┐ │
│  │  PRODUCTION ENVIRONMENT                                       │ │
│  │                                                               │ │
│  │  ┌─────────────────────────────────────────────────────────┐ │ │
│  │  │  production namespace                                   │ │ │
│  │  │  ┌────────┐  ┌────────┐                                │ │ │
│  │  │  │ App    │  │ App    │  :3000/metrics                 │ │ │
│  │  │  │ Pod 1  │  │ Pod 2  │  exposed                       │ │ │
│  │  │  └────────┘  └────────┘                                │ │ │
│  │  └─────────────────────────────────────────────────────────┘ │ │
│  │                        ↓ scrape every 15s                    │ │
│  │  ┌─────────────────────────────────────────────────────────┐ │ │
│  │  │  monitoring-prod namespace                              │ │ │
│  │  │                                                         │ │ │
│  │  │  ┌──────────────┐         ┌──────────────┐            │ │ │
│  │  │  │ Prometheus   │────────→│ Grafana      │            │ │ │
│  │  │  │ - Metrics    │         │ - Dashboard  │            │ │ │
│  │  │  │ - Alerts     │         │ - LoadBalancer│           │ │ │
│  │  │  │ - 30d retain │         │              │            │ │ │
│  │  │  └──────────────┘         └──────────────┘            │ │ │
│  │  │         ↓                         ↑                    │ │ │
│  │  │    ┌─────────┐              ┌────────┐                │ │ │
│  │  │    │ PVC 10Gi│              │ PVC 5Gi│                │ │ │
│  │  │    └─────────┘              └────────┘                │ │ │
│  │  └─────────────────────────────────────────────────────────┘ │ │
│  └───────────────────────────────────────────────────────────────┘ │
│                                                                     │
│  ┌───────────────────────────────────────────────────────────────┐ │
│  │  STAGING ENVIRONMENT                                          │ │
│  │                                                               │ │
│  │  ┌─────────────────────────────────────────────────────────┐ │ │
│  │  │  staging namespace                                      │ │ │
│  │  │  ┌────────┐  ┌────────┐                                │ │ │
│  │  │  │ App    │  │ App    │  :3000/metrics                 │ │ │
│  │  │  │ Pod 1  │  │ Pod 2  │  exposed                       │ │ │
│  │  │  └────────┘  └────────┘                                │ │ │
│  │  └─────────────────────────────────────────────────────────┘ │ │
│  │                        ↓ scrape every 15s                    │ │
│  │  ┌─────────────────────────────────────────────────────────┐ │ │
│  │  │  monitoring-staging namespace                           │ │ │
│  │  │                                                         │ │ │
│  │  │  ┌──────────────┐         ┌──────────────┐            │ │ │
│  │  │  │ Prometheus   │────────→│ Grafana      │            │ │ │
│  │  │  │ - Metrics    │         │ - Dashboard  │            │ │ │
│  │  │  │ - Alerts     │         │ - LoadBalancer│           │ │ │
│  │  │  │ - 30d retain │         │              │            │ │ │
│  │  │  └──────────────┘         └──────────────┘            │ │ │
│  │  │         ↓                         ↑                    │ │ │
│  │  │    ┌─────────┐              ┌────────┐                │ │ │
│  │  │    │ PVC 10Gi│              │ PVC 5Gi│                │ │ │
│  │  │    └─────────┘              └────────┘                │ │ │
│  │  └─────────────────────────────────────────────────────────┘ │ │
│  └───────────────────────────────────────────────────────────────┘ │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
                              ↓
                    Internet (via LoadBalancers)
                              ↓
                    ┌─────────────────────┐
                    │  Your Browser       │
                    │                     │
                    │  Production Grafana │
                    │  http://prod-lb:3000│
                    │                     │
                    │  Staging Grafana    │
                    │  http://stg-lb:3000 │
                    └─────────────────────┘
```

## Deployment Flow

### Main Branch (Production)
```
git push origin main
    ↓
Build Docker Image (main-abc123)
    ↓
Deploy to production namespace
    ↓
Deploy monitoring to monitoring-prod namespace
    ↓
Prometheus scrapes production pods
    ↓
Grafana displays production metrics
```

### Feature Branches (Staging)
```
git push origin feature/scaling
    ↓
Build Docker Image (feature-scaling-abc123)
    ↓
Deploy to staging namespace
    ↓
Deploy monitoring to monitoring-staging namespace
    ↓
Prometheus scrapes staging pods
    ↓
Grafana displays staging metrics
```

## Environment Isolation Benefits

### 1. Data Separation
- Production metrics never mix with staging metrics
- Separate retention policies per environment
- Independent alert configurations

### 2. Resource Isolation
- Each environment has dedicated Prometheus/Grafana instances
- No resource contention between environments
- Independent scaling capabilities

### 3. Access Control
- Separate LoadBalancer URLs for each environment
- Can apply different RBAC policies
- Easier to manage access per environment

### 4. Cost Optimization
- Can scale down staging monitoring during off-hours
- Production monitoring always available
- Clear cost attribution per environment

## Metrics Collection

### Production Prometheus Config
```yaml
scrape_configs:
  - job_name: 'jomo-backend-production'
    kubernetes_sd_configs:
      - role: pod
        namespaces:
          names:
            - production  # Only scrapes production namespace
```

### Staging Prometheus Config
```yaml
scrape_configs:
  - job_name: 'jomo-backend-staging'
    kubernetes_sd_configs:
      - role: pod
        namespaces:
          names:
            - staging  # Only scrapes staging namespace
```

## Alert Rules

Each environment has identical alert rules but they trigger independently:

- **JomobitServiceDown**: Backend unreachable for 45s
- **JomobitHigh5xxErrorRate**: >5% error rate for 45s
- **JomobitP95LatencyHigh**: P95 latency >1.5s for 45s
- **JomobitPodMemoryPressure**: Memory usage >90% for 45s

## Resource Requirements

### Per Environment

| Component | CPU Request | CPU Limit | Memory Request | Memory Limit | Storage |
|-----------|-------------|-----------|----------------|--------------|---------|
| Prometheus | 250m | 500m | 512Mi | 1Gi | 10Gi |
| Grafana | 100m | 200m | 256Mi | 512Mi | 5Gi |

### Total Cluster Resources

| Environment | CPU Request | CPU Limit | Memory Request | Memory Limit | Storage |
|-------------|-------------|-----------|----------------|--------------|---------|
| Production | 350m | 700m | 768Mi | 1.5Gi | 15Gi |
| Staging | 350m | 700m | 768Mi | 1.5Gi | 15Gi |
| **Total** | **700m** | **1.4 cores** | **1.5Gi** | **3Gi** | **30Gi** |

## Cost Estimate (AWS)

### Monthly Costs per Environment
- EBS Storage (15Gi): ~$1.50
- LoadBalancer: ~$16.00
- Compute (minimal): ~$2.00
- **Subtotal per environment**: ~$19.50

### Total Monthly Cost
- Production: $19.50
- Staging: $19.50
- **Total**: ~$39/month

## Accessing Monitoring

### Production
```bash
# Get Grafana URL
kubectl get svc grafana -n monitoring-prod

# Port-forward Prometheus
kubectl port-forward -n monitoring-prod svc/prometheus 9090:9090

# View logs
kubectl logs -n monitoring-prod -l app=prometheus -f
```

### Staging
```bash
# Get Grafana URL
kubectl get svc grafana -n monitoring-staging

# Port-forward Prometheus
kubectl port-forward -n monitoring-staging svc/prometheus 9091:9090

# View logs
kubectl logs -n monitoring-staging -l app=prometheus -f
```

## Cleanup

### Remove Production Monitoring
```bash
kubectl delete namespace monitoring-prod
```

### Remove Staging Monitoring
```bash
kubectl delete namespace monitoring-staging
```

### Remove All Monitoring
```bash
kubectl delete namespace monitoring-prod monitoring-staging
```

## Best Practices

1. **Keep environments isolated**: Never share monitoring between prod/staging
2. **Monitor the monitors**: Set up alerts for Prometheus/Grafana health
3. **Regular backups**: Export Grafana dashboards and Prometheus configs
4. **Review metrics retention**: Adjust based on compliance requirements
5. **Cost optimization**: Consider reducing staging monitoring during off-hours

## Troubleshooting

### Prometheus Not Scraping
```bash
# Check if app pods expose /metrics
kubectl port-forward -n production <pod> 3000:3000
curl http://localhost:3000/metrics

# Check Prometheus targets
kubectl port-forward -n monitoring-prod svc/prometheus 9090:9090
# Open http://localhost:9090/targets
```

### Grafana Can't Connect
```bash
# Verify Prometheus service
kubectl get svc prometheus -n monitoring-prod

# Test from Grafana pod
kubectl exec -n monitoring-prod -it <grafana-pod> -- \
  wget -O- http://prometheus:9090/api/v1/status/config
```

## Next Steps

1. ✅ Deploy monitoring to both environments
2. 📊 Import dashboards in both Grafana instances
3. 🔔 Configure alert notifications (Slack, email)
4. 📈 Create environment-specific dashboards
5. 🎯 Set up SLOs based on production metrics
