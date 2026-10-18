#!/usr/bin/env bash
# Complete AWS teardown for the Jomobit EKS deployment — takes the bill to $0.
#
#   bash TEARDOWN-AWS.sh            # dry run: shows what WOULD be deleted
#   bash TEARDOWN-AWS.sh --execute  # actually delete (asks for typed confirmation)
#
# WARNING: this takes https://api-dev.amritesh.dev offline. The live frontend at
# jomo.dazzeldigital.com has that URL compiled into its bundle. Repoint the
# frontend BEFORE running this, or the product goes down.

set -uo pipefail
REGION=ap-south-1
CLUSTER=4-jomo-cluster
export AWS_PROFILE="${AWS_PROFILE:-jomo}"
export AWS_REGION="$REGION"
EXECUTE=false
[ "${1:-}" = "--execute" ] && EXECUTE=true

# Fail loudly rather than silently reporting an empty account. Without this, a
# credential problem makes every query return nothing, which reads as "already
# deleted" — the most dangerous possible false positive in a teardown script.
if ! aws sts get-caller-identity >/dev/null 2>&1; then
  echo "ERROR: AWS credentials not working for profile '$AWS_PROFILE'."
  echo "       Run 'aws configure --profile $AWS_PROFILE', or export AWS_PROFILE=<correct>."
  echo "       Refusing to continue: an unauthenticated run looks identical to an empty account."
  exit 1
fi

run() {
  if $EXECUTE; then echo "  + $*"; "$@"
  else echo "  [dry-run] $*"; fi
}
hdr() { echo ""; echo "=== $1 ==="; }

hdr "Target"
aws sts get-caller-identity --query '{account:Account,user:Arn}' --output table 2>/dev/null
echo "  region:  $REGION"
echo "  cluster: $CLUSTER"
echo "  mode:    $($EXECUTE && echo 'EXECUTE — resources WILL be deleted' || echo 'DRY RUN')"

if $EXECUTE; then
  hdr "Confirmation"
  echo "  This permanently deletes the EKS cluster, both nodes, the load balancer,"
  echo "  the NAT gateway and all EBS volumes (including Prometheus/Grafana data)."
  echo "  https://api-dev.amritesh.dev WILL GO OFFLINE."
  echo ""
  read -r -p "  Type the cluster name ($CLUSTER) to proceed: " reply
  [ "$reply" = "$CLUSTER" ] || { echo "  Aborted."; exit 1; }
fi

# ---- 1. Kubernetes LoadBalancers FIRST ----
# An orphaned NLB holds ENIs in the VPC and makes the eksctl VPC delete fail.
hdr "1. Removing Kubernetes load balancers"
if aws eks update-kubeconfig --region "$REGION" --name "$CLUSTER" >/dev/null 2>&1; then
  run helm uninstall ingress-nginx -n ingress-nginx
  run kubectl delete svc --all-namespaces --field-selector spec.type=LoadBalancer --ignore-not-found
  echo "  waiting for the NLB to deprovision..."
  $EXECUTE && sleep 45
else
  echo "  cluster unreachable — skipping (will sweep orphans in step 4)"
fi

# ---- 2. Namespaces with PVCs (releases the EBS volumes) ----
hdr "2. Deleting namespaces (releases PVC-backed EBS volumes)"
run kubectl delete namespace staging monitoring-staging production monitoring-prod --ignore-not-found
$EXECUTE && sleep 20

# ---- 3. The cluster itself ----
hdr "3. Deleting the EKS cluster (15-20 min)"
if command -v eksctl >/dev/null 2>&1; then
  run eksctl delete cluster --region "$REGION" --name "$CLUSTER" --wait --disable-nodegroup-eviction
else
  echo "  eksctl not installed — falling back to CloudFormation"
  for s in "eksctl-$CLUSTER-nodegroup-ng-general" "eksctl-$CLUSTER-cluster"; do
    run aws cloudformation delete-stack --region "$REGION" --stack-name "$s"
  done
fi

# ---- 4. Sweep anything eksctl left behind ----
hdr "4. Sweeping orphaned resources"

for lb in $(aws elbv2 describe-load-balancers --region "$REGION" --query 'LoadBalancers[].LoadBalancerArn' --output text 2>/dev/null); do
  run aws elbv2 delete-load-balancer --region "$REGION" --load-balancer-arn "$lb"
done

for nat in $(aws ec2 describe-nat-gateways --region "$REGION" --filter "Name=state,Values=available,pending" --query 'NatGateways[].NatGatewayId' --output text 2>/dev/null); do
  run aws ec2 delete-nat-gateway --region "$REGION" --nat-gateway-id "$nat"
done

for eip in $(aws ec2 describe-addresses --region "$REGION" --query 'Addresses[?AssociationId==null].AllocationId' --output text 2>/dev/null); do
  run aws ec2 release-address --region "$REGION" --allocation-id "$eip"
done

for vol in $(aws ec2 describe-volumes --region "$REGION" --filters Name=status,Values=available --query 'Volumes[].VolumeId' --output text 2>/dev/null); do
  run aws ec2 delete-volume --region "$REGION" --volume-id "$vol"
done

for st in $(aws cloudformation list-stacks --region "$REGION" --stack-status-filter DELETE_FAILED --query 'StackSummaries[].StackName' --output text 2>/dev/null); do
  echo "  !! stack stuck in DELETE_FAILED: $st — delete it in the CloudFormation console"
done

# ---- 5. CI credentials ----
hdr "5. CI IAM user (optional — no cost, but it is a live credential)"
echo "  To remove the GitHub Actions user as well:"
echo "    aws iam delete-access-key --user-name github-actions-jomo --access-key-id <ID>"
echo "    aws iam delete-user-policy --user-name github-actions-jomo --policy-name eks-describe-cluster"
echo "    aws iam delete-user --user-name github-actions-jomo"

# ---- 6. Verify ----
# Each check must come back empty. Anything still listed is still billing, so
# the script reports FAILURE rather than assuming the delete commands worked —
# a transient DNS or API error can leave the cluster running.
hdr "6. Verification — everything below must be empty"
leftover=0
check() { # name, value
  local v="${2:-}"
  if [ -z "$v" ] || [ "$v" = "None" ]; then
    printf "  %-14s clear\n" "$1"
  else
    printf "  %-14s STILL PRESENT: %s\n" "$1" "$v"; leftover=$((leftover+1))
  fi
}
check "EKS clusters" "$(aws eks list-clusters --region "$REGION" --query 'clusters' --output text 2>/dev/null)"
check "EC2"          "$(aws ec2 describe-instances --region "$REGION" --filters Name=instance-state-name,Values=running,stopped,stopping --query 'Reservations[].Instances[].InstanceId' --output text 2>/dev/null)"
check "Load bals"    "$(aws elbv2 describe-load-balancers --region "$REGION" --query 'LoadBalancers[].LoadBalancerName' --output text 2>/dev/null)"
check "NAT gateways" "$(aws ec2 describe-nat-gateways --region "$REGION" --filter Name=state,Values=available,pending --query 'NatGateways[].NatGatewayId' --output text 2>/dev/null)"
check "Elastic IPs"  "$(aws ec2 describe-addresses --region "$REGION" --query 'Addresses[].AllocationId' --output text 2>/dev/null)"
check "EBS volumes"  "$(aws ec2 describe-volumes --region "$REGION" --query 'Volumes[].VolumeId' --output text 2>/dev/null)"
check "CFN stacks"   "$(aws cloudformation list-stacks --region "$REGION" --stack-status-filter CREATE_COMPLETE DELETE_FAILED --query 'StackSummaries[].StackName' --output text 2>/dev/null)"

echo ""
if ! $EXECUTE; then
  echo "  Dry run only. Re-run with --execute to delete."
elif [ "$leftover" -eq 0 ]; then
  echo "  TEARDOWN COMPLETE — nothing billable remains."
  echo "  Cost Explorer lags ~24h, so today's figure will not be \$0 yet."
else
  echo "  TEARDOWN INCOMPLETE — $leftover resource group(s) still present and still billing."
  echo "  Re-run this script. If it keeps failing, delete the stacks in the"
  echo "  CloudFormation console: https://$REGION.console.aws.amazon.com/cloudformation"
  exit 1
fi
echo ""
