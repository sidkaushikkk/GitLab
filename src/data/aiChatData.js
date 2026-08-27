export const mockSuggestedPrompts = [
  'Explain the authentication architecture and token flow.',
  'What are the highest-risk files in this repository?',
  'Why is API reliability low on /api/v1/payments/charge?',
  'What would break if I change AuthService?',
  'Show me all modules dependent on the payment service.'
];

export const mockDefaultChatHistory = [
  {
    id: 'msg-1',
    sender: 'assistant',
    timestamp: 'Just now',
    text: `Hello. I have indexed the **payment-service** repository (branch \`main\`).

I have analyzed 284 files, 38 API endpoints, and 92 package dependencies.

Here is a summary of findings ready for inquiry:
- **1 Critical Security Finding** in \`src/database/connection.ts\` (hardcoded credentials).
- **3 High Risk Hotspots** across authentication, payment routing, and settlement calculations.
- **API Reliability Alert** on \`/api/v1/payments/charge\` due to Stripe error propagation.

How can I assist you with this codebase today?`,
    citations: []
  }
];

export const mockAiResponses = {
  'Explain the authentication architecture and token flow.': {
    text: `### Authentication Architecture Overview

The **payment-service** repository employs a hybrid token-based architecture:

1. **Entry Point & Token Verification**:
   - \`AuthService.ts\` parses Bearer JWTs signed with RS256/HS256 tokens.
   - It performs active session blacklist checks against an **IORedis** cluster.

2. **Session Store & Invalidation**:
   - User sessions are tracked in PostgreSQL (\`user_sessions\` table) with SHA-256 token hashes.
   - \`session.ts\` manages token revocation pipelines.

3. **Key Architectural Components**:

| Module | Role | Critical Dependencies |
| :--- | :--- | :--- |
| \`src/auth/AuthService.ts\` | JWT verification & token issuance | Redis, \`jsonwebtoken\` |
| \`src/auth/session.ts\` | Invalidation ring & session lookup | Knex PostgreSQL, IORedis |
| \`src/controllers/AuthController.ts\` | OAuth2 endpoints & cookie rotation | Express, CookieParser |

> **Security Advisory**: PR #142 is currently modifying this subsystem to introduce atomic Redis pipelining. Note that line 84 in \`session.ts\` contains an open race condition under concurrent session revocation.`,
    citations: [
      { name: 'AuthService.ts', path: 'src/auth/AuthService.ts', line: 18 },
      { name: 'session.ts', path: 'src/auth/session.ts', line: 84 },
      { name: 'AuthController.ts', path: 'src/controllers/AuthController.ts', line: 115 }
    ]
  },
  'What are the highest-risk files in this repository?': {
    text: `### Top High-Risk Files in \`payment-service\`

Based on combined cyclomatic complexity, vulnerability severity, and downstream dependency blast radius:

1. **\`src/database/connection.ts\`** (Risk: **CRITICAL**)
   - Vulnerability: Hardcoded database fallback password on line 42.
   - Blast Radius: Used by all database queries across 14 modules.

2. **\`src/api/payment.ts\`** (Risk: **HIGH**)
   - Cyclomatic Complexity: 29.
   - Vulnerabilities: Raw SQL string interpolation on line 108; missing Stripe retry circuit breaker.
   - Downstream Consumers: Web checkout and mobile clients.

3. **\`src/services/LedgerSettlement.ts\`** (Risk: **CRITICAL / TECH DEBT**)
   - Cyclomatic Complexity: 34 (highest in repository).
   - Issues: 450 lines of duplicate currency conversion logic, 4 open maintenance warnings.

4. **\`src/auth/AuthService.ts\`** (Risk: **HIGH**)
   - Cyclomatic Complexity: 24.
   - Vulnerabilities: Missing OAuth nonce check; token algorithm fallback.`,
    citations: [
      { name: 'connection.ts', path: 'src/database/connection.ts', line: 42 },
      { name: 'payment.ts', path: 'src/api/payment.ts', line: 108 },
      { name: 'LedgerSettlement.ts', path: 'src/services/LedgerSettlement.ts', line: 1 }
    ]
  },
  'Why is API reliability low on /api/v1/payments/charge?': {
    text: `### Root Cause Analysis: \`/api/v1/payments/charge\` (61.4% Reliability)

The endpoint exhibits three distinct failure modes under load:

1. **Uncaught Upstream Stripe Timeouts (74% of errors)**:
   - When Stripe API takes >2000ms, the Express connection drops without returning a clean 504 status.
   - In \`src/api/payment.ts\`, the try-catch block logs generic 500 without idempotent retry.

2. **Database Connection Pool Exhaustion (22% of errors)**:
   - Synchronous ledger write queries hold the Knex pool lock while waiting for Stripe authorization.

3. **Recommended Fix Patch**:
\`\`\`typescript
// src/api/payment.ts
export async function handleCharge(req: Request, res: Response) {
  // 1. Decouple ledger write to background queue
  // 2. Wrap Stripe call with 3000ms circuit breaker
  const result = await stripeBreaker.fire(() => stripe.paymentIntents.create(params));
  return res.json(result);
}
\`\`\``,
    citations: [
      { name: 'payment.ts', path: 'src/api/payment.ts', line: 24 },
      { name: 'connection.ts', path: 'src/database/connection.ts', line: 14 }
    ]
  },
  'What would break if I change AuthService?': {
    text: `### Impact & Blast Radius for \`AuthService.ts\`

Modifying \`AuthService.ts\` affects **6 direct modules** and **4 API routes**:

- **Direct Dependents**:
  - \`src/api/payment.ts\` (Calls session validator on every charge)
  - \`src/controllers/AuthController.ts\` (Implements login, logout, and token rotation)
  - \`src/controllers/RefundController.ts\` (Tenant validation)
  - \`src/middleware/authGuard.ts\` (Express route interceptor)

- **External Contracts**:
  - \`/api/v1/auth/session\`
  - \`/api/v1/auth/login\`
  - \`/api/v1/auth/refresh\`

If token payload format changes without backwards compatibility, active mobile sessions will experience immediate 401 unauthenticated errors.`,
    citations: [
      { name: 'AuthService.ts', path: 'src/auth/AuthService.ts', line: 1 },
      { name: 'payment.ts', path: 'src/api/payment.ts', line: 12 },
      { name: 'RefundController.ts', path: 'src/controllers/RefundController.ts', line: 1 }
    ]
  },
  'Show me all modules dependent on the payment service.': {
    text: `### Payment Service Dependency Topology

The following internal services and clients call into \`payment-service\`:

1. **\`customer-api\`** (Go Service)
   - Dependency Type: REST Gateway
   - Integrations: Account balance lookup, customer credit limits.

2. **\`internal-dashboard\`** (React Frontend)
   - Dependency Type: GraphQL / REST
   - Integrations: Merchant transaction reconciliation, manual refund actions.

3. **External Systems**:
   - **Stripe API** (\`api.stripe.com\`)
   - **PostgreSQL Ledger Cluster**
   - **IORedis In-Memory Token Cache**`,
    citations: [
      { name: 'payment.ts', path: 'src/api/payment.ts', line: 1 },
      { name: 'LedgerSettlement.ts', path: 'src/services/LedgerSettlement.ts', line: 1 }
    ]
  }
};
