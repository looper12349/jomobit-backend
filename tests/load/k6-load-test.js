// k6 load test for the Jomobit API.
//
// Runs INSIDE the cluster against the ClusterIP Service so it measures
// application + pod capacity. Hitting the public ingress instead would measure
// the nginx rate limit (limit-rps: 50), not the application.
//
//   kubectl apply -f k8s/load-test-job.yaml
//   kubectl logs -n staging job/k6-load-test -f
import http from 'k6/http';
import { check } from 'k6';
import { Trend, Rate } from 'k6/metrics';

const latency = new Trend('api_latency', true);
const failures = new Rate('api_failures');

const TARGET = __ENV.TARGET || 'http://jomo-backend-service.staging.svc.cluster.local/api';

export const options = {
  stages: [
    { duration: '30s', target: 20 },   // ramp up
    { duration: '60s', target: 60 },   // sustained load — should push CPU past the 70% HPA trigger
    { duration: '60s', target: 120 },  // peak
    { duration: '30s', target: 0 },    // ramp down
  ],
  thresholds: {
    http_req_duration: ['p(95)<200'],  // the report's stated p95 target
    http_req_failed:   ['rate<0.001'], // <0.1% error rate target
  },
};

export default function () {
  const res = http.get(TARGET);
  latency.add(res.timings.duration);
  failures.add(res.status !== 200);
  check(res, { 'status is 200': (r) => r.status === 200 });
}
