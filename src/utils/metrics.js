const client = require('prom-client');

const registry = new client.Registry();

registry.setDefaultLabels({
  service: 'jomobit-backend-api',
  environment: process.env.NODE_ENV || 'development'
});

// Collect Node.js runtime metrics every 15s to meet FR4.1 acceptance criteria.
client.collectDefaultMetrics({
  register: registry,
  timeout: 15000
});

const httpRequestsTotal = new client.Counter({
  name: 'jomobit_http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'route', 'status_code']
});

const httpRequestDurationSeconds = new client.Histogram({
  name: 'jomobit_http_request_duration_seconds',
  help: 'HTTP request latency in seconds',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10]
});

const httpRequestsInProgress = new client.Gauge({
  name: 'jomobit_http_requests_in_progress',
  help: 'Current number of in-flight HTTP requests'
});

const appInfo = new client.Gauge({
  name: 'jomobit_app_info',
  help: 'Application build and deployment metadata',
  labelNames: ['version', 'git_sha', 'image_tag']
});

registry.registerMetric(httpRequestsTotal);
registry.registerMetric(httpRequestDurationSeconds);
registry.registerMetric(httpRequestsInProgress);
registry.registerMetric(appInfo);

function updateAppInfoMetric() {
  appInfo.reset();
  appInfo.labels(
    process.env.npm_package_version || '1.0.0',
    process.env.GIT_SHA || 'unknown',
    process.env.IMAGE_TAG || 'unknown'
  ).set(1);
}

updateAppInfoMetric();

function getRouteLabel(req) {
  if (req.route && req.route.path) {
    return `${req.baseUrl || ''}${req.route.path}`;
  }

  return req.path || req.originalUrl || 'unknown';
}

function metricsMiddleware(req, res, next) {
  if (req.path === '/metrics') {
    return next();
  }

  httpRequestsInProgress.inc();
  const endTimer = httpRequestDurationSeconds.startTimer();

  res.on('finish', () => {
    const route = getRouteLabel(req);
    const statusCode = String(res.statusCode);

    httpRequestsTotal.inc({
      method: req.method,
      route,
      status_code: statusCode
    });

    endTimer({
      method: req.method,
      route,
      status_code: statusCode
    });

    httpRequestsInProgress.dec();
  });

  return next();
}

async function getMetrics() {
  updateAppInfoMetric();
  return registry.metrics();
}

function getMetricsContentType() {
  return registry.contentType;
}

module.exports = {
  metricsMiddleware,
  getMetrics,
  getMetricsContentType
};
