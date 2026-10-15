# 🚀 Monitoring Deployment Checklist

## Pre-Deployment (One-Time Setup)

- [ ] **Add GitHub Secret**
  - Go to: https://github.com/looper12349/jomobit-backend/settings/secrets/actions
  - Add secret: `GRAFANA_ADMIN_PASSWORD`
  - Use a strong password (you'll need this to login to Grafana)

## Deployment Steps

### 1. Commit and Push Changes
```bash
git add .
git commit -m "feat: add environment-isolated monitoring stack"
git push origin main  # For production
# OR
git push origin feature/scaling  # For staging
```

### 2. Monitor GitHub Actions
- [ ] Go to GitHub Actions tab
- [ ] Watch the workflow run
- [ ] Check "Deploy to Kubernetes" job succeeds
- [ ] Check "Deploy Monitoring Stack" job succeeds
- [ ] Note the Grafana URL from the logs

### 3. Verify Production Deployment (if pushed to main)
```bash
# Check pods are running
kubectl get pods -n monitoring-prod

# Get Grafana URL
kubectl get svc grafana -n monitoring-prod

# Expected output:
# NAME      TYPE           EXTERNAL-IP                    PORT(S)
# grafana   LoadBalancer   <aws-loadbalancer-url>         3000:xxxxx/TCP
```

### 4. Verify Staging Deployment (if pushed to feature branch)
```bash
# Check pods are running
kubectl get pods -n monitoring-staging

# Get Grafana URL
kubectl get svc grafana -n monitoring-staging
```

### 5. Access Grafana
- [ ] Open the LoadBalancer URL in browser: `http://<EXTERNAL-IP>:3000`
- [ ] Login with:
  - Username: `admin`
  - Password: `<your GRAFANA_ADMIN_PASSWORD>`
- [ ] Verify Prometheus datasource is configured (Configuration → Data Sources)

### 6. Import Dashboard
- [ ] In Grafana, go to: Dashboards → Import
- [ ] Click "Upload JSON file"
- [ ] Select: `monitoring/grafana/dashboards/jomobit-overview.json`
- [ ] Select datasource: "Prometheus"
- [ ] Click "Import"

### 7. Verify Metrics Collection
- [ ] Port-forward Prometheus:
  ```bash
  # Production
  kubectl port-forward -n monitoring-prod svc/prometheus 9090:9090
  # OR Staging
  kubectl port-forward -n monitoring-staging svc/prometheus 9091:9090
  ```
- [ ] Open: http://localhost:9090/targets
- [ ] Verify target `jomo-backend-production` or `jomo-backend-staging` is UP
- [ ] Check metrics are being scraped (Last Scrape should be recent)

### 8. Verify Alerts
- [ ] In Prometheus UI, go to: http://localhost:9090/alerts
- [ ] Verify 4 alert rules are loaded:
  - JomobitServiceDown
  - JomobitHigh5xxErrorRate
  - JomobitP95LatencyHigh
  - JomobitPodMemoryPressure

### 9. Test Dashboard
- [ ] Go back to Grafana dashboard
- [ ] Verify panels are showing data:
  - Request Rate
  - Error Rate
  - P95 Latency
  - Memory Usage
- [ ] If no data, wait 1-2 minutes for metrics to accumulate

## Post-Deployment Verification

### Quick Status Check
```bash
npm run monitoring:check
```

Expected output:
- ✓ Namespace exists
- ✓ Pods are running (2/2 ready)
- ✓ Services have external IPs
- ✓ Prometheus is ready
- ✓ Grafana is ready

### Test Application Metrics
```bash
# Port-forward to your app
kubectl port-forward -n production <app-pod-name> 3000:3000

# Check metrics endpoint
curl http://localhost:3000/metrics

# Should see output like:
# jomobit_http_requests_total{method="GET",route="/health",status_code="200"} 42
# jomobit_http_request_duration_seconds_bucket{le="0.1"} 38
```

## Troubleshooting

### Pods Not Starting
```bash
# Check pod status
kubectl get pods -n monitoring-prod -o wide

# Describe pod for events
kubectl describe pod -n monitoring-prod <pod-name>

# Check logs
kubectl logs -n monitoring-prod <pod-name>
```

### LoadBalancer Pending
```bash
# Check service
kubectl get svc grafana -n monitoring-prod

# If EXTERNAL-IP shows <pending>, wait 2-3 minutes
# AWS LoadBalancer takes time to provision

# Watch for changes
kubectl get svc grafana -n monitoring-prod -w
```

### Prometheus Not Scraping
```bash
# Check Prometheus config
kubectl get configmap prometheus-config -n monitoring-prod -o yaml

# Verify app namespace is correct
# Should match: production or staging

# Check if app pods expose /metrics
kubectl get pods -n production
kubectl port-forward -n production <app-pod> 3000:3000
curl http://localhost:3000/metrics
```

### Grafana Can't Connect to Prometheus
```bash
# Verify Prometheus service exists
kubectl get svc prometheus -n monitoring-prod

# Test connectivity from Grafana pod
kubectl exec -n monitoring-prod -it <grafana-pod> -- \
  wget -O- http://prometheus:9090/api/v1/status/config

# If fails, check datasource config
kubectl get configmap grafana-datasources -n monitoring-prod -o yaml
```

## Rollback (If Needed)

### Remove Monitoring Stack
```bash
# Production
kubectl delete namespace monitoring-prod

# Staging
kubectl delete namespace monitoring-staging
```

### Redeploy
```bash
# Trigger workflow manually
# Go to GitHub Actions → CI/CD Pipeline → Run workflow
# Select environment and action
```

## Success Criteria

✅ All pods in Running state
✅ Grafana accessible via LoadBalancer URL
✅ Can login to Grafana with admin credentials
✅ Prometheus datasource configured in Grafana
✅ Dashboard imported and showing data
✅ Prometheus targets showing UP status
✅ Alert rules loaded in Prometheus
✅ Metrics visible in dashboard panels

## Next Steps After Successful Deployment

1. [ ] Configure alert notifications (Slack, email, PagerDuty)
2. [ ] Create custom dashboards for specific use cases
3. [ ] Set up SLOs and SLIs based on business requirements
4. [ ] Document runbooks for common alerts
5. [ ] Schedule regular dashboard reviews with team
6. [ ] Set up automated dashboard backups
7. [ ] Configure Grafana user access and permissions

## Cost Monitoring

Monitor your AWS costs:
- [ ] Check EBS volume costs (30Gi total)
- [ ] Check LoadBalancer costs (2 LBs if both envs deployed)
- [ ] Expected: ~$38/month for both environments

## Documentation References

- **Quick Start**: `MONITORING-SETUP.md`
- **Environment Isolation**: `ENVIRONMENT-ISOLATION-SUMMARY.md`
- **Architecture**: `docs/MONITORING-ARCHITECTURE.md`
- **Detailed Guide**: `k8s/monitoring/README.md`
- **Quick Reference**: `k8s/monitoring/QUICK-START.md`

---

**Questions or Issues?**
Check the troubleshooting sections in the documentation or review GitHub Actions logs for detailed error messages.
