#!/bin/bash

set -e

echo "🚀 Deploying Monitoring Stack to Kubernetes..."

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if kubectl is available
if ! command -v kubectl &> /dev/null; then
    echo "❌ kubectl not found. Please install kubectl first."
    exit 1
fi

# Create namespace
echo -e "${YELLOW}Creating monitoring namespace...${NC}"
kubectl apply -f k8s/monitoring/namespace.yaml

# Create RBAC
echo -e "${YELLOW}Setting up Prometheus RBAC...${NC}"
kubectl apply -f k8s/monitoring/prometheus-rbac.yaml

# Create Grafana secret if it doesn't exist
if ! kubectl get secret grafana-secrets -n monitoring &> /dev/null; then
    echo -e "${YELLOW}Creating Grafana admin password secret...${NC}"
    read -sp "Enter Grafana admin password: " GRAFANA_PASSWORD
    echo
    kubectl create secret generic grafana-secrets \
      --namespace=monitoring \
      --from-literal=admin-password="$GRAFANA_PASSWORD"
else
    echo -e "${GREEN}✓ Grafana secret already exists${NC}"
fi

# Deploy Prometheus
echo -e "${YELLOW}Deploying Prometheus...${NC}"
kubectl apply -f k8s/monitoring/prometheus-pvc.yaml
kubectl apply -f k8s/monitoring/prometheus-config.yaml
kubectl apply -f k8s/monitoring/prometheus-alerts.yaml
kubectl apply -f k8s/monitoring/prometheus-deployment.yaml

# Deploy Grafana
echo -e "${YELLOW}Deploying Grafana...${NC}"
kubectl apply -f k8s/monitoring/grafana-pvc.yaml
kubectl apply -f k8s/monitoring/grafana-datasource.yaml
kubectl apply -f k8s/monitoring/grafana-deployment.yaml

# Wait for deployments
echo -e "${YELLOW}Waiting for deployments to be ready...${NC}"
kubectl wait --for=condition=available --timeout=300s \
  deployment/prometheus -n monitoring || true
kubectl wait --for=condition=available --timeout=300s \
  deployment/grafana -n monitoring || true

# Show status
echo -e "${GREEN}✓ Monitoring stack deployed!${NC}"
echo ""
echo "📊 Status:"
kubectl get pods -n monitoring
echo ""
kubectl get svc -n monitoring
echo ""
echo -e "${GREEN}Access Grafana:${NC}"
echo "Run: kubectl get svc grafana -n monitoring"
echo "Or port-forward: kubectl port-forward -n monitoring svc/grafana 3001:3000"
