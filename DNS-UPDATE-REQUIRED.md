# ⚠️ DNS UPDATE REQUIRED

## Current Situation

Your DNS is still pointing to the OLD LoadBalancer:

```
Current DNS:
api-dev-jomo.dazzeldigital.com → aa42c7b292285409ba2d300cdb12a265-2030774719.ap-south-1.elb.amazonaws.com
                                  ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
                                  OLD LoadBalancer (no monitoring)
```

This is why:
- ✅ `/api` works (old LoadBalancer has your app)
- ❌ `/grafana` returns 404 (old LoadBalancer doesn't have monitoring)
- ❌ `/prometheus` returns 404 (old LoadBalancer doesn't have monitoring)

## Required DNS Change

Update your DNS CNAME record:

```
FROM: aa42c7b292285409ba2d300cdb12a265-2030774719.ap-south-1.elb.amazonaws.com
TO:   ac0313d2e870f42a9a775e60144d1f3a-799e9ec9e60eab7b.elb.ap-south-1.amazonaws.com
      ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
      NEW LoadBalancer (has app + monitoring)
```

## How to Update DNS

### If using AWS Route53:
1. Go to Route53 console
2. Find hosted zone for `dazzeldigital.com`
3. Find record `api-dev-jomo.dazzeldigital.com`
4. Edit the CNAME value to: `ac0313d2e870f42a9a775e60144d1f3a-799e9ec9e60eab7b.elb.ap-south-1.amazonaws.com`
5. Save changes

### If using Cloudflare:
1. Go to Cloudflare dashboard
2. Select domain `dazzeldigital.com`
3. Go to DNS settings
4. Find record `api-dev-jomo`
5. Edit the target to: `ac0313d2e870f42a9a775e60144d1f3a-799e9ec9e60eab7b.elb.ap-south-1.amazonaws.com`
6. Save changes

### If using other DNS provider:
1. Log into your DNS provider
2. Find the CNAME record for `api-dev-jomo.dazzeldigital.com`
3. Update it to point to: `ac0313d2e870f42a9a775e60144d1f3a-799e9ec9e60eab7b.elb.ap-south-1.amazonaws.com`
4. Save changes

## After DNS Update

Wait 5-10 minutes for DNS propagation, then run:

```bash
./scripts/test-after-dns-update.sh
```

You should see:
- ✅ `/api/health` → HTTP 200 OK
- ✅ `/grafana/` → HTTP 302 Found (redirect to login)
- ✅ `/prometheus/` → HTTP 405 Method Not Allowed (HEAD not supported, but service is working)

## Verify DNS Change

Check if DNS has propagated:

```bash
nslookup api-dev-jomo.dazzeldigital.com
```

Look for:
```
api-dev-jomo.dazzeldigital.com  canonical name = ac0313d2e870f42a9a775e60144d1f3a-799e9ec9e60eab7b.elb.ap-south-1.amazonaws.com
                                                  ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
                                                  Should start with ac0313d2e870f42a9a775e60144d1f3a
```

## What's on the New LoadBalancer?

The new nginx ingress controller has ALL your services:

| Path | Service | Status |
|------|---------|--------|
| `/api` | Your application | ✅ Working |
| `/grafana` | Grafana monitoring | ✅ Working |
| `/prometheus` | Prometheus monitoring | ✅ Working |

All tested and confirmed working with the correct Host header.

## After Everything Works

Once DNS is updated and everything is working, you can clean up the old LoadBalancer:

```bash
# Convert the old LoadBalancer service to ClusterIP (no longer needed)
kubectl patch svc jomo-backend-service -n staging -p '{"spec":{"type":"ClusterIP"}}'
```

This will remove the old LoadBalancer and save costs.
