# DNS Update Required

## Current Status ✅

All services are working on the new nginx ingress controller!

### Test Results:
- ✅ Grafana: `http://ac0313d2e870f42a9a775e60144d1f3a-799e9ec9e60eab7b.elb.ap-south-1.amazonaws.com/grafana/`
- ✅ Prometheus: `http://ac0313d2e870f42a9a775e60144d1f3a-799e9ec9e60eab7b.elb.ap-south-1.amazonaws.com/prometheus/`
- ✅ Application API: `http://ac0313d2e870f42a9a775e60144d1f3a-799e9ec9e60eab7b.elb.ap-south-1.amazonaws.com/api/health`

## Action Required: Update DNS

### Current DNS:
```
api-dev-jomo.dazzeldigital.com → aa42c7b292285409ba2d300cdb12a265-2030774719.ap-south-1.elb.amazonaws.com
```

### New DNS (Required):
```
api-dev-jomo.dazzeldigital.com → ac0313d2e870f42a9a775e60144d1f3a-799e9ec9e60eab7b.elb.ap-south-1.amazonaws.com
```

## Steps to Update DNS:

1. Go to your DNS provider (Route53, Cloudflare, etc.)
2. Find the CNAME record for `api-dev-jomo.dazzeldigital.com`
3. Update it to point to: `ac0313d2e870f42a9a775e60144d1f3a-799e9ec9e60eab7b.elb.ap-south-1.amazonaws.com`
4. Wait 5-10 minutes for DNS propagation

## After DNS Update:

Test your endpoints:
```bash
# Application API
curl -I https://api-dev-jomo.dazzeldigital.com/api/health

# Grafana (login page)
curl -I https://api-dev-jomo.dazzeldigital.com/grafana/

# Prometheus
curl -I https://api-dev-jomo.dazzeldigital.com/prometheus/
```

## What Changed:

1. Created a unified ingress for staging that includes:
   - Application API at `/api`
   - Grafana at `/grafana`
   - Prometheus at `/prometheus`

2. All services now use the nginx ingress controller (single LoadBalancer)

3. Your old LoadBalancer service can be removed after DNS update:
   ```bash
   # After confirming everything works
   kubectl patch svc jomo-backend-service -n staging -p '{"spec":{"type":"ClusterIP"}}'
   ```

## Grafana Login:

Default credentials (change after first login):
- Username: `admin`
- Password: Check the secret with:
  ```bash
  kubectl get secret grafana-secrets -n monitoring-staging -o jsonpath='{.data.admin-password}' | base64 -d
  ```
