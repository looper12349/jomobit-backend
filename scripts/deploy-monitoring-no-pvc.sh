#!/bin/bash

set -e

echo "🚀 Deploying Monitoring Stack WITHOUT Persistent Storage..."
echo ""
echo "⚠️  WARNING: Using emptyDir - data will be lost on pod restart!"
echo "This is for testing/development only."
echo ""

# Check which environment
if [ -z "$1" ]; then
    echo "Usage: $0 [production|staging]"
    echo "Example: $0 staging"
    exit 1
fi

ENV=$1

if [ "$ENV" == "production" ]; then
    NS="monitoring-prod"
    APP_NS="production"
elif [ "$ENV" == "staging" ]; then
    NS="monitoring-staging"
    APP_NS="staging"
else
    echo "Invalid environment. Use 'production' or 'staging'"
    exit 1
fi

echo "Environment: $ENV"
echo "Namespace: $NS"
echo "App Namespace: $APP_NS"
echo ""

# Create namespace
echo "📦 Creating namespace..."
kubectl create namespace $NS --dry-run=client -o yaml | kubectl apply -f -
kubectl label namespace $NS environment=$ENV --overwrite

# Setup RBAC
echo "🔐 Setting up RBAC..."
sed "s/namespace: monitoring/namespace: $NS/g" k8s/monitoring/prometheus-rbac.yaml | kubectl apply -f -

# Create Grafana secret
echo "🔑 Creating Grafana secret..."
read -sp "Enter Grafana admin password: " GRAFANA_PASSWORD
echo
kubectl create secret generic grafana-secrets \
  --namespace=$NS \
  --from-literal=admin-password="$GRAFANA_PASSWORD" \
  --dry-run=client -o yaml | kubectl apply -f -

# Deploy Prometheus (no PVC)
echo "📊 Deploying Prometheus (no PVC)..."
sed "s/namespace: monitoring/namespace: $NS/g" k8s/monitoring/prometheus-alerts.yaml | kubectl apply -f -
sed "s/namespace: monitoring/namespace: $NS/g" k8s/monitoring/prometheus-deployment-no-pvc.yaml | kubectl apply -f -

# Create Prometheus config
echo "⚙️  Creating Prometheus config..."
cat <<EOF | kubectl apply -f -
apiVersion: v1
kind: ConfigMap
metadata:
  name: prometheus-config
  namespace: $NS
data:
  prometheus.yml: |
    global:
      scrape_interval: 15s
      evaluation_interval: 15s
    
    rule_files:
      - '/etc/prometheus/rules/*.yml'
    
    scrape_configs:
      - job_name: 'jomo-backend-$ENV'
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
          - source_labels: [__meta_kubernetes_namespace]
            target_label: namespace
          - source_labels: [__meta_kubernetes_pod_name]
            target_label: pod
EOF

# Deploy Grafana (no PVC)
echo "📈 Deploying Grafana (no PVC)..."
sed "s/namespace: monitoring/namespace: $NS/g" k8s/monitoring/grafana-datasource.yaml | kubectl apply -f -
sed "s/namespace: monitoring/namespace: $NS/g" k8s/monitoring/grafana-deployment-no-pvc.yaml | kubectl apply -f -

# Deploy Ingress
echo "🌐 Deploying Ingress..."
if [ "$ENV" == "production" ]; then
    kubectl apply -f k8s/monitoring/ingress-prod.yaml
else
    kubectl apply -f k8s/monitoring/ingress-staging.yaml
fi

echo ""
echo "⏳ Waiting for pods to start..."
kubectl wait --for=condition=available --timeout=120s deployment/prometheus -n $NS || echo "⚠️  Prometheus timeout"
kubectl wait --for=condition=available --timeout=120s deployment/grafana -n $NS || echo "⚠️  Grafana timeout"

echo ""
echo "✅ Deployment complete!"
echo ""
echo "📊 Status:"
kubectl get pods -n $NS
echo ""
kubectl get svc -n $NS
echo ""
kubectl get ingress -n $NS
echo ""

if [ "$ENV" == "production" ]; then
    echo "🌐 Access URLs:"
    echo "Grafana:    https://api.jomo.dazzeldigital.com/grafana"
    echo "Prometheus: https://api.jomo.dazzeldigital.com/prometheus"
else
    echo "🌐 Access URLs:"
    echo "Grafana:    https://api-dev-jomo.dazzeldigital.com/grafana"
    echo "Prometheus: https://api-dev-jomo.dazzeldigital.com/prometheus"
fi
