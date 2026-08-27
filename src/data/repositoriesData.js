export const mockRepositories = [
  {
    id: 'payment-service',
    name: 'payment-service',
    organization: 'HitachiSystems',
    description: 'Core payment processing pipeline, Stripe integration, webhook handlers, and ledger settlement.',
    primaryLanguage: 'TypeScript',
    defaultBranch: 'main',
    branches: ['main', 'staging', 'feature/stripe-v3', 'fix/settlement-race-condition', 'chore/node-upgrade'],
    visibility: 'Private',
    lastAnalyzed: '8 minutes ago',
    lastAnalyzedTimestamp: '2026-08-21T13:14:00Z',
    status: 'Analyzed',
    stars: 48,
    forks: 12,
    openPrsCount: 4,
    metrics: {
      healthScore: 82,
      securityScore: 91,
      codeQualityScore: 76,
      technicalDebt: 'Medium',
      apiReliabilityScore: 87,
      testCoverage: 78.4,
      duplicatedLines: 3.2,
      complexityScore: 'High',
      totalFiles: 284,
      linesOfCode: 42850,
      languages: [
        { name: 'TypeScript', percentage: 78.5, color: '#3178c6' },
        { name: 'JavaScript', percentage: 12.2, color: '#f7df1e' },
        { name: 'SQL', percentage: 6.8, color: '#e38c00' },
        { name: 'Docker / Shell', percentage: 2.5, color: '#38bdf8' }
      ],
      functionsCount: 1420,
      classesCount: 184,
      dependenciesCount: 92,
      apisDetectedCount: 38
    },
    riskSummary: {
      critical: 1,
      high: 3,
      medium: 8,
      low: 14
    }
  },
  {
    id: 'customer-api',
    name: 'customer-api',
    organization: 'HitachiSystems',
    description: 'High-throughput customer profile gateway, tenancy verification, and event streaming.',
    primaryLanguage: 'Go',
    defaultBranch: 'main',
    branches: ['main', 'develop', 'feat/kafka-partitions', 'perf/user-cache'],
    visibility: 'Private',
    lastAnalyzed: '24 minutes ago',
    lastAnalyzedTimestamp: '2026-08-21T12:58:00Z',
    status: 'Analyzed',
    stars: 32,
    forks: 6,
    openPrsCount: 2,
    metrics: {
      healthScore: 94,
      securityScore: 96,
      codeQualityScore: 91,
      technicalDebt: 'Low',
      apiReliabilityScore: 98,
      testCoverage: 89.1,
      duplicatedLines: 1.1,
      complexityScore: 'Low',
      totalFiles: 146,
      linesOfCode: 26400,
      languages: [
        { name: 'Go', percentage: 92.4, color: '#00add8' },
        { name: 'Protocol Buffers', percentage: 5.6, color: '#5b5b5b' },
        { name: 'Docker', percentage: 2.0, color: '#38bdf8' }
      ],
      functionsCount: 880,
      classesCount: 64,
      dependenciesCount: 41,
      apisDetectedCount: 24
    },
    riskSummary: {
      critical: 0,
      high: 1,
      medium: 4,
      low: 7
    }
  },
  {
    id: 'internal-dashboard',
    name: 'internal-dashboard',
    organization: 'HitachiSystems',
    description: 'Engineering ops control center, feature flag toggles, and incident retrospectives.',
    primaryLanguage: 'TypeScript',
    defaultBranch: 'main',
    branches: ['main', 'preview', 'refactor/grid-system'],
    visibility: 'Private',
    lastAnalyzed: '2 hours ago',
    lastAnalyzedTimestamp: '2026-08-21T11:22:00Z',
    status: 'Analyzed',
    stars: 19,
    forks: 4,
    openPrsCount: 5,
    metrics: {
      healthScore: 68,
      securityScore: 74,
      codeQualityScore: 64,
      technicalDebt: 'High',
      apiReliabilityScore: 80,
      testCoverage: 51.2,
      duplicatedLines: 7.8,
      complexityScore: 'High',
      totalFiles: 360,
      linesOfCode: 58200,
      languages: [
        { name: 'TypeScript', percentage: 84.0, color: '#3178c6' },
        { name: 'CSS', percentage: 11.5, color: '#38bdf8' },
        { name: 'HTML', percentage: 4.5, color: '#e34c26' }
      ],
      functionsCount: 2100,
      classesCount: 95,
      dependenciesCount: 164,
      apisDetectedCount: 16
    },
    riskSummary: {
      critical: 2,
      high: 6,
      medium: 18,
      low: 29
    }
  },
  {
    id: 'authentication-service',
    name: 'authentication-service',
    organization: 'HitachiSystems',
    description: 'Zero-trust identity broker, SAML/OIDC federations, session token revocation ring.',
    primaryLanguage: 'Rust',
    defaultBranch: 'main',
    branches: ['main', 'master', 'security/mfa-fido2'],
    visibility: 'Internal',
    lastAnalyzed: '45 minutes ago',
    lastAnalyzedTimestamp: '2026-08-21T12:37:00Z',
    status: 'Analyzed',
    stars: 64,
    forks: 18,
    openPrsCount: 1,
    metrics: {
      healthScore: 92,
      securityScore: 95,
      codeQualityScore: 89,
      technicalDebt: 'Low',
      apiReliabilityScore: 96,
      testCoverage: 92.5,
      duplicatedLines: 0.8,
      complexityScore: 'Low',
      totalFiles: 98,
      linesOfCode: 19800,
      languages: [
        { name: 'Rust', percentage: 95.8, color: '#dea584' },
        { name: 'Shell', percentage: 4.2, color: '#89e051' }
      ],
      functionsCount: 620,
      classesCount: 42,
      dependenciesCount: 38,
      apisDetectedCount: 19
    },
    riskSummary: {
      critical: 0,
      high: 1,
      medium: 3,
      low: 5
    }
  }
];

export const mockAvailableGithubRepos = [
  {
    name: 'payment-service',
    organization: 'HitachiSystems',
    primaryLanguage: 'TypeScript',
    visibility: 'Private',
    lastUpdated: 'Updated 10m ago',
    stars: 48,
    isImported: true
  },
  {
    name: 'customer-api',
    organization: 'HitachiSystems',
    primaryLanguage: 'Go',
    visibility: 'Private',
    lastUpdated: 'Updated 2h ago',
    stars: 32,
    isImported: true
  },
  {
    name: 'internal-dashboard',
    organization: 'HitachiSystems',
    primaryLanguage: 'TypeScript',
    visibility: 'Private',
    lastUpdated: 'Updated yesterday',
    stars: 19,
    isImported: true
  },
  {
    name: 'authentication-service',
    organization: 'HitachiSystems',
    primaryLanguage: 'Rust',
    visibility: 'Internal',
    lastUpdated: 'Updated 3h ago',
    stars: 64,
    isImported: true
  },
  {
    name: 'inventory-worker',
    organization: 'HitachiSystems',
    primaryLanguage: 'Python',
    visibility: 'Private',
    lastUpdated: 'Updated 2 days ago',
    stars: 8,
    isImported: false
  },
  {
    name: 'billing-ledger-db',
    organization: 'HitachiSystems',
    primaryLanguage: 'SQL',
    visibility: 'Private',
    lastUpdated: 'Updated 4 days ago',
    stars: 14,
    isImported: false
  },
  {
    name: 'notification-dispatcher',
    organization: 'HitachiSystems',
    primaryLanguage: 'Go',
    visibility: 'Internal',
    lastUpdated: 'Updated 5 days ago',
    stars: 21,
    isImported: false
  }
];
