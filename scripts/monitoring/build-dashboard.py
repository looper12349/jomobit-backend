#!/usr/bin/env python3
"""Generate k8s/monitoring/grafana-dashboards.yaml (provider + dashboard ConfigMaps).

Regenerate after editing panels:  python3 scripts/monitoring/build-dashboard.py
"""
import json, textwrap, pathlib

DS = {"type": "prometheus", "uid": "prometheus"}

def target(expr, legend):
    return {"datasource": DS, "expr": expr, "legendFormat": legend, "refId": "A", "range": True}

def ts(title, x, y, w, h, targets, unit=None, desc="", stack=False):
    return {
        "type": "timeseries", "title": title, "datasource": DS, "description": desc,
        "gridPos": {"x": x, "y": y, "w": w, "h": h},
        "targets": [dict(target(e, l), refId=chr(65 + i)) for i, (e, l) in enumerate(targets)],
        "fieldConfig": {
            "defaults": {
                "unit": unit or "short",
                "custom": {
                    "lineWidth": 2, "fillOpacity": 12, "showPoints": "never",
                    "stacking": {"mode": "normal" if stack else "none"},
                },
            },
            "overrides": [],
        },
        "options": {"legend": {"displayMode": "list", "placement": "bottom", "showLegend": True},
                    "tooltip": {"mode": "multi", "sort": "desc"}},
    }

def stat(title, x, y, w, h, expr, unit=None, desc="", thresholds=None):
    return {
        "type": "stat", "title": title, "datasource": DS, "description": desc,
        "gridPos": {"x": x, "y": y, "w": w, "h": h},
        "targets": [target(expr, "")],
        "fieldConfig": {"defaults": {
            "unit": unit or "short",
            "thresholds": {"mode": "absolute", "steps": thresholds or [{"color": "green", "value": None}]},
        }, "overrides": []},
        "options": {"colorMode": "value", "graphMode": "area", "textMode": "auto",
                    "reduceOptions": {"calcs": ["lastNotNull"], "fields": "", "values": False}},
    }

REQ = "jomobit_http_requests_total"
DUR = "jomobit_http_request_duration_seconds_bucket"

panels = [
    # ---- row 1: headline numbers ----
    stat("Service Up (pods)", 0, 0, 4, 4, 'sum(up{job=~"jomo-backend.*"})',
         desc="Pods Prometheus is successfully scraping.",
         thresholds=[{"color": "red", "value": None}, {"color": "green", "value": 1}]),
    stat("Requests / sec", 4, 0, 5, 4, f"sum(rate({REQ}[5m]))", unit="reqps",
         desc="Across all pods, 5-minute rate."),
    stat("p95 Latency", 9, 0, 5, 4,
         f"histogram_quantile(0.95, sum by (le) (rate({DUR}[5m])))", unit="s",
         desc="Target: under 200 ms.",
         thresholds=[{"color": "green", "value": None}, {"color": "orange", "value": 0.2}, {"color": "red", "value": 0.5}]),
    stat("5xx Error Ratio", 14, 0, 5, 4,
         f'sum(rate({REQ}{{status_code=~"5.."}}[5m])) / clamp_min(sum(rate({REQ}[5m])), 1)',
         unit="percentunit", desc="Target: under 0.1%.",
         thresholds=[{"color": "green", "value": None}, {"color": "orange", "value": 0.001}, {"color": "red", "value": 0.01}]),
    stat("Pods Running", 19, 0, 5, 4,
         'kube_deployment_status_replicas_available{namespace="staging",deployment="jomo-backend"}',
         desc="From kube-state-metrics."),

    # ---- row 2: traffic + latency ----
    ts("Request Throughput", 0, 4, 12, 8,
       [(f"sum(rate({REQ}[1m])) or vector(0)", "total req/s")], unit="reqps",
       desc="Requests per second served by the API."),
    ts("Request Latency", 12, 4, 12, 8,
       [(f"histogram_quantile(0.50, sum by (le) (rate({DUR}[5m])))", "p50"),
        (f"histogram_quantile(0.95, sum by (le) (rate({DUR}[5m])))", "p95"),
        (f"histogram_quantile(0.99, sum by (le) (rate({DUR}[5m])))", "p99")],
       unit="s", desc="Latency percentiles from the histogram."),

    # ---- row 3: breakdowns ----
    ts("Requests by Status Code", 0, 12, 12, 8,
       [(f"sum by (status_code) (rate({REQ}[1m]))", "{{status_code}}")], unit="reqps", stack=True,
       desc="Includes 429s from rate limiting (metrics middleware runs before the limiters)."),
    ts("Requests by Route", 12, 12, 12, 8,
       [(f"topk(8, sum by (route) (rate({REQ}[1m])))", "{{route}}")], unit="reqps",
       desc="Top 8 routes by request rate."),

    # ---- row 4: scaling + saturation ----
    ts("Autoscaling — Replicas", 0, 20, 12, 8,
       [('kube_horizontalpodautoscaler_status_current_replicas{horizontalpodautoscaler="jomo-backend-hpa"}', "current"),
        ('kube_horizontalpodautoscaler_spec_min_replicas{horizontalpodautoscaler="jomo-backend-hpa"}', "min"),
        ('kube_horizontalpodautoscaler_spec_max_replicas{horizontalpodautoscaler="jomo-backend-hpa"}', "max")],
       desc="HPA replica count over time — this is the autoscaling evidence."),
    ts("In-flight Requests / Pod Restarts", 12, 20, 12, 8,
       [("sum(jomobit_http_requests_in_progress)", "in flight"),
        ('sum(kube_pod_container_status_restarts_total{namespace="staging"})', "cumulative restarts")],
       desc="Concurrency and pod stability."),
]

dash = {
    "title": "Jomobit Observability Overview",
    "uid": "jomobit-overview",
    "tags": ["jomobit", "api", "kubernetes"],
    "timezone": "browser",
    "schemaVersion": 39,
    "version": 1,
    "refresh": "10s",
    "time": {"from": "now-30m", "to": "now"},
    "editable": True,
    "panels": panels,
}

provider = """apiVersion: 1
providers:
  - name: jomobit
    orgId: 1
    folder: ''
    type: file
    disableDeletion: false
    updateIntervalSeconds: 30
    allowUiUpdates: true
    options:
      path: /etc/grafana/dashboards
      foldersFromFilesStructure: false
"""

out = (
    "# GENERATED by scripts/monitoring/build-dashboard.py — do not hand-edit.\n"
    "# Regenerate:  python3 scripts/monitoring/build-dashboard.py\n"
    "apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: grafana-dashboard-provider\n"
    "  namespace: monitoring\ndata:\n  provider.yaml: |\n"
    + textwrap.indent(provider, "    ")
    + "---\napiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: grafana-dashboards\n"
      "  namespace: monitoring\ndata:\n  jomobit-overview.json: |\n"
    + textwrap.indent(json.dumps(dash, indent=2), "    ") + "\n"
)
pathlib.Path("k8s/monitoring/grafana-dashboards.yaml").write_text(out)
print("wrote k8s/monitoring/grafana-dashboards.yaml —", len(panels), "panels")
