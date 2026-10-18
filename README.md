# Jomobit Backend

Node.js / Express API for Jomobit, an AI poster generation platform. This branch (`feature/scaling`) runs it on Amazon EKS with a GitHub Actions pipeline, autoscaling and Prometheus/Grafana monitoring.

## Live links

Running on AWS (ap-south-1) until the viva on 24 Oct 2026.

| What | Link |
|---|---|
| Client (web app) | https://jomo.dazzeldigital.com |
| Backend API | https://api-dev.amritesh.dev/api |
| Grafana dashboard | https://api-dev.amritesh.dev/grafana/d/jomobit-overview/jomobit-observability-overview |
| Prometheus | https://api-dev.amritesh.dev/prometheus/ |
| Prometheus targets / alerts | https://api-dev.amritesh.dev/prometheus/targets · https://api-dev.amritesh.dev/prometheus/alerts |

Grafana and Prometheus login: **id** `admin`, **password** `jomo@fnz7n`

The app's `/metrics` endpoint is not exposed publicly; Prometheus scrapes it inside the cluster. To see it raw:

```bash
kubectl -n staging port-forward svc/jomo-backend-service 8080:80
# then open http://localhost:8080/metrics
```

Useful Prometheus queries:

- `jomobit_app_info` - commit SHA and image tag each pod is running
- `sum by (status_code) (rate(jomobit_http_requests_total[5m]))` - request rate by status
- `histogram_quantile(0.95, sum by (le) (rate(jomobit_http_request_duration_seconds_bucket[5m])))` - p95 latency
- `kube_horizontalpodautoscaler_status_current_replicas` - HPA replica count

## How it is deployed

- **Cluster:** EKS 1.35, 2 x t3a.small nodes, no NAT gateway ([infra/cluster.yaml](infra/cluster.yaml)). About $5/day.
- **Ingress:** ingress-nginx behind an NLB, TLS from Let's Encrypt via cert-manager.
- **App:** Deployment with `/health` (liveness) and `/ready` (MongoDB check) probes, HPA (2-4 pods on CPU), NetworkPolicy enforced by the VPC CNI.
- **Data:** MongoDB Atlas. AI providers, Auth0, Razorpay and ImageKit are external services.
- **Monitoring:** Prometheus, Grafana and kube-state-metrics in the `monitoring-staging` namespace.
- **CI/CD** ([.github/workflows/cicd.yml](.github/workflows/cicd.yml)): test gate → build and push image tagged `<branch>-<sha>` → Trivy scan (blocks on fixable CRITICAL) → deploy to EKS using GitHub OIDC (no stored AWS keys) → check that the live pods run this commit and that the public URL returns 200 → deploy monitoring. Push to `feature/scaling` deploys to staging; push to `main` deploys to production. Rollback is a manual `workflow_dispatch`.

## Run locally

```bash
cp .env.template .env     # fill in MongoDB, Auth0, Razorpay and AI provider keys
npm ci
npm run dev               # http://localhost:3000/api
```

Or with MongoDB and Redis in containers: `docker compose up`.

Local monitoring stack (Prometheus, Grafana, Loki, Alertmanager): `npm run monitoring:up`.

Tests:

```bash
npm run test:gate         # the suites CI blocks on
npm test                  # full suite (some suites are still failing, see docs/CAPSTONE-EVIDENCE.md)
```

## Deploy from scratch

Needs the AWS CLI, eksctl, kubectl and helm, plus the GitHub secrets referenced in the workflow and the repo variable `AWS_DEPLOY_ROLE_ARN`.

```bash
eksctl create cluster -f infra/cluster.yaml          # ~20 min
AWS_PROFILE=jomo bash scripts/bootstrap-cluster.sh   # ingress-nginx, cert-manager, CI access
# point the api-dev CNAME at the load balancer hostname the script prints
git push origin feature/scaling                      # pipeline deploys app + monitoring
```

Full walkthrough: [DEPLOY-FRESH-AWS.md](DEPLOY-FRESH-AWS.md).

## Tear down

```bash
bash TEARDOWN-AWS.sh            # dry run
bash TEARDOWN-AWS.sh --execute  # deletes the cluster, load balancer and volumes
```

## More docs

- [docs/README.md](docs/README.md) - API, data model and business logic
- [docs/CAPSTONE-EVIDENCE.md](docs/CAPSTONE-EVIDENCE.md) - measured results and how to reproduce them
