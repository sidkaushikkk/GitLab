export const mockDependencies = [
  {
    name: 'jsonwebtoken',
    version: '8.5.1',
    latest: '9.0.2',
    risk: 'CRITICAL',
    vulnerability: 'CVE-2022-23529 (Arbitrary File Write / Insecure Key Object)',
    vulnerabilitySeverity: 'CRITICAL',
    usageCount: 14,
    license: 'MIT',
    direct: true,
    category: 'Authentication',
    upgradeRecommendation: 'Upgrade to 9.0.2 immediately to prevent crafted payload key injection.'
  },
  {
    name: 'stripe',
    version: '13.8.0',
    latest: '15.1.0',
    risk: 'HIGH',
    vulnerability: 'Deprecated 3D Secure API endpoint fallback',
    vulnerabilitySeverity: 'HIGH',
    usageCount: 8,
    license: 'MIT',
    direct: true,
    category: 'Payment Gateway',
    upgradeRecommendation: 'Upgrade to 15.1.0 to support SCA mandates and webhook signatures v3.'
  },
  {
    name: 'ioredis',
    version: '5.3.1',
    latest: '5.4.1',
    risk: 'MEDIUM',
    vulnerability: 'Unchecked cluster reconnection memory leak on network partition',
    vulnerabilitySeverity: 'MEDIUM',
    usageCount: 22,
    license: 'MIT',
    direct: true,
    category: 'Caching & State',
    upgradeRecommendation: 'Upgrade to 5.4.1 for optimized Redis 7 TLS pipeline fixes.'
  },
  {
    name: 'knex',
    version: '2.5.1',
    latest: '3.1.0',
    risk: 'MEDIUM',
    vulnerability: 'Raw query identifier injection in MySQL/PostgreSQL sub-expressions',
    vulnerabilitySeverity: 'MEDIUM',
    usageCount: 31,
    license: 'MIT',
    direct: true,
    category: 'Database ORM',
    upgradeRecommendation: 'Upgrade to 3.1.0 and audit all raw() string interpolation calls.'
  },
  {
    name: 'express',
    version: '4.19.2',
    latest: '4.21.0',
    risk: 'LOW',
    vulnerability: 'None (Up to date on LTS 4.x)',
    vulnerabilitySeverity: 'LOW',
    usageCount: 42,
    license: 'MIT',
    direct: true,
    category: 'Web Framework',
    upgradeRecommendation: 'Safe on 4.19.2. Plan 5.0 migration for upcoming Q4 roadmap.'
  },
  {
    name: 'zod',
    version: '3.22.4',
    latest: '3.23.8',
    risk: 'LOW',
    vulnerability: 'None',
    vulnerabilitySeverity: 'LOW',
    usageCount: 26,
    license: 'MIT',
    direct: true,
    category: 'Data Validation',
    upgradeRecommendation: 'Clean schema validation. No known vulnerabilities.'
  },
  {
    name: 'pg',
    version: '8.11.3',
    latest: '8.12.0',
    risk: 'LOW',
    vulnerability: 'None',
    vulnerabilitySeverity: 'LOW',
    usageCount: 19,
    license: 'MIT',
    direct: true,
    category: 'Database Driver',
    upgradeRecommendation: 'Latest LTS driver connection pool.'
  }
];

export const mockDependencyHealth = {
  total: 92,
  outdated: 14,
  vulnerable: 3,
  highRisk: 2,
  licenseCompliance: '100% Permissive (MIT / Apache 2.0 / BSD)',
  directDependencies: 34,
  transitiveDependencies: 58
};
