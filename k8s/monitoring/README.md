# Kubernetes Monitoring Stack Deployment

## Overview

This monitoring stack includes:
- **Prometheus**: Metrics collection and alerting
- **Grafana**: Visualization and dashboards
- **Alert Rules**: Automated alerts for service health

**Environment Isolation**: Each environment (production/staging) gets its own monitoring namespace:
- `main` branch → `monitoring-prod` namespace (monitors `production` namespace)
- `feature/*` branches → `monitoring-staging` namespace (monitors `staging` namespace)

## Automatic Deployment via CI/CD

The monitoring stack is automatically deployed when you push to main or feature branches. The CI/CD pipeline will:

1. Deploy your application to the appropriate namespace (production/staging)
2. Deploy the monitoring stack to the corresponding monitoring namespace
3. Configure Prometheus to scrape metrics from the correct app namespace
4. Set up Grafana with Prometheus as a datasource
5. Output environment-specific access URLs in the GitHub Actions logs

### Deployment Matrix

| Branch | App Namespace | Monitoring Namespace | Grafana URL |
|--------|---------------|---------------------|-------------|
| `main` | `production` | `monitoring-prod` | Separate LoadBalancer |
| `feature/scaling` | `staging` | `monitoring-staging` | Separate LoadBalancer |
| `feature/enhance-generation` | `staging` | `monitoring-staging` | Separate LoadBalancer |

### Required GitHub Secret

Add this secret to your GitHub repository:
- `GRAFANA_ADMIN_PASSWORD`: Password for Grafana admin user (defaults to 'admin123' if not set)

## Manual Deployment

### Prerequisites
```bash
# Ensure you're connected to your EKS cluster
aws eks update-kubeconfig --region ap-south-1 --name 4-jomo-cluster

# Set your environment (production or staging)
export ENVIRONMENT=production  # or staging
export MONITORING_NS=monitoring-prod  # or monitoring-staging
export APP_NS=production  # or staging
```

### 1. Create monitoring namespace and RBAC
```bash
# Create namespace
kubectl create namespace $MONITORING_NS
kubectl label namespace $MONITORING_NS environment=$ENVIRONMENT

# Apply RBAC (update namespace in file first)
sed "s/namespace: monitoring/namespace: $MONITORING_NS/g" k8s/monitoring/prometheus-rbac.yaml | kubectl apply -f -
```

### 2. Create Grafana admin password secret
```bash
kubectl create secret generic grafana-secrets \
  --namespace=$MONITORING_NS \
  --from-literal=admin-password='your-secure-password'
```

### 3. Deploy Prometheus
```bash
# Apply all Prometheus manifests with updated namespace
for file in k8s/monitoring/prometheus-*.yaml; do
  sed "s/namespace: monitoring/namespace: $MONITORING_NS/g" "$file" | kubectl apply -f -
done

# Update Prometheus config to scrape correct namespace
cat <<EOF | kubectl apply -f -
apiVersion: v1
kind: ConfigMap
metadata:
  name: prometheus-config
  namespace: $MONITORING_NS
data:
  prometheus.yml: |
    global:
      scrape_interval: 15s
      evaluation_interval: 15s
    
    rule_files:
      - '/etc/prometheus/rules/*.yml'
    
    scrape_configs:
      - job_name: 'jomo-backend-$ENVIRONMENT'
        kubernetes_sd_configs:
          - role: pod
            namespaces:
              names:
                - $APP_NS
        relabel_configs:
          - source_labels: [__meta_kubernetes_pod_label_app]
            action: keep
            regex: jomo-backend
          - source_labels: [__meta_kubernetes_pod_ip]
            target_label: __address__
            replacement: '\${1}:3000'
EOF
```

### 4. Deploy Grafana
```bash
# Apply all Grafana manifests with updated namespace
for file in k8s/monitoring/grafana-*.yaml; do
  sed "s/namespace: monitoring/namespace: $MONITORING_NS/g" "$file" | kubectl apply -f -
done
```

### 5. Wait for deployments
```bash
kubectl wait --for=condition=available --timeout=300s deployment/prometheus -n $MONITORING_NS
kubectl wait --for=condition=available --timeout=300s deployment/grafana -n $MONITORING_NS
```

## Access the Monitoring Stack

### Get Grafana URL (Production)
```bash
# Get the LoadBalancer URL for production monitoring
kubectl get svc grafana -n monitoring-prod

# Example output:
# NAME      TYPE           CLUSTER-IP      EXTERNAL-IP                                                              PORT(S)
# grafana   LoadBalancer   10.100.123.45   a1b2c3d4e5f6g7h8i9j0.ap-south-1.elb.amazonaws.com   3000:31234/TCP
```

### Get Grafana URL (Staging)
```bash
# Get the LoadBalancer URL for staging monitoring
kubectl get svc grafana -n monitoring-staging
```

Access Grafana at: `http://<EXTERNAL-IP>:3000`

Default credentials:
- Username: `admin`
- Password: (the one you set in the secret)

### Access Prometheus (Internal)
```bash
# Production
kubectl port-forward -n monitoring-prod svc/prometheus 9090:9090

# Staging
kubectl port-forward -n monitoring-staging svc/prometheus 9091:9090
```

Then open: `http://localhost:9090` (or 9091 for staging)

## Verify Deployment

```bash
# Check production monitoring pods
kubectl get pods -n monitoring-prod

# Check staging monitoring pods
kubectl get pods -n monitoring-staging

# Expected output:
# NAME                          READY   STATUS    RESTARTS   AGE
# prometheus-xxxxxxxxxx-xxxxx   1/1     Running   0          2m
# grafana-xxxxxxxxxx-xxxxx      1/1     Running   0          2m

# Check services for both environments
kubectl get svc -n monitoring-prod
kubectl get svc -n monitoring-staging

# View Prometheus logs
kubectl logs -n monitoring-prod -l app=prometheus -f
kubectl logs -n monitoring-staging -l app=prometheus -f

# View Grafana logs
kubectl logs -n monitoring-prod -l app=grafana -f
kubectl logs -n monitoring-staging -l app=grafana -f
```

## Verify Metrics Collection

### Check Prometheus Targets
1. Port-forward Prometheus: `kubectl port-forward -n monitoring svc/prometheus 9090:9090`
2. Open http://localhost:9090/targets
3. Verify `jomo-backend-production` and `jomo-backend-staging` targets are UP

### Check Grafana Dashboard
1. Access Grafana via LoadBalancer URL
2. Login with admin credentials
3. Prometheus datasource should be automatically configured
4. Import dashboard from `monitoring/grafana/dashboards/jomobit-overview.json`

## Alert Rules

The following alerts are configured:

- **JomobitServiceDown**: Triggers when the backend is unreachable
- **JomobitHigh5xxErrorRate**: Triggers when 5xx errors exceed 5%
- **JomobitP95LatencyHigh**: Triggers when P95 latency exceeds 1.5s
- **JomobitPodMemoryPressure**: Triggers when pod memory usage exceeds 90%

View active alerts:
```bash
kubectl port-forward -n monitoring svc/prometheus 9090:9090
# Open http://localhost:9090/alerts
```

## Troubleshooting

### Pods not starting
```bash
# Check pod status
kubectl describe pod -n monitoring <pod-name>

# Check logs
kubectl logs -n monitoring <pod-name>
```

### PVC not binding
```bash
# Check PVC status
kubectl get pvc -n monitoring

# Check storage class
kubectl get storageclass
```

### Prometheus not scraping metrics
```bash
# Check Prometheus config
kubectl get configmap prometheus-config -n monitoring -o yaml

# Verify app pods have /metrics endpoint
kubectl port-forward -n production <app-pod-name> 3000:3000
curl http://localhost:3000/metrics
```

## Clean Up

To remove the monitoring stack:
```bash
kubectl delete namespace monitoring
```

## Alternative: Local Development Monitoring

For local development, use Docker Compose:
```bash
npm run monitoring:up
```

This starts the full monitoring stack locally with Nginx gateway at http://localhost:3000
