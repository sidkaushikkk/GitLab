export const mockFileTree = [
  {
    name: 'src',
    type: 'directory',
    path: 'src',
    children: [
      {
        name: 'api',
        type: 'directory',
        path: 'src/api',
        children: [
          {
            name: 'payment.ts',
            type: 'file',
            path: 'src/api/payment.ts',
            language: 'typescript',
            size: '14.2 KB',
            issuesCount: 2,
            hasSecurityIssue: true
          }
        ]
      },
      {
        name: 'auth',
        type: 'directory',
        path: 'src/auth',
        children: [
          {
            name: 'AuthService.ts',
            type: 'file',
            path: 'src/auth/AuthService.ts',
            language: 'typescript',
            size: '18.6 KB',
            issuesCount: 3,
            hasSecurityIssue: true
          },
          {
            name: 'session.ts',
            type: 'file',
            path: 'src/auth/session.ts',
            language: 'typescript',
            size: '9.4 KB',
            issuesCount: 1,
            hasSecurityIssue: false
          }
        ]
      },
      {
        name: 'controllers',
        type: 'directory',
        path: 'src/controllers',
        children: [
          {
            name: 'RefundController.ts',
            type: 'file',
            path: 'src/controllers/RefundController.ts',
            language: 'typescript',
            size: '12.1 KB',
            issuesCount: 1,
            hasSecurityIssue: true
          },
          {
            name: 'WebhookController.ts',
            type: 'file',
            path: 'src/controllers/WebhookController.ts',
            language: 'typescript',
            size: '11.8 KB',
            issuesCount: 0,
            hasSecurityIssue: false
          }
        ]
      },
      {
        name: 'database',
        type: 'directory',
        path: 'src/database',
        children: [
          {
            name: 'connection.ts',
            type: 'file',
            path: 'src/database/connection.ts',
            language: 'typescript',
            size: '6.4 KB',
            issuesCount: 1,
            hasSecurityIssue: true
          },
          {
            name: 'redis.ts',
            type: 'file',
            path: 'src/database/redis.ts',
            language: 'typescript',
            size: '4.2 KB',
            issuesCount: 0,
            hasSecurityIssue: false
          }
        ]
      },
      {
        name: 'services',
        type: 'directory',
        path: 'src/services',
        children: [
          {
            name: 'LedgerSettlement.ts',
            type: 'file',
            path: 'src/services/LedgerSettlement.ts',
            language: 'typescript',
            size: '22.4 KB',
            issuesCount: 4,
            hasSecurityIssue: false
          }
        ]
      },
      {
        name: 'utils',
        type: 'directory',
        path: 'src/utils',
        children: [
          {
            name: 'crypto.ts',
            type: 'file',
            path: 'src/utils/crypto.ts',
            language: 'typescript',
            size: '5.1 KB',
            issuesCount: 1,
            hasSecurityIssue: true
          }
        ]
      },
      {
        name: 'app.ts',
        type: 'file',
        path: 'src/app.ts',
        language: 'typescript',
        size: '7.8 KB',
        issuesCount: 0,
        hasSecurityIssue: false
      }
    ]
  },
  {
    name: 'package.json',
    type: 'file',
    path: 'package.json',
    language: 'json',
    size: '1.8 KB',
    issuesCount: 2,
    hasSecurityIssue: true
  }
];

export const mockFileContents = {
  'src/auth/AuthService.ts': {
    path: 'src/auth/AuthService.ts',
    language: 'typescript',
    linesCount: 48,
    issues: [
      {
        line: 18,
        severity: 'HIGH',
        type: 'Complexity',
        message: 'Cyclomatic complexity is 24 (threshold: 15). Consider decomposing session validation logic.'
      },
      {
        line: 36,
        severity: 'HIGH',
        type: 'Security',
        message: 'SEC-1031: Missing cryptographic nonce in OAuth2 session validation flow.'
      },
      {
        line: 44,
        severity: 'MEDIUM',
        type: 'Technical Debt',
        message: 'Duplicate token serialization helper detected in 3 other modules.'
      }
    ],
    content: `import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { Redis } from 'ioredis';
import { db } from '../database/connection';
import { SecurityException } from '../utils/errors';

export class AuthService {
  private redis: Redis;
  private tokenSecret: string;

  constructor(redisClient: Redis) {
    this.redis = redisClient;
    this.tokenSecret = process.env.JWT_SECRET || 'dev_secret_key';
  }

  // Validates incoming bearer authorization tokens
  public async validateSession(token: string): Promise<boolean> {
    try {
      const decoded = jwt.verify(token, this.tokenSecret) as { userId: string; exp: number };
      const isBlacklisted = await this.redis.get(\`blacklist:\${token}\`);
      
      if (isBlacklisted) {
        return false;
      }
      return true;
    } catch (err) {
      return false;
    }
  }

  // Exchanges OAuth authorization code for customer session token
  public async verifyOAuthCallback(state: string, code: string) {
    // Missing nonce validation in Redis cache
    const token = await this.oauthProvider.exchangeCode(code);
    return this.createSession(token.userId);
  }

  // Issues new token pair with 15 minute lifespan
  public generateTokens(userId: string, orgId: string) {
    const payload = { userId, orgId, issuedAt: Date.now() };
    const accessToken = jwt.sign(payload, this.tokenSecret, { expiresIn: '15m' });
    const refreshToken = jwt.sign(payload, this.tokenSecret, { expiresIn: '7d' });
    return { accessToken, refreshToken };
  }
}`
  },
  'src/database/connection.ts': {
    path: 'src/database/connection.ts',
    language: 'typescript',
    linesCount: 38,
    issues: [
      {
        line: 14,
        severity: 'CRITICAL',
        type: 'Security',
        message: 'SEC-1082: Hardcoded secret token in database connection configuration.'
      }
    ],
    content: `import knex, { Knex } from 'knex';

export const getPoolConfig = (): Knex.Config => {
  const isProduction = process.env.NODE_ENV === 'production';

  return {
    client: 'pg',
    connection: {
      host: process.env.DB_HOST || 'db.internal.hitachi.net',
      port: parseInt(process.env.DB_PORT || '5432', 10),
      user: 'admin_service_rw',
      // CRITICAL: Hardcoded fallback secret
      password: 'prod_hitachi_ledger_sec#9821_live',
      database: process.env.DB_NAME || 'settlement_production',
      ssl: isProduction ? { rejectUnauthorized: false } : false
    },
    pool: {
      min: 2,
      max: 20,
      acquireTimeoutMillis: 30000
    }
  };
};

export const db = knex(getPoolConfig());`
  },
  'src/api/payment.ts': {
    path: 'src/api/payment.ts',
    language: 'typescript',
    linesCount: 40,
    issues: [
      {
        line: 24,
        severity: 'HIGH',
        type: 'Security',
        message: 'SEC-1044: SQL injection risk via unescaped string interpolation in query.'
      },
      {
        line: 32,
        severity: 'HIGH',
        type: 'Reliability',
        message: 'Missing exponential retry logic on external Stripe gateway error responses.'
      }
    ],
    content: `import { Router, Request, Response } from 'express';
import Stripe from 'stripe';
import { db } from '../database/connection';

const router = Router();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '', {
  apiVersion: '2023-10-16'
});

// Processes merchant charge request
router.post('/charge', async (req: Request, res: Response) => {
  const { amount, currency, customerId, paymentMethodId } = req.body;

  try {
    const paymentIntent = await stripe.paymentIntents.create({
      amount,
      currency,
      customer: customerId,
      payment_method: paymentMethodId,
      confirm: true
    });

    // Vulnerable SQL query without parameterized binding
    const query = \`SELECT * FROM transactions WHERE user_id = '\${customerId}' AND status = 'COMPLETED'\`;
    const historical = await db.raw(query);

    return res.json({ success: true, paymentIntent, historical });
  } catch (err: any) {
    // Unhandled gateway error fallback
    return res.status(500).json({ error: err.message });
  }
});

export default router;`
  }
};
