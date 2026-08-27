export const mockApiEndpoints = [
  {
    id: 'api-1',
    endpoint: '/api/v1/payments/charge',
    method: 'POST',
    reliability: 61.4,
    errorHandling: 'Poor (Uncaught Stripe Rejections)',
    dependencies: 'High (Stripe, PostgreSQL, Redis, Audit Queue)',
    risk: 'CRITICAL',
    p99Latency: '840ms',
    rps: 340,
    successRate: 97.2,
    failureRate: 2.8,
    callers: ['web-checkout-frontend', 'ios-app-client', 'subscription-cron'],
    description: 'Processes credit card charges, token authorizations, and creates ledger line items.',
    recentErrors: [
      { timestamp: '12:44:10', message: 'StripeConnectionError: Connection reset by peer on auth.stripe.com', count: 42 },
      { timestamp: '12:38:05', message: 'TransactionTimeoutError: Knex query exceeded 5000ms threshold', count: 18 }
    ],
    recommendations: [
      'Implement exponential backoff retry for Stripe gateway timeouts.',
      'Separate database audit logging into an asynchronous background worker.',
      'Add circuit breaker for upstream Stripe API failures.'
    ]
  },
  {
    id: 'api-2',
    endpoint: '/api/v1/users/profile',
    method: 'GET',
    reliability: 94.8,
    errorHandling: 'Excellent (Cached with Graceful Stale Fallback)',
    dependencies: 'Low (Redis, User Read Replica)',
    risk: 'LOW',
    p99Latency: '42ms',
    rps: 1250,
    successRate: 99.9,
    failureRate: 0.1,
    callers: ['web-frontend', 'customer-portal', 'mobile-client'],
    description: 'Retrieves user details, permissions, and organization memberships.',
    recentErrors: [],
    recommendations: ['Consider increasing Redis TTL from 300s to 600s with cache-busting on update.']
  },
  {
    id: 'api-3',
    endpoint: '/api/v1/webhooks/stripe',
    method: 'POST',
    reliability: 78.2,
    errorHandling: 'Moderate (Missing Idempotency Fallback Pool)',
    dependencies: 'High (PostgreSQL, Kafka, Stripe SDK)',
    risk: 'HIGH',
    p99Latency: '620ms',
    rps: 85,
    successRate: 98.4,
    failureRate: 1.6,
    callers: ['Stripe Webhook Infrastructure'],
    description: 'Receives payment_intent.succeeded, charge.refunded, and invoice.payment_failed events.',
    recentErrors: [
      { timestamp: '11:15:22', message: 'DuplicateKeyError: event_id evt_1M98 already processed in Redis lock window', count: 9 }
    ],
    recommendations: [
      'Acknowledge HTTP 200 immediately and push event payload into Kafka ingestion topic.'
    ]
  },
  {
    id: 'api-4',
    endpoint: '/api/v1/settlements/reconcile',
    method: 'POST',
    reliability: 72.0,
    errorHandling: 'Fair (Memory spike under large date ranges)',
    dependencies: 'High (PostgreSQL, Ledger Read DB, S3 Storage)',
    risk: 'HIGH',
    p99Latency: '1850ms',
    rps: 15,
    successRate: 96.8,
    failureRate: 3.2,
    callers: ['nightly-settlement-scheduler', 'finance-ops-portal'],
    description: 'Aggregates multi-currency payment intents and produces daily merchant settlement files.',
    recentErrors: [
      { timestamp: '06:00:14', message: 'HeapAllocationLimit: JavaScript heap out of memory during 50k item join', count: 3 }
    ],
    recommendations: [
      'Switch from in-memory array aggregation to Node.js database stream pipe to S3.'
    ]
  },
  {
    id: 'api-5',
    endpoint: '/api/v1/auth/session',
    method: 'GET',
    reliability: 98.6,
    errorHandling: 'Excellent (Strict JWT signature validation)',
    dependencies: 'Low (Redis)',
    risk: 'LOW',
    p99Latency: '18ms',
    rps: 2400,
    successRate: 99.98,
    failureRate: 0.02,
    callers: ['api-gateway', 'internal-dashboard', 'mobile-app'],
    description: 'Validates active user session cookies and returns user claims.',
    recentErrors: [],
    recommendations: []
  },
  {
    id: 'api-6',
    endpoint: '/api/v1/invoices/generate-pdf',
    method: 'POST',
    reliability: 84.1,
    errorHandling: 'Moderate (Headless chrome worker restarts)',
    dependencies: 'Medium (Puppeteer Worker, S3)',
    risk: 'MEDIUM',
    p99Latency: '1420ms',
    rps: 35,
    successRate: 98.9,
    failureRate: 1.1,
    callers: ['customer-portal', 'billing-worker'],
    description: 'Generates branded PDF invoices for merchant accounting records.',
    recentErrors: [
      { timestamp: '09:22:18', message: 'PuppeteerError: Protocol error (Page.navigate): Target closed', count: 5 }
    ],
    recommendations: [
      'Recycle Puppeteer browser instance every 100 PDF renders.'
    ]
  }
];

export const mockReliabilitySummary = {
  score: 87,
  totalApis: 38,
  healthyApis: 29,
  atRiskApis: 6,
  criticalApis: 3,
  averageP99: '240ms',
  globalUptime: '99.94%'
};
