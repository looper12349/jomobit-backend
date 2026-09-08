# Capstone Evidence Pack — Measured Values and How to Reproduce Them

Every figure quoted in the capstone report is listed here with the command that produces it.
Measurements taken **8 September 2026** against the `staging` environment of EKS cluster
`4-jomo-cluster` (ap-south-1), branch `feature/scaling`, commit `7a5e1d3`.

Where a value could not be measured, this document says so explicitly rather than estimating.

---

## 1. Cluster and environment

| Fact | Value | Command |
|---|---|---|
| Cluster type | Amazon EKS, managed control plane | `aws eks describe-cluster --name 4-jomo-cluster` |
| Kubernetes version | 1.31 | same |
| Region | ap-south-1 (Mumbai) | same |
| Cluster created | 2026-09-08T01:55:52+05:30 | same |
| Worker nodes | 2 × t3.medium | `kubectl get nodes -o custom-columns=...instance-type` |
| Namespaces | `staging`, `monitoring-staging`, `ingress-nginx`, `cert-manager` | `kubectl get ns` |
| Persistent volumes | Prometheus 10 Gi, Grafana 5 Gi (gp2/gp3-backed) | `kubectl get pvc -A` |
| Load balancers | 1 (nginx ingress controller NLB) | `kubectl get svc -A --field-selector spec.type=LoadBalancer` |

> The cluster was rebuilt from scratch on 8 September 2026 after the original AWS account was
> lost. **Any uptime claim longer than the cluster's age is not supportable**; see §7.

## 2. TLS

```
$ echo | openssl s_client -servername api-dev.amritesh.dev -connect api-dev.amritesh.dev:443 \
    | openssl x509 -noout -issuer -subject -dates

issuer=C=US, O=Let's Encrypt, CN=YR2
subject=CN=api-dev.amritesh.dev
notBefore=Sep  7 22:37:42 2026 GMT
notAfter=Dec  6 22:37:41 2026 GMT
```

Issued automatically by cert-manager via the `letsencrypt-prod` ClusterIssuer using an HTTP-01
challenge. 90-day validity, renewed automatically at 30 days remaining.

## 3. Container image

| Fact | Value |
|---|---|
| Repository | `ai29/jomo-backend` |
| Tag measured | `feature-scaling-7a5e1d3` |
| Compressed size (registry) | **77.3 MB** |
| Base image | `node:20-alpine` |
| Runs as | non-root, UID 1001 |
| Init | `dumb-init` (correct SIGTERM handling) |
| Container healthcheck | `HEALTHCHECK` against `/health` |

```bash
curl -s https://hub.docker.com/v2/repositories/ai29/jomo-backend/tags/feature-scaling-7a5e1d3 \
  | python3 -c "import sys,json;print(json.load(sys.stdin)['full_size']/1e6,'MB compressed')"
```

**Important qualification.** The repository contains two Dockerfiles:

- `Docker/Dockerfile` — a genuine two-stage build (builder + runtime)
- `Docker/Dockerfile.dev` — single-stage

**The CI/CD pipeline builds `Docker/Dockerfile.dev`** (`.github/workflows/cicd.yml`, `file:` key).
The deployed image is therefore the single-stage build. The multi-stage Dockerfile exists and
works but is not what ships. No before/after image-size comparison was recorded, so the
"60% reduction" figure cannot be substantiated and has been removed from the report.

## 4. Load testing (measured)

Test harness: `tests/load/k6-load-test.js`, run in-cluster via `k8s/load-test-job.yaml`
(k6 v0.49.0). Run against the ClusterIP Service, so the numbers reflect application capacity and
not the nginx ingress rate limit (`limit-rps: 50`).

Profile: ramp 20 → 60 → 120 virtual users over 3 minutes.

### Test A — `/api` (rate limiter active)

| Metric | Value |
|---|---|
| Total requests | 232,086 |
| Throughput | **1,289 req/s** |
| p95 latency | 110.38 ms |
| p90 / median | 85.47 ms / 30.67 ms |
| HTTP 200 | 8,000 (3.4%) |
| HTTP 429 | 224,086 (96.5%) |

The 429s are **correct behaviour, not failures**: `rateLimitConfigs.general` allows 1,000 requests
per 15 minutes per IP, and k6 ran from a single pod IP. This test demonstrates that rate limiting
works under load; it does not measure serving capacity.

### Test B — `/health` (no rate limiter) — the capacity measurement

| Metric | Target | Measured |
|---|---|---|
| Total requests | — | 182,054 |
| Sustained throughput | — | **1,011 req/s** |
| p95 latency | < 200 ms | **142.01 ms** ✅ |
| p90 latency | — | 98.41 ms |
| Median latency | — | 40.34 ms |
| Mean latency | — | 53.50 ms |
| Error rate | < 0.1% | **0.00%** (0 of 182,054) ✅ |

```bash
kubectl apply -f k8s/load-test-job.yaml
kubectl logs -n staging job/k6-load-test -f
```

**Qualification.** `/health` returns a small JSON payload and performs no database or AI-provider
work. This figure measures the HTTP serving path (Node.js, Express middleware, kube-proxy,
Service load balancing) under concurrency — it is **not** a measure of business-logic throughput.
An end-to-end authenticated load test against poster generation was not performed, because that
would consume real AI-provider credits against a live account.

## 5. Autoscaling (measured)

The HPA scaled from the 2-replica floor to the 10-replica ceiling during load test B:

```
$ kubectl get hpa jomo-backend-hpa -n staging
NAME               REFERENCE                 TARGETS         MINPODS  MAXPODS  REPLICAS
jomo-backend-hpa   Deployment/jomo-backend   cpu: 133%/70%   2        10       10
```

Observed replica progression, sampled every ~18 s from the start of load:

| Elapsed | Replicas | Ready |
|---|---|---|
| 0:00 | 2 | 2 |
| 0:19 | 3 | 2 |
| 0:39 | 5 | 3 |
| 0:58 | 6 | 5 |
| 1:18 | 6 | 6 |
| 1:37 | 10 | 8 |

Scale-up from 2 to 10 replicas completed in **under 100 seconds**. Scale-down returned to 2
replicas after the default 5-minute stabilisation window.

`kube_horizontalpodautoscaler_status_current_replicas` is recorded in Prometheus, so this is
visible historically on the Grafana "Autoscaling — Replicas" panel, not only at the CLI.

**Dependency worth recording:** the HPA reports `<unknown>` and never scales unless
metrics-server is healthy. On this cluster metrics-server was serving no endpoints (its Service
selector required a `k8s-app` label the pods did not carry); the HPA only became functional after
that was fixed.

## 6. Monitoring stack (measured)

| Fact | Value | Command |
|---|---|---|
| Prometheus scrape targets | 3, all `up` (2 app pods + kube-state-metrics) | `/prometheus/api/v1/targets` |
| Scrape interval | 15 s | `kubectl get cm prometheus-config -n monitoring-staging -o yaml` |
| Metrics retention | 30 days on a 10 Gi volume | Prometheus `--storage.tsdb.retention.time` |
| Alert rules loaded | 4, all `inactive` | `/prometheus/api/v1/rules` |
| Grafana dashboard panels | 11 | `/api/dashboards/uid/jomobit-overview` |
| Grafana datasource health | `Successfully queried the Prometheus API` | `/api/datasources/uid/prometheus/health` |

Application metrics exposed: `jomobit_http_requests_total`, `jomobit_http_request_duration_seconds`
(histogram), `jomobit_http_requests_in_progress`, `jomobit_app_info`, plus default Node.js process
metrics. Labels: `method`, `route`, `status_code`, `pod`, `namespace`, `environment`, `service`.

Alert rules: `JomobitHigh5xxErrorRate`, `JomobitP95LatencyHigh`, `JomobitServiceDown`,
`JomobitPodMemoryPressure`.

### Observability defect found and fixed

`metricsMiddleware` was registered **after** the rate limiters in `src/app.js`, so throttled
requests never reached it. Load test A produced 232,086 requests but Prometheus recorded only
6,488 — every 429 was invisible to monitoring.

After moving the middleware ahead of the rate limiters (commit `7a5e1d3`) and re-running the
identical test:

```
status_code   count      share
429           234,786    97.5%
200             6,029     2.5%
304                13     0.0%
```

This is a measurable before/after improvement: throttled traffic went from unobservable to fully
recorded, which matters because a rate-limit spike is exactly the signal you need during an attack
or a misbehaving client.

## 7. Reliability and deployment (measured)

| Metric | Value | Source |
|---|---|---|
| CI/CD runs, all branches | 53 (27 success, 26 failure) | `gh run list --limit 200` |
| CI/CD runs, `feature/scaling` | 14 (**12 success, 2 failure — 85.7%**) | same, filtered |
| Runs since the 8 Sep rebuild | 4 of 4 successful | same |
| Commits on `feature/scaling` | 51 total, 30 unique vs `main` | `git rev-list --count` |
| Pipeline duration | 3–5 minutes end to end | GitHub Actions run pages |

**Uptime is not claimed.** The cluster was created on 8 September 2026, so no 30-day availability
figure exists for this deployment. No uptime monitor (Pingdom, UptimeRobot, CloudWatch Synthetics)
was configured, so there is no independent record to cite. Establishing one is listed in future
work.

## 8. Cost (calculated, ap-south-1 on-demand list prices)

| Item | USD / month |
|---|---|
| EKS control plane ($0.10/hr) | 73 |
| 2 × t3.medium worker nodes | 65 |
| NAT gateway (hourly + modest data) | 35 |
| Network Load Balancer | 18 |
| EBS — 2 × 30 Gi node volumes | 6 |
| EBS — Prometheus 10 Gi + Grafana 5 Gi | 2 |
| **Total (staging only)** | **≈ 199** |

This is a list-price calculation, not a billed figure — the account is days old and has not yet
produced a full monthly invoice. **The EKS control plane alone is $73/month and is not
free-tier eligible**, so any figure below that is not achievable on this architecture.

## 9. Test suite (measured)

```
$ npx jest --ci --coverage --maxWorkers=2

Test Suites: 25 failed, 8 passed, 33 total
Tests:       502 failed, 223 passed, 725 total
Time:        408.75 s
All files    |   21.72 |    13.55 |   20.97 |   21.96 |
             |  % Stmts | % Branch | % Funcs | % Lines |
```

A substantial suite exists (725 tests across 33 suites) but **most of it does not currently pass,
and statement coverage is 21.72%**. The `test` job in `.github/workflows/cicd.yml` is commented
out, so no tests run in CI.

This is reported as a known gap rather than presented as a passing quality gate. Repairing the
suite and enabling the CI job is the highest-priority item in future work.

## 10. Security posture (verified)

| Control | Status | Evidence |
|---|---|---|
| TLS with automatic renewal | **Implemented** | §2 |
| Secrets outside source control | **Implemented** | Built at deploy time from GitHub Secrets; `.env` in `.gitignore` |
| Non-root containers | **Implemented** | UID 1001; `runAsNonRoot` on kube-state-metrics |
| RBAC | **Implemented** | `prometheus` and `kube-state-metrics` ServiceAccounts with least-privilege ClusterRoles |
| Rate limiting | **Implemented and load-verified** | §4 Test A |
| Security headers | **Implemented** | Helmet, HSTS, CSP, `X-Frame-Options` (observable in response headers) |
| Network policies | **NOT enforced** | `kubectl get networkpolicy -A` → `No resources found`. A manifest exists at `k8s/network-policy.yaml` but is not applied by CI, and the EKS VPC CNI does not enforce NetworkPolicy unless explicitly enabled on the addon |
| Image vulnerability scanning | **NOT automated** | No Trivy/Scout step in the pipeline |

## 11. Corrections applied to the report

Claims in the earlier draft that could not be substantiated, and what replaced them:

| Earlier claim | Status | Replacement |
|---|---|---|
| p95 180 ms at 850 RPS, 0.05% error | Not measured | Measured: 1,011 req/s, p95 142 ms, 0.00% errors (§4) |
| 99.8% uptime over 30 days | Not measurable — cluster is days old | Claim removed (§7) |
| 45 of 45 deployments, 100% success | Actual: 53 runs, 27 success | 12/14 on `feature/scaling` (§7) |
| Image 500 MB → 200 MB, 60% reduction | No baseline recorded | 77.3 MB compressed, stated plainly (§3) |
| ≈ $80/month | Below the EKS control-plane price alone | ≈ $199/month calculated (§8) |
| Tests run in CI, 70%+ coverage | CI test job disabled | 223/725 passing, 21.72% coverage (§9) |
| Network policies enforced | No NetworkPolicy objects exist | Listed as not implemented (§10) |
| Redis for caching, 85% hit rate | `redisConnection.connect()` is commented out | Redis is not connected; claim removed |
| Self-managed Kubernetes on EC2 + bastion | It is managed EKS | Corrected (§1) |
| Prometheus 5 Gi / Grafana 2 Gi | Actual sizes differ | 10 Gi / 5 Gi (§1) |
