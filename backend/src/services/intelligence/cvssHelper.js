/**
 * CVSS v3.1 Base Score Calculator & Severity Normalizer
 * Implements the FIRST CVSS v3.1 specification equations deterministically.
 */

/**
 * Parses CVSS v3.0 / v3.1 vector string and calculates the base score.
 * Formula per FIRST CVSS v3.1 Specification: https://www.first.org/cvss/v3.1/specification-document
 * @param {string} vectorString - e.g. "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H"
 * @returns {number|null} CVSS Base Score (0.0 - 10.0) rounded up to 1 decimal place, or null if unparseable
 */
export function calculateCvssV3Score(vectorString) {
  if (!vectorString || typeof vectorString !== 'string') return null;

  const match = vectorString.match(/CVSS:3\.[01]\/([A-Z0-9:/]+)/i);
  if (!match) return null;

  const parts = vectorString.split('/');
  const metrics = {};
  for (const part of parts) {
    const [key, val] = part.split(':');
    if (key && val) {
      metrics[key.toUpperCase()] = val.toUpperCase();
    }
  }

  // Attack Vector (AV)
  const AV_MAP = { N: 0.85, A: 0.62, L: 0.55, P: 0.2 };
  // Attack Complexity (AC)
  const AC_MAP = { L: 0.77, H: 0.44 };
  // User Interaction (UI)
  const UI_MAP = { N: 0.85, R: 0.62 };
  // Confidentiality, Integrity, Availability (CIA)
  const CIA_MAP = { N: 0.0, L: 0.22, H: 0.56 };

  const av = AV_MAP[metrics.AV];
  const ac = AC_MAP[metrics.AC];
  const ui = UI_MAP[metrics.UI];
  const s = metrics.S || 'U'; // Scope: Unchanged (U) or Changed (C)

  if (av === undefined || ac === undefined || ui === undefined) {
    return null;
  }

  // Privileges Required (PR) depends on Scope
  let pr;
  if (s === 'C') {
    const PR_CHANGED = { N: 0.85, L: 0.68, H: 0.50 };
    pr = PR_CHANGED[metrics.PR];
  } else {
    const PR_UNCHANGED = { N: 0.85, L: 0.62, H: 0.27 };
    pr = PR_UNCHANGED[metrics.PR];
  }

  if (pr === undefined) return null;

  const c = CIA_MAP[metrics.C] ?? 0.0;
  const i = CIA_MAP[metrics.I] ?? 0.0;
  const a = CIA_MAP[metrics.A] ?? 0.0;

  // Impact Sub-Score (ISS)
  const iss = 1 - ((1 - c) * (1 - i) * (1 - a));

  // Exploitability
  const exploitability = 8.22 * av * ac * pr * ui;

  let baseScore = 0;
  if (iss <= 0) {
    baseScore = 0;
  } else if (s === 'U') {
    const impact = 6.42 * iss;
    baseScore = Math.min(impact + exploitability, 10);
  } else {
    const impact = 7.52 * (iss - 0.029) - 3.25 * Math.pow(iss - 0.02, 15);
    baseScore = Math.min(1.08 * (impact + exploitability), 10);
  }

  // Roundup function per spec: round up to 1 decimal place
  const rounded = Math.ceil(Math.round(baseScore * 100000) / 10000) / 10;
  return Math.max(0, Math.min(10, rounded));
}

/**
 * Normalizes severity levels across qualitative ratings and CVSS scores
 * @param {string|null} severityStr - e.g. "CRITICAL", "HIGH", "MODERATE", "LOW"
 * @param {number|null} cvssScore - numeric CVSS score (0.0 - 10.0)
 * @returns {'CRITICAL'|'HIGH'|'MEDIUM'|'LOW'|'UNKNOWN'}
 */
export function normalizeSeverity(severityStr, cvssScore) {
  if (cvssScore !== null && cvssScore !== undefined && !isNaN(cvssScore)) {
    const score = Number(cvssScore);
    if (score >= 9.0) return 'CRITICAL';
    if (score >= 7.0) return 'HIGH';
    if (score >= 4.0) return 'MEDIUM';
    if (score > 0.0) return 'LOW';
  }

  const s = (severityStr || '').toUpperCase().trim();
  if (s === 'CRITICAL') return 'CRITICAL';
  if (s === 'HIGH') return 'HIGH';
  if (s === 'MEDIUM' || s === 'MODERATE') return 'MEDIUM';
  if (s === 'LOW') return 'LOW';

  return 'UNKNOWN';
}

/**
 * Resolves the canonical advisory identity preferring CVE > GHSA > primary ID
 * @param {Object} advisory - OSV advisory object
 * @returns {string} Canonical identifier (e.g. "CVE-2021-23424", "GHSA-xxxx-yyyy-zzzz")
 */
export function extractCanonicalId(advisory) {
  if (!advisory) return 'UNKNOWN';

  const id = (advisory.id || '').trim();
  const aliases = Array.isArray(advisory.aliases) ? advisory.aliases.map(a => (a || '').trim()) : [];
  const allIds = [id, ...aliases].filter(Boolean);

  // 1. CVE identifier preferred
  const cveIds = allIds.filter(i => /^CVE-\d{4}-\d+/i.test(i));
  if (cveIds.length > 0) {
    cveIds.sort((a, b) => a.localeCompare(b));
    return cveIds[0].toUpperCase();
  }

  // 2. GHSA identifier preferred next
  const ghsaIds = allIds.filter(i => /^GHSA-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}/i.test(i));
  if (ghsaIds.length > 0) {
    ghsaIds.sort((a, b) => a.localeCompare(b));
    return ghsaIds[0];
  }

  // 3. Fallback to primary ID
  return id || 'UNKNOWN';
}

/**
 * Extracts CVSS score, vector, and severity from an OSV advisory object
 * @param {Object} advisory - Raw OSV advisory
 * @returns {{ cvssScore: number|null, cvssVector: string|null, severity: string }}
 */
export function extractCvssAndSeverity(advisory) {
  let cvssScore = null;
  let cvssVector = null;
  let rawSeverity = null;

  // Check database_specific CVSS
  if (advisory?.database_specific) {
    const ds = advisory.database_specific;
    if (ds.cvss) {
      if (typeof ds.cvss.score === 'number') cvssScore = ds.cvss.score;
      if (typeof ds.cvss.vectorString === 'string') cvssVector = ds.cvss.vectorString;
    }
    if (typeof ds.severity === 'string') rawSeverity = ds.severity;
  }

  // Check severity array (standard in OSV schema)
  if (Array.isArray(advisory?.severity)) {
    for (const s of advisory.severity) {
      if (s.type === 'CVSS_V3' && typeof s.score === 'string') {
        cvssVector = s.score;
        const calculated = calculateCvssV3Score(s.score);
        if (calculated !== null && cvssScore === null) {
          cvssScore = calculated;
        }
      }
    }
  }

  // If we have a vector but no score yet, calculate it
  if (cvssVector && cvssScore === null) {
    cvssScore = calculateCvssV3Score(cvssVector);
  }

  const normalized = normalizeSeverity(rawSeverity, cvssScore);

  return {
    cvssScore,
    cvssVector,
    severity: normalized
  };
}
