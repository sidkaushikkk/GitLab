export const mockHealthTrends = {
  'payment-service': [
    { date: 'Jun 01', health: 71, quality: 68, security: 84, reliability: 79 },
    { date: 'Jun 15', health: 74, quality: 70, security: 86, reliability: 81 },
    { date: 'Jul 01', health: 76, quality: 72, security: 89, reliability: 82 },
    { date: 'Jul 15', health: 79, quality: 73, security: 90, reliability: 85 },
    { date: 'Aug 01', health: 80, quality: 75, security: 91, reliability: 86 },
    { date: 'Aug 15', health: 83, quality: 77, security: 92, reliability: 88 },
    { date: 'Aug 21', health: 82, quality: 76, security: 91, reliability: 87 }
  ],
  'customer-api': [
    { date: 'Jun 01', health: 88, quality: 85, security: 92, reliability: 94 },
    { date: 'Jun 15', health: 89, quality: 87, security: 93, reliability: 95 },
    { date: 'Jul 01', health: 91, quality: 88, security: 94, reliability: 96 },
    { date: 'Jul 15', health: 92, quality: 90, security: 95, reliability: 97 },
    { date: 'Aug 01', health: 93, quality: 90, security: 96, reliability: 97 },
    { date: 'Aug 15', health: 94, quality: 91, security: 96, reliability: 98 },
    { date: 'Aug 21', health: 94, quality: 91, security: 96, reliability: 98 }
  ],
  'internal-dashboard': [
    { date: 'Jun 01', health: 62, quality: 58, security: 69, reliability: 74 },
    { date: 'Jun 15', health: 63, quality: 60, security: 70, reliability: 75 },
    { date: 'Jul 01', health: 65, quality: 61, security: 71, reliability: 77 },
    { date: 'Jul 15', health: 64, quality: 62, security: 72, reliability: 78 },
    { date: 'Aug 01', health: 66, quality: 63, security: 73, reliability: 79 },
    { date: 'Aug 15', health: 67, quality: 64, security: 74, reliability: 80 },
    { date: 'Aug 21', health: 68, quality: 64, security: 74, reliability: 80 }
  ],
  'authentication-service': [
    { date: 'Jun 01', health: 89, quality: 86, security: 92, reliability: 93 },
    { date: 'Jun 15', health: 90, quality: 87, security: 93, reliability: 94 },
    { date: 'Jul 01', health: 91, quality: 88, security: 94, reliability: 95 },
    { date: 'Jul 15', health: 91, quality: 88, security: 94, reliability: 95 },
    { date: 'Aug 01', health: 92, quality: 89, security: 95, reliability: 96 },
    { date: 'Aug 15', health: 92, quality: 89, security: 95, reliability: 96 },
    { date: 'Aug 21', health: 92, quality: 89, security: 95, reliability: 96 }
  ]
};

export const mockComplexityDistribution = [
  { range: '1-5 (Simple)', files: 168, percentage: 59.1 },
  { range: '6-10 (Moderate)', files: 72, percentage: 25.4 },
  { range: '11-20 (Complex)', files: 31, percentage: 10.9 },
  { range: '21+ (Extreme)', files: 13, percentage: 4.6 }
];

export const mockRiskHotspots = {
  'payment-service': [
    {
      id: 'hotspot-1',
      file: 'src/auth/AuthService.ts',
      complexity: 'High (Cyclomatic: 24)',
      issuesCount: 3,
      category: 'Security & Auth Flow',
      description: 'Session revocation lacks atomic Redis transaction; concurrent logins can leak expired JWT claims.',
      riskLevel: 'HIGH',
      findingsCount: 3
    },
    {
      id: 'hotspot-2',
      file: 'src/api/payment.ts',
      complexity: 'High (Cyclomatic: 29)',
      issuesCount: 2,
      category: 'Dependency & Reliability',
      description: 'Stripe webhook idempotency key storage lacks fallback connection pool retry logic.',
      riskLevel: 'HIGH',
      findingsCount: 2
    },
    {
      id: 'hotspot-3',
      file: 'src/database/connection.ts',
      complexity: 'Medium (Cyclomatic: 12)',
      issuesCount: 1,
      category: 'Critical Configuration',
      description: 'SSL certificate verification disabled in staging database fallback pool config.',
      riskLevel: 'CRITICAL',
      findingsCount: 1
    },
    {
      id: 'hotspot-4',
      file: 'src/services/LedgerSettlement.ts',
      complexity: 'High (Cyclomatic: 34)',
      issuesCount: 4,
      category: 'Code Duplication & Debt',
      description: '450 lines of duplicate currency rounding math across multi-tenant ledger accounts.',
      riskLevel: 'MEDIUM',
      findingsCount: 4
    }
  ]
};

export const mockRecentActivities = {
  'payment-service': [
    {
      id: 'act-1',
      type: 'PR_ANALYZED',
      title: 'PR #142 analyzed: Refactor authentication service',
      author: 'alex.chen',
      time: '14 minutes ago',
      badge: 'HIGH RISK',
      badgeVariant: 'rose'
    },
    {
      id: 'act-2',
      type: 'SECURITY_ALERT',
      title: 'New critical finding detected in src/database/connection.ts',
      author: 'GitLab Security Engine',
      time: '28 minutes ago',
      badge: 'CRITICAL',
      badgeVariant: 'rose'
    },
    {
      id: 'act-3',
      type: 'ANALYSIS_COMPLETED',
      title: 'Full AST and dependency scan completed on branch main',
      author: 'Automated CI/CD',
      time: '42 minutes ago',
      badge: 'HEALTH 82',
      badgeVariant: 'emerald'
    },
    {
      id: 'act-4',
      type: 'CODE_HEALTH',
      title: 'Technical debt reduced by 4.2 hours in src/utils/formatter.ts',
      author: 'elena.rostova',
      time: '2 hours ago',
      badge: 'IMPROVEMENT',
      badgeVariant: 'cyan'
    }
  ]
};

export const mockCodeHealthFiles = [
  {
    file: 'src/services/LedgerSettlement.ts',
    lines: 640,
    complexity: 34,
    maintainability: 52,
    issues: 6,
    duplication: '14.2%',
    testCoverage: '42%',
    risk: 'CRITICAL'
  },
  {
    file: 'src/api/payment.ts',
    lines: 520,
    complexity: 29,
    maintainability: 58,
    issues: 4,
    duplication: '8.4%',
    testCoverage: '65%',
    risk: 'HIGH'
  },
  {
    file: 'src/auth/AuthService.ts',
    lines: 480,
    complexity: 24,
    maintainability: 64,
    issues: 3,
    duplication: '4.1%',
    testCoverage: '71%',
    risk: 'HIGH'
  },
  {
    file: 'src/database/connection.ts',
    lines: 190,
    complexity: 12,
    maintainability: 72,
    issues: 2,
    duplication: '1.2%',
    testCoverage: '84%',
    risk: 'HIGH'
  },
  {
    file: 'src/controllers/WebhookController.ts',
    lines: 310,
    complexity: 16,
    maintainability: 76,
    issues: 1,
    duplication: '2.4%',
    testCoverage: '89%',
    risk: 'MEDIUM'
  },
  {
    file: 'src/middleware/rateLimiter.ts',
    lines: 145,
    complexity: 8,
    maintainability: 88,
    issues: 0,
    duplication: '0.0%',
    testCoverage: '94%',
    risk: 'LOW'
  },
  {
    file: 'src/utils/crypto.ts',
    lines: 120,
    complexity: 6,
    maintainability: 92,
    issues: 0,
    duplication: '0.0%',
    testCoverage: '98%',
    risk: 'LOW'
  }
];
