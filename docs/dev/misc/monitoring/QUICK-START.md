# Quick Start Guide - Monitoring Stack

## 🚀 Automatic Deployment (Recommended)

The monitoring stack deploys automatically when you push code:

1. **Add GitHub Secret** (one-time setup):
   - Go to your repo → Settings → Secrets and variables → Actions
   - Add secret: `GRAFANA_ADMIN_PASSWORD` with a secure password

2. **Push your code**:
   ```bash
   git push origin main
   ```

3. **Check deployment status**:
   - Go to GitHub Actions tab
   - Look for "Deploy Monitoring Stack" job
   - Check the logs for Grafana URL

4. **Access Grafana**:
   - Get URL from GitHub Actions logs or run:
     ```bash
     kubectl get svc grafana -n monitoring
     ```
   - Login with username `admin` and your password

## 📊 What You Get

After deployment, you'll have:

✅ **Prometheus** - Collecting metrics every 15s from your app
✅ **Grafana** - Dashboard accessible via LoadBalancer URL
✅ **Alerts** - Automated monitoring for:
   - Service downtime
   - High error rates (>5% 5xx errors)
   - High latency (>1.5s P95)
   - Memory pressure (>90%)

## 🔍 Quick Commands

```bash
# View monitoring pods
kubectl get pods -n monitoring

# Get Grafana URL
kubectl get svc grafana -n monitoring

# Access Prometheus locally
kubectl port-forward -n monitoring svc/prometheus 9090:9090

# View Prometheus logs
kubectl logs -n monitoring -l app=prometheus -f

# View Grafana logs
kubectl logs -n monitoring -l app=grafana -f

# Check if metrics are being collected
kubectl port-forward -n monitoring svc/prometheus 9090:9090
# Then open http://localhost:9090/targets
```

## 📈 Import Dashboard

1. Access Grafana via LoadBalancer URL
2. Login with admin credentials
3. Go to Dashboards → Import
4. Upload `monitoring/grafana/dashboards/jomobit-overview.json`

## 🔧 Manual Deployment

If you need to deploy manually:

```bash
# Run the deployment script
./scripts/deploy-monitoring.sh
```

Or follow the detailed steps in [README.md](./README.md)

## ❓ Troubleshooting

**Grafana URL shows "pending"?**
- Wait 2-3 minutes for AWS LoadBalancer to provision
- Check: `kubectl get svc grafana -n monitoring -w`

**Can't access Grafana?**
- Verify pod is running: `kubectl get pods -n monitoring`
- Check logs: `kubectl logs -n monitoring -l app=grafana`

**Prometheus not collecting metrics?**
- Verify app pods expose /metrics: `kubectl port-forward -n production <pod> 3000:3000 && curl localhost:3000/metrics`
- Check Prometheus targets: Port-forward and visit http://localhost:9090/targets

**Need to reset Grafana password?**
```bash
kubectl delete secret grafana-secrets -n monitoring
kubectl create secret generic grafana-secrets \
  --namespace=monitoring \
  --from-literal=admin-password='new-password'
kubectl rollout restart deployment/grafana -n monitoring
```

## 🧹 Clean Up

To remove the monitoring stack:
```bash
kubectl delete namespace monitoring
```

## 📚 More Info

See [README.md](./README.md) for detailed documentation.
