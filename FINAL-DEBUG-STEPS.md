# 🔧 Final Debug Steps - LoadBalancer Not Assigned

## Issue

The ingress was created but has no LoadBalancer address assigned.

## Run This Now

```bash
./scripts/debug-ingress-now.sh
```

This will show us:
1. Is the ingress controller running?
2. Does the ingress controller have a LoadBalancer?
3. What's the ingress status?
4. What do the logs say?

## Most Likely Issues

### Issue 1: Ingress Controller Not Ready

**Check**:
```bash
kubectl get pods -n ingress-nginx
```

**Expected**: All pods should be `Running` and `READY 1/1`

**If not ready**: Wait 2-3 minutes for the controller to start.

### Issue 2: Ingress Controller Service Has No LoadBalancer

**Check**:
```bash
kubectl get svc ingress-nginx-controller -n ingress-nginx
```

**Expected**: Should have an EXTERNAL-IP (AWS ELB hostname)

**If pending**: Wait 2-3 minutes for AWS to provision the LoadBalancer.

### Issue 3: IngressClass Mismatch

**Check**:
```bash
kubectl get ingressclass
kubectl get ingress monitoring-ingress -n monitoring-staging -o yaml | grep ingressClassName
```

**Expected**: 
- IngressClass `nginx` should exist
- Ingress should have `ingressClassName: nginx`

## Quick Fixes

### Fix 1: Wait for Ingress Controller

The ingress controller was just installed. Wait 2-3 minutes:

```bash
# Watch the ingress controller pods
kubectl get pods -n ingress-nginx -w

# Wait until all are Running
# Then check the service
kubectl get svc ingress-nginx-controller -n ingress-nginx

# Wait until EXTERNAL-IP is assigned (not <pending>)
```

### Fix 2: Check Ingress After Controller is Ready

```bash
# Wait for controller
sleep 120

# Check ingress again
kubectl get ingress -n monitoring-staging

# Should now have ADDRESS
```

### Fix 3: If Still No Address, Recreate Ingress

```bash
kubectl delete ingress monitoring-ingress -n monitoring-staging
kubectl apply -f k8s/monitoring/ingress-staging.yaml

# Wait
sleep 30

# Check
kubectl get ingress -n monitoring-staging
```

## Step-by-Step Resolution

### Step 1: Verify Ingress Controller is Running

```bash
kubectl get pods -n ingress-nginx

# Expected output:
# NAME                                        READY   STATUS    RESTARTS   AGE
# ingress-nginx-controller-xxxxxxxxxx-xxxxx   1/1     Running   0          5m
```

If STATUS is not `Running`, wait a few minutes.

### Step 2: Verify LoadBalancer Service

```bash
kubectl get svc ingress-nginx-controller -n ingress-nginx

# Expected output:
# NAME                       TYPE           EXTERNAL-IP
# ingress-nginx-controller   LoadBalancer   ac0313d2e870f42a9...elb.amazonaws.com
```

If EXTERNAL-IP is `<pending>`, wait for AWS to provision it (2-3 minutes).

### Step 3: Check Ingress Gets Address

```bash
kubectl get ingress -n monitoring-staging

# Expected output:
# NAME                 ADDRESS
# monitoring-ingress   ac0313d2e870f42a9...elb.amazonaws.com
```

The ADDRESS should match the ingress controller's EXTERNAL-IP.

### Step 4: Test the LoadBalancer

```bash
LB=$(kubectl get svc ingress-nginx-controller -n ingress-nginx -o jsonpath='{.status.loadBalancer.ingress[0].hostname}')
echo "LoadBalancer: $LB"

curl -I http://$LB/grafana
```

## If Nothing Works

### Option A: Use Port-Forward (Bypass Ingress)

```bash
# Access Grafana directly
kubectl port-forward -n monitoring-staging svc/grafana 3000:3000

# Open: http://localhost:3000/grafana
```

### Option B: Check Ingress Controller Logs

```bash
kubectl logs -n ingress-nginx -l app.kubernetes.io/name=ingress-nginx --tail=100
```

Look for errors related to:
- IngressClass not found
- Backend service not found
- Configuration errors

### Option C: Verify Services Exist

```bash
kubectl get svc -n monitoring-staging

# Should show:
# grafana      ClusterIP   10.100.x.x   <none>   3000/TCP
# prometheus   ClusterIP   10.100.x.x   <none>   9090/TCP
```

## Timeline

- **0-2 minutes**: Ingress controller pods starting
- **2-5 minutes**: AWS provisioning LoadBalancer
- **5+ minutes**: Ingress should have ADDRESS

If after 5 minutes there's still no ADDRESS, run the debug script and share the output.

## Commands to Run Now

```bash
# 1. Check ingress controller status
kubectl get pods -n ingress-nginx
kubectl get svc ingress-nginx-controller -n ingress-nginx

# 2. Wait if needed
sleep 120

# 3. Check ingress again
kubectl get ingress -n monitoring-staging

# 4. If ADDRESS is populated, test it
LB=$(kubectl get ingress monitoring-ingress -n monitoring-staging -o jsonpath='{.status.loadBalancer.ingress[0].hostname}')
curl -I http://$LB/grafana
```

## Summary

The most likely issue is that the ingress controller was just installed and needs time to:
1. Start the pods (1-2 minutes)
2. Provision the AWS LoadBalancer (2-3 minutes)
3. Assign the LoadBalancer to the ingress (30 seconds)

**Total wait time: ~5 minutes**

Run `./scripts/debug-ingress-now.sh` to see the current status!
