#!/usr/bin/env bash
# One-time cluster bootstrap, run after:
#   eksctl create cluster -f infra/cluster.yaml
#
# Installs what the CI pipeline assumes already exists. Safe to re-run.
#
#   AWS_PROFILE=jomo bash scripts/bootstrap-cluster.sh
set -euo pipefail

CLUSTER=4-jomo-cluster
REGION=ap-south-1
INGRESS_NGINX_CHART=4.15.1      # controller v1.15.1 (final upstream release)
CERT_MANAGER_VERSION=v1.21.2    # keep in sync with .github/workflows/cicd.yml
CI_ROLE_NAME=github-actions-jomo-deploy

ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
CI_ROLE_ARN="arn:aws:iam::${ACCOUNT_ID}:role/${CI_ROLE_NAME}"

hdr() { echo ""; echo "=== $1 ==="; }

hdr "kubeconfig"
aws eks update-kubeconfig --region "$REGION" --name "$CLUSTER"

# The monitoring PVCs reference storageClassName gp2. Back it with gp3
# (cheaper and faster than gp2) via the EBS CSI driver.
hdr "1. StorageClass gp2 (gp3-backed)"
if kubectl get storageclass gp2 >/dev/null 2>&1; then
  echo "gp2 already exists"
else
  kubectl apply -f - <<'EOF'
apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: gp2
  annotations:
    storageclass.kubernetes.io/is-default-class: "true"
provisioner: ebs.csi.aws.com
volumeBindingMode: WaitForFirstConsumer
allowVolumeExpansion: true
reclaimPolicy: Delete
parameters:
  type: gp3
  encrypted: "true"
EOF
fi

# externalTrafficPolicy=Local keeps the real client IP (the NLB does not add
# X-Forwarded-For), so the app's per-IP rate limits see users, not nodes.
hdr "2. ingress-nginx behind an internet-facing NLB"
helm repo add ingress-nginx https://kubernetes.github.io/ingress-nginx >/dev/null 2>&1 || true
helm repo update ingress-nginx >/dev/null
helm upgrade --install ingress-nginx ingress-nginx/ingress-nginx \
  --version "$INGRESS_NGINX_CHART" \
  --namespace ingress-nginx --create-namespace \
  --set controller.service.type=LoadBalancer \
  --set controller.service.externalTrafficPolicy=Local \
  --set controller.service.annotations."service\.beta\.kubernetes\.io/aws-load-balancer-type"=nlb \
  --set controller.service.annotations."service\.beta\.kubernetes\.io/aws-load-balancer-scheme"=internet-facing \
  --set controller.config.use-forwarded-headers="true" \
  --set controller.config.proxy-body-size=10m \
  --set controller.resources.requests.cpu=50m \
  --set controller.resources.requests.memory=96Mi \
  --wait --timeout 10m

hdr "3. cert-manager $CERT_MANAGER_VERSION + Let's Encrypt issuer"
kubectl apply -f "https://github.com/cert-manager/cert-manager/releases/download/${CERT_MANAGER_VERSION}/cert-manager.yaml"
kubectl -n cert-manager wait --for=condition=available --timeout=300s \
  deployment/cert-manager deployment/cert-manager-webhook deployment/cert-manager-cainjector
kubectl apply -f k8s/cert-manager-issuer.yaml

# CI authenticates with GitHub OIDC (no stored AWS keys). Its IAM role only
# has eks:DescribeCluster; Kubernetes permissions come from this access entry.
hdr "4. EKS access entry for the CI role"
if aws eks describe-access-entry --cluster-name "$CLUSTER" --principal-arn "$CI_ROLE_ARN" >/dev/null 2>&1; then
  echo "access entry already exists"
else
  aws eks create-access-entry --cluster-name "$CLUSTER" --principal-arn "$CI_ROLE_ARN" >/dev/null
fi
aws eks associate-access-policy --cluster-name "$CLUSTER" --principal-arn "$CI_ROLE_ARN" \
  --policy-arn arn:aws:eks::aws:cluster-access-policy/AmazonEKSClusterAdminPolicy \
  --access-scope type=cluster >/dev/null

hdr "Done"
echo "Load balancer (point the api-dev CNAME here):"
kubectl get svc -n ingress-nginx ingress-nginx-controller \
  -o jsonpath='{.status.loadBalancer.ingress[0].hostname}{"\n"}'
echo ""
echo "Node public IPs (add to the MongoDB Atlas allowlist):"
kubectl get nodes -o jsonpath='{range .items[*]}{.status.addresses[?(@.type=="ExternalIP")].address}{"\n"}{end}'
