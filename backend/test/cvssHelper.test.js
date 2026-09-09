import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateCvssV3Score,
  normalizeSeverity,
  extractCanonicalId,
  extractCvssAndSeverity
} from '../src/services/intelligence/cvssHelper.js';

test('CVSS v3.1 calculation and canonical ID tests', async (t) => {
  await t.test('calculateCvssV3Score calculates standard vector scores', () => {
    // Standard Critical Log4j vector
    const log4jVector = 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H';
    const score = calculateCvssV3Score(log4jVector);
    assert.equal(score, 9.8);

    // High severity vector with scope unchanged
    const highVector = 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:H';
    const highScore = calculateCvssV3Score(highVector);
    assert.equal(highScore, 7.5);

    // Scope changed vector (e.g. XSS)
    const scopeChangedVector = 'CVSS:3.1/AV:N/AC:L/PR:N/UI:R/S:C/C:L/I:L/A:N';
    const xssScore = calculateCvssV3Score(scopeChangedVector);
    assert.equal(xssScore, 6.1);

    // Zero impact vector
    const zeroVector = 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:N';
    assert.equal(calculateCvssV3Score(zeroVector), 0);

    // Invalid or null vector
    assert.equal(calculateCvssV3Score('invalid'), null);
    assert.equal(calculateCvssV3Score(null), null);
  });

  await t.test('normalizeSeverity maps numeric scores and qualitative ratings', () => {
    assert.equal(normalizeSeverity(null, 9.8), 'CRITICAL');
    assert.equal(normalizeSeverity(null, 9.0), 'CRITICAL');
    assert.equal(normalizeSeverity(null, 7.5), 'HIGH');
    assert.equal(normalizeSeverity(null, 7.0), 'HIGH');
    assert.equal(normalizeSeverity(null, 5.5), 'MEDIUM');
    assert.equal(normalizeSeverity(null, 4.0), 'MEDIUM');
    assert.equal(normalizeSeverity(null, 2.5), 'LOW');
    assert.equal(normalizeSeverity(null, 0.1), 'LOW');

    // Qualitative fallbacks
    assert.equal(normalizeSeverity('CRITICAL', null), 'CRITICAL');
    assert.equal(normalizeSeverity('critical', null), 'CRITICAL');
    assert.equal(normalizeSeverity('HIGH', null), 'HIGH');
    assert.equal(normalizeSeverity('MODERATE', null), 'MEDIUM');
    assert.equal(normalizeSeverity('MEDIUM', null), 'MEDIUM');
    assert.equal(normalizeSeverity('LOW', null), 'LOW');
    assert.equal(normalizeSeverity('SOMETHING_ELSE', null), 'UNKNOWN');
    assert.equal(normalizeSeverity(null, null), 'UNKNOWN');
  });

  await t.test('extractCanonicalId prioritizes CVE over GHSA over ID', () => {
    // 1. CVE present in aliases -> preferred
    const advWithCve = {
      id: 'GHSA-1234-5678-90ab',
      aliases: ['CVE-2021-23424', 'GHSA-1234-5678-90ab']
    };
    assert.equal(extractCanonicalId(advWithCve), 'CVE-2021-23424');

    // Multiple CVEs -> deterministic lowest
    const advWithMultiCve = {
      id: 'GHSA-1234-5678-90ab',
      aliases: ['CVE-2023-99999', 'CVE-2021-11111']
    };
    assert.equal(extractCanonicalId(advWithMultiCve), 'CVE-2021-11111');

    // 2. No CVE, GHSA present
    const advGhsaOnly = {
      id: 'OSV-2022-100',
      aliases: ['GHSA-abcd-efgh-ijkl']
    };
    assert.equal(extractCanonicalId(advGhsaOnly), 'GHSA-abcd-efgh-ijkl');

    // 3. Neither CVE nor GHSA aliases -> fallback to id
    const advIdFallback = {
      id: 'SNYK-JS-TEST-123',
      aliases: []
    };
    assert.equal(extractCanonicalId(advIdFallback), 'SNYK-JS-TEST-123');

    // Null safety
    assert.equal(extractCanonicalId(null), 'UNKNOWN');
  });

  await t.test('extractCvssAndSeverity extracts scores from OSV database_specific and severity array', () => {
    const rawOsv = {
      id: 'GHSA-test',
      severity: [
        { type: 'CVSS_V3', score: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H' }
      ],
      database_specific: {
        severity: 'CRITICAL'
      }
    };

    const extracted = extractCvssAndSeverity(rawOsv);
    assert.equal(extracted.cvssScore, 9.8);
    assert.equal(extracted.cvssVector, 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H');
    assert.equal(extracted.severity, 'CRITICAL');
  });
});
