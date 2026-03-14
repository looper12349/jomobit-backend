# R4 Monitoring and Alerting Implementation

This document implements requirement set `R4` for monitoring and alerting.

## Scope

- FR4.1: Collect application and infrastructure metrics
- FR4.2: Provide visual dashboards for metrics
- FR4.3: Configure alerts for critical conditions
- FR4.4: Aggregate logs from all containers
- FR4.5: Provide log search and analysis capabilities
- FR4.6: Track deployment history and changes

## Components Added

- Application instrumentation:
  - `src/utils/metrics.js`
  - `src/app.js` integration (`/metrics`, `/health/deployments`)
- Monitoring stack:
  - `docker-compose.monitoring.yml`
  - Nginx gateway routing config: `monitoring/nginx/default.conf`
  - Prometheus: `monitoring/prometheus/prometheus.yml`
  - Alert rules: `monitoring/prometheus/rules/jomobit-alerts.yml`
  - Alertmanager: `monitoring/alertmanager/alertmanager.yml`
  - Grafana provisioning and dashboard:
    - `monitoring/grafana/provisioning/datasources/datasources.yml`
    - `monitoring/grafana/provisioning/dashboards/dashboards.yml`
    - `monitoring/grafana/dashboards/jomobit-overview.json`
  - Loki config: `monitoring/loki/loki-config.yml`
  - Promtail config: `monitoring/promtail/promtail-config.yml`

## Functional Requirement Mapping

### FR4.1: Metrics Collection

- App metrics endpoint: `GET /metrics`
- Collection interval is set to `15s`:
  - Node/runtime metrics: `collectDefaultMetrics(... timeout: 15000)`
  - Prometheus scraping: `scrape_interval: 15s`
- Metrics include:
  - Request throughput (`jomobit_http_requests_total`)
  - Request latency (`jomobit_http_request_duration_seconds`)
  - In-flight requests (`jomobit_http_requests_in_progress`)
  - App deployment metadata (`jomobit_app_info`)
  - Host/container metrics via `node-exporter` and `cadvisor`

### FR4.2: Visual Dashboards

- Grafana dashboard provisioned automatically: `jomobit-overview`
- Dashboard refresh set to `15s`
- Panels include:
  - Request throughput
  - P95 latency
  - 5xx error ratio
  - Live aggregated logs (Loki)

### FR4.3: Alerts

- Alert rules in `monitoring/prometheus/rules/jomobit-alerts.yml`
- Critical alerts:
  - Service down
  - High 5xx error rate
- Warning alerts:
  - High p95 latency
  - High host memory pressure
- Rule evaluation every `15s` with `for: 45s`, so alerts trigger in about 1 minute.

### FR4.4: Container Log Aggregation

- Promtail collects:
  - Docker container JSON logs
  - App log files (`./logs/*.log`)
- Loki stores centralized logs for all services in stack.

### FR4.5: Log Search and Analysis

- Grafana uses Loki datasource for query/search.
- Loki query timeout set to `5s` in `monitoring/loki/loki-config.yml`.
- Index/chunk layout is optimized for container-scale search using TSDB schema.



## Acceptance Criteria Mapping

- Metrics collected every 15 seconds:
  - Prometheus global `scrape_interval: 15s`
  - App runtime metrics interval `15000ms`
- Dashboards display real-time data with < 30s delay:
  - Grafana dashboard refresh `15s`
- Alerts trigger within 1 minute of threshold breach:
  - Alert evaluation `15s` and alert window `for: 45s`
- Logs retained for minimum 30 days:
  - Prometheus retention `30d`
  - Loki retention configured to `744h` (31 days)
- Log search returns results within 5 seconds:
  - Loki `query_timeout: 5s`

## Quick Start

1. Start stack:

```bash
npm run monitoring:up
```

2. Access tools:

- App health: `http://localhost:3000/health`
- App metrics: `http://localhost:3000/metrics`
- Prometheus: `http://localhost:3000/prometheus/`
- Alertmanager: `http://localhost:3000/alertmanager/`
- Grafana: `http://localhost:3000/grafana/`
- Node exporter metrics: `http://localhost:3000/node-exporter/metrics`

3. Routing model:

- A single gateway exposes host port `3000`.
- Monitoring services are reachable via path-based routing (different endpoints on the same port).

4. Stop stack:

```bash
npm run monitoring:down
```


