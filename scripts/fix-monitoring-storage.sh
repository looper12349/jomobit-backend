#!/bin/bash

set -e

echo "🔧 Fixing Monitoring Storage Issues..."
echo ""

# Check which environment to fix
if [ -z "$1" ]; then
    echo "Usage: $0 [production|staging|both]"
    echo "Example: $0 staging"
    exit 1
fi

ENV=$1

fix_namespace() {
    local NS=$1
    echo "🗑️  Cleaning up $NS namespace..."
    
    # Delete the namespace (this will delete everything in it)
    kubectl delete namespace $NS --ignore-not-found=true
    
    echo "⏳ Waiting for namespace to be fully deleted..."
    kubectl wait --for=delete namespace/$NS --timeout=60s 2>/dev/null || true
    
    echo "✅ $NS cleaned up"
    echo ""
}

if [ "$ENV" == "production" ] || [ "$ENV" == "both" ]; then
    fix_namespace "monitoring-prod"
fi

if [ "$ENV" == "staging" ] || [ "$ENV" == "both" ]; then
    fix_namespace "monitoring-staging"
fi

echo "✅ Cleanup complete!"
echo ""
echo "📋 Next steps:"
echo "1. Check available storage classes: kubectl get storageclass"
echo "2. Update PVC files if needed (k8s/monitoring/*-pvc.yaml)"
echo "3. Push your code to redeploy: git push origin <branch>"
echo ""
echo "Or manually deploy:"
echo "  ./scripts/deploy-monitoring.sh"
