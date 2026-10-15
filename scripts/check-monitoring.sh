#!/bin/bash

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo "🔍 Checking Monitoring Stack Status..."
echo ""

# Function to check a specific environment
check_environment() {
    local env=$1
    local ns=$2
    
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${BLUE}Environment: $env${NC}"
    echo -e "${BLUE}Namespace: $ns${NC}"
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    
    # Check if namespace exists
    if kubectl get namespace $ns &> /dev/null; then
        echo -e "${GREEN}✓ Namespace exists${NC}"
    else
        echo -e "${YELLOW}⚠ Namespace not found (not deployed yet)${NC}"
        echo ""
        return
    fi

    echo ""
    echo "📦 Pod Status:"
    kubectl get pods -n $ns

    echo ""
    echo "🌐 Services:"
    kubectl get svc -n $ns

    echo ""
    echo "💾 Persistent Volume Claims:"
    kubectl get pvc -n $ns

    echo ""
    echo "📊 Grafana Access:"
    GRAFANA_URL=$(kubectl get svc grafana -n $ns -o jsonpath='{.status.loadBalancer.ingress[0].hostname}' 2>/dev/null)
    if [ -n "$GRAFANA_URL" ]; then
        echo -e "${GREEN}Grafana URL: http://${GRAFANA_URL}:3000${NC}"
        echo "Username: admin"
        echo "Password: (check your GRAFANA_ADMIN_PASSWORD secret)"
    else
        echo -e "${YELLOW}⏳ LoadBalancer URL pending...${NC}"
        echo "Run: kubectl get svc grafana -n $ns -w"
    fi

    # Check if Prometheus is ready
    PROM_READY=$(kubectl get pods -n $ns -l app=prometheus -o jsonpath='{.items[0].status.conditions[?(@.type=="Ready")].status}' 2>/dev/null)
    if [ "$PROM_READY" == "True" ]; then
        echo -e "${GREEN}✓ Prometheus is ready${NC}"
    else
        echo -e "${YELLOW}⏳ Prometheus is not ready yet${NC}"
    fi

    # Check if Grafana is ready
    GRAFANA_READY=$(kubectl get pods -n $ns -l app=grafana -o jsonpath='{.items[0].status.conditions[?(@.type=="Ready")].status}' 2>/dev/null)
    if [ "$GRAFANA_READY" == "True" ]; then
        echo -e "${GREEN}✓ Grafana is ready${NC}"
    else
        echo -e "${YELLOW}⏳ Grafana is not ready yet${NC}"
    fi
    
    echo ""
}

# Check both environments
check_environment "Production" "monitoring-prod"
check_environment "Staging" "monitoring-staging"

echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo "🎯 Quick Access Commands:"
echo ""
echo "Production Prometheus:"
echo "  kubectl port-forward -n monitoring-prod svc/prometheus 9090:9090"
echo ""
echo "Staging Prometheus:"
echo "  kubectl port-forward -n monitoring-staging svc/prometheus 9091:9090"
echo ""
echo "View Alerts:"
echo "  Open http://localhost:9090/alerts (after port-forward)"
echo ""
echo "📈 Next Steps:"
echo "1. Access Grafana and import dashboard from: monitoring/grafana/dashboards/jomobit-overview.json"
echo "2. Verify Prometheus is collecting metrics from your app pods"
echo "3. Test alerts by simulating high error rates or latency"
