/**
 * Resilient OSV Client & Global Advisory Cache
 * Checkpoint 9 Phase C
 *
 * Implements batched queries to OSV API (https://api.osv.dev/v1/querybatch),
 * exponential backoff retry for network errors and rate limits (429/5xx),
 * deduplication, and PostgreSQL two-tier caching (package_query_cache + vulnerability_advisories).
 */

import { pool } from '../../db/pool.js';
import { logger } from '../../utils/logger.js';
import { normalizePackageName } from './lockfileParser.js';
import { extractCanonicalId, extractCvssAndSeverity } from './cvssHelper.js';

const OSV_BATCH_URL = process.env.OSV_API_BATCH_URL || 'https://api.osv.dev/v1/querybatch';
const OSV_VULN_URL = process.env.OSV_API_VULN_URL || 'https://api.osv.dev/v1/vulns';
const MAX_BATCH_CHUNK_SIZE = 250;
const DEFAULT_TIMEOUT_MS = 10000;
const CACHE_TTL_HOURS = 24;

/**
 * Normalizes OSV references array
 * @param {Array} references
 * @returns {Array}
 */
function normalizeReferences(references) {
  if (!Array.isArray(references)) return [];
  return references.map(ref => ({
    type: ref.type || 'WEB',
    url: ref.url || ''
  })).filter(r => Boolean(r.url));
}

/**
 * Normalizes affected ranges, versions, and fixed versions from OSV advisory
 * @param {Array} affected
 * @returns {{ ranges: Array, versions: Array<string>, fixedVersions: Array<string> }}
 */
function extractAffectedRangesAndVersions(affected) {
  if (!Array.isArray(affected)) {
    return { ranges: [], versions: [], fixedVersions: [] };
  }

  const ranges = [];
  const versionsSet = new Set();
  const fixedVersionsSet = new Set();

  for (const item of affected) {
    if (Array.isArray(item.versions)) {
      for (const v of item.versions) {
        if (typeof v === 'string') versionsSet.add(v.trim());
      }
    }

    if (Array.isArray(item.ranges)) {
      for (const r of item.ranges) {
        ranges.push(r);
        if (Array.isArray(r.events)) {
          for (const ev of r.events) {
            if (ev.fixed && typeof ev.fixed === 'string') {
              fixedVersionsSet.add(ev.fixed.trim());
            }
          }
        }
      }
    }
  }

  return {
    ranges,
    versions: Array.from(versionsSet),
    fixedVersions: Array.from(fixedVersionsSet)
  };
}

/**
 * Sleeps for specified milliseconds
 * @param {number} ms
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Executes a single chunk of OSV batch query with exponential backoff retry
 * @param {Array<Object>} queries - Array of { package: { name, ecosystem }, version }
 * @param {Object} options - { maxAttempts, timeoutMs }
 * @returns {Promise<Array<Object>>} Array of { vulns: [...] }
 */
async function executeBatchChunkWithRetry(queries, options = {}) {
  const maxAttempts = options.maxAttempts || 3;
  const timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;

  let attempt = 0;
  while (attempt < maxAttempts) {
    attempt++;
    try {
      logger.debug({ chunkLength: queries.length, attempt }, 'Executing OSV batch query chunk');

      const response = await fetch(OSV_BATCH_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify({ queries }),
        signal: AbortSignal.timeout(timeoutMs)
      });

      if (response.status === 429 || (response.status >= 500 && response.status <= 599)) {
        const backoffMs = 500 * Math.pow(2, attempt - 1);
        logger.warn({ status: response.status, attempt, backoffMs }, 'OSV rate limit or server error, backing off');
        if (attempt < maxAttempts) {
          await sleep(backoffMs);
          continue;
        }
      }

      if (!response.ok) {
        const errText = await response.text().catch(() => '');
        throw new Error(`OSV API returned HTTP ${response.status}: ${errText.slice(0, 200)}`);
      }

      const data = await response.json();
      if (Array.isArray(data?.results)) {
        return data.results;
      }

      return queries.map(() => ({ vulns: [] }));
    } catch (err) {
      const backoffMs = 500 * Math.pow(2, attempt - 1);
      logger.warn({ attempt, maxAttempts, err: err.message, backoffMs }, 'OSV batch request failed');

      if (attempt < maxAttempts) {
        await sleep(backoffMs);
      } else {
        logger.error({ err: err.message, chunkLength: queries.length }, 'Exhausted OSV retries for chunk');
        // Graceful fallback: return empty results so the pipeline proceeds without crashing
        return queries.map(() => ({ vulns: [] }));
      }
    }
  }

  return queries.map(() => ({ vulns: [] }));
}

/**
 * Checks PostgreSQL cache for known package-version advisories
 * @param {Array<Object>} uniquePackages - [{ ecosystem, name, normalizedName, version }]
 * @param {Object} dbPool
 * @returns {Promise<{ cacheHits: Map<string, Array<Object>>, cacheMisses: Array<Object> }>}
 */
async function checkDatabaseCache(uniquePackages, dbPool = pool) {
  const cacheHits = new Map();
  const cacheMisses = [];

  if (uniquePackages.length === 0) {
    return { cacheHits, cacheMisses };
  }

  try {
    // Build parameterized query to check package_query_cache
    // Cache valid within CACHE_TTL_HOURS
    const keys = uniquePackages.map(p => `${p.ecosystem}:::${p.normalizedName}:::${p.version}`);
    
    const query = `
      SELECT ecosystem, normalized_name, version, advisory_ids, queried_at
      FROM package_query_cache
      WHERE (ecosystem || ':::' || normalized_name || ':::' || version) = ANY($1)
        AND queried_at > NOW() - INTERVAL '${CACHE_TTL_HOURS} hours'
    `;

    const { rows } = await dbPool.query(query, [keys]);
    const cachedRowsMap = new Map();
    const allAdvisoryIds = new Set();

    for (const row of rows) {
      const key = `${row.ecosystem}:::${row.normalized_name}:::${row.version}`;
      cachedRowsMap.set(key, row.advisory_ids || []);
      for (const advId of (row.advisory_ids || [])) {
        allAdvisoryIds.add(advId);
      }
    }

    // Fetch vulnerability advisories details for non-empty cached rows
    const advisoriesById = new Map();
    if (allAdvisoryIds.size > 0) {
      const advQuery = `
        SELECT *
        FROM vulnerability_advisories
        WHERE id = ANY($1)
      `;
      const { rows: advRows } = await dbPool.query(advQuery, [Array.from(allAdvisoryIds)]);
      for (const adv of advRows) {
        advisoriesById.set(adv.id, adv);
      }
    }

    for (const pkg of uniquePackages) {
      const key = `${pkg.ecosystem}:::${pkg.normalizedName}:::${pkg.version}`;
      if (cachedRowsMap.has(key)) {
        const advIds = cachedRowsMap.get(key);
        const vulns = advIds.map(id => advisoriesById.get(id)).filter(Boolean);
        cacheHits.set(key, vulns);
      } else {
        cacheMisses.push(pkg);
      }
    }
  } catch (err) {
    logger.warn({ err: err.message }, 'Failed reading from package_query_cache, falling back to full OSV query');
    return { cacheHits: new Map(), cacheMisses: uniquePackages };
  }

  return { cacheHits, cacheMisses };
}

/**
 * Persists OSV advisories and updates package query cache in PostgreSQL
 * @param {Array<Object>} queryItems - [{ ecosystem, name, normalizedName, version }]
 * @param {Array<Object>} results - [{ vulns: [...] }] matching index of queryItems
 * @param {Object} dbPool
 * @returns {Promise<void>}
 */
async function storeAdvisoriesAndCache(queryItems, results, dbPool = pool) {
  if (queryItems.length === 0 || !results || results.length === 0) return;

  const client = await dbPool.connect();
  try {
    await client.query('BEGIN');

    // 1. Collect all unique advisories from results
    const uniqueAdvisories = new Map();

    for (let i = 0; i < queryItems.length; i++) {
      const pkg = queryItems[i];
      const result = results[i];
      const vulns = Array.isArray(result?.vulns) ? result.vulns : [];

      for (const rawAdv of vulns) {
        if (!rawAdv?.id) continue;
        if (!uniqueAdvisories.has(rawAdv.id)) {
          const canonicalId = extractCanonicalId(rawAdv);
          const { cvssScore, cvssVector, severity } = extractCvssAndSeverity(rawAdv);
          const { ranges, versions, fixedVersions } = extractAffectedRangesAndVersions(rawAdv.affected);
          const refs = normalizeReferences(rawAdv.references);

          uniqueAdvisories.set(rawAdv.id, {
            id: rawAdv.id,
            canonicalId,
            aliases: Array.isArray(rawAdv.aliases) ? rawAdv.aliases : [],
            ecosystem: pkg.ecosystem,
            packageName: pkg.name,
            normalizedName: pkg.normalizedName,
            summary: rawAdv.summary || '',
            details: rawAdv.details || '',
            severity,
            cvssScore,
            cvssVector,
            affectedRanges: JSON.stringify(ranges),
            affectedVersions: versions,
            fixedVersions,
            advisoryReferences: JSON.stringify(refs),
            publishedAt: rawAdv.published ? new Date(rawAdv.published) : null,
            modifiedAt: rawAdv.modified ? new Date(rawAdv.modified) : null,
            withdrawnAt: rawAdv.withdrawn ? new Date(rawAdv.withdrawn) : null
          });
        }
      }
    }

    // 2. Upsert advisories into vulnerability_advisories
    for (const adv of uniqueAdvisories.values()) {
      const advUpsert = `
        INSERT INTO vulnerability_advisories (
          id, canonical_id, aliases, ecosystem, package_name, normalized_name,
          summary, details, severity, cvss_score, cvss_vector,
          affected_ranges, affected_versions, fixed_versions, advisory_references,
          published_at, modified_at, withdrawn_at, updated_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6,
          $7, $8, $9, $10, $11,
          $12, $13, $14, $15,
          $16, $17, $18, NOW()
        )
        ON CONFLICT (id) DO UPDATE SET
          canonical_id = EXCLUDED.canonical_id,
          aliases = EXCLUDED.aliases,
          summary = EXCLUDED.summary,
          details = EXCLUDED.details,
          severity = EXCLUDED.severity,
          cvss_score = EXCLUDED.cvss_score,
          cvss_vector = EXCLUDED.cvss_vector,
          affected_ranges = EXCLUDED.affected_ranges,
          affected_versions = EXCLUDED.affected_versions,
          fixed_versions = EXCLUDED.fixed_versions,
          advisory_references = EXCLUDED.advisory_references,
          modified_at = EXCLUDED.modified_at,
          withdrawn_at = EXCLUDED.withdrawn_at,
          updated_at = NOW()
      `;

      await client.query(advUpsert, [
        adv.id,
        adv.canonicalId,
        adv.aliases,
        adv.ecosystem,
        adv.packageName,
        adv.normalizedName,
        adv.summary,
        adv.details,
        adv.severity,
        adv.cvssScore,
        adv.cvssVector,
        adv.affectedRanges,
        adv.affectedVersions,
        adv.fixedVersions,
        adv.advisoryReferences,
        adv.publishedAt,
        adv.modifiedAt,
        adv.withdrawnAt
      ]);
    }

    // 3. Upsert query cache entries (including packages with 0 vulnerabilities)
    for (let i = 0; i < queryItems.length; i++) {
      const pkg = queryItems[i];
      const result = results[i];
      const vulns = Array.isArray(result?.vulns) ? result.vulns : [];
      const advisoryIds = vulns.map(v => v.id).filter(Boolean);

      const cacheUpsert = `
        INSERT INTO package_query_cache (
          ecosystem, package_name, normalized_name, version, advisory_ids, queried_at
        ) VALUES (
          $1, $2, $3, $4, $5, NOW()
        )
        ON CONFLICT (ecosystem, normalized_name, version) DO UPDATE SET
          advisory_ids = EXCLUDED.advisory_ids,
          queried_at = NOW()
      `;

      await client.query(cacheUpsert, [
        pkg.ecosystem,
        pkg.name,
        pkg.normalizedName,
        pkg.version,
        advisoryIds
      ]);
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error({ err: err.message }, 'Failed persisting OSV advisories or package query cache');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Primary interface to query vulnerabilities for a list of dependencies.
 * Automatically handles deduplication, caching, batching, and persistence.
 *
 * @param {Array<{ ecosystem: string, name: string, version: string }>} packages
 * @param {Object} options - { bypassCache: boolean, timeoutMs: number, maxAttempts: number }
 * @param {Object} dbPool
 * @returns {Promise<Map<string, Array<Object>>>} Map of `${ecosystem}:::${normalizedName}:::${version}` -> advisories
 */
export async function queryVulnerabilitiesForPackages(packages, options = {}, dbPool = pool) {
  const resultMap = new Map();
  if (!Array.isArray(packages) || packages.length === 0) {
    return resultMap;
  }

  // 1. Deduplicate & normalize packages
  const packageDedupMap = new Map();
  for (const pkg of packages) {
    if (!pkg || !pkg.name || !pkg.version) continue;
    const ecosystem = (pkg.ecosystem || 'npm').toLowerCase();
    const normalizedName = normalizePackageName(ecosystem, pkg.name);
    const version = String(pkg.version).trim();

    // Skip packages with invalid or non-semver URLs
    if (!normalizedName || !version || version.startsWith('git') || version.startsWith('http')) {
      continue;
    }

    const key = `${ecosystem}:::${normalizedName}:::${version}`;
    if (!packageDedupMap.has(key)) {
      packageDedupMap.set(key, {
        ecosystem,
        name: pkg.name,
        normalizedName,
        version
      });
    }
  }

  const uniquePackages = Array.from(packageDedupMap.values());
  if (uniquePackages.length === 0) {
    return resultMap;
  }

  logger.info(
    { totalInput: packages.length, uniquePackages: uniquePackages.length },
    'Processing packages for vulnerability intelligence'
  );

  // 2. Check Database Cache
  let cacheHits = new Map();
  let cacheMisses = uniquePackages;

  if (!options.bypassCache) {
    const cacheResult = await checkDatabaseCache(uniquePackages, dbPool);
    cacheHits = cacheResult.cacheHits;
    cacheMisses = cacheResult.cacheMisses;

    for (const [key, vulns] of cacheHits.entries()) {
      resultMap.set(key, vulns);
    }

    logger.info(
      { cacheHitsCount: cacheHits.size, cacheMissesCount: cacheMisses.length },
      'Evaluated package query cache'
    );
  }

  // 3. Query OSV for Cache Misses
  if (cacheMisses.length > 0) {
    // Chunk cache misses into batches of MAX_BATCH_CHUNK_SIZE
    const chunks = [];
    for (let i = 0; i < cacheMisses.length; i += MAX_BATCH_CHUNK_SIZE) {
      chunks.push(cacheMisses.slice(i, i + MAX_BATCH_CHUNK_SIZE));
    }

    for (const chunk of chunks) {
      const osvQueries = chunk.map(pkg => ({
        package: {
          name: pkg.normalizedName,
          ecosystem: pkg.ecosystem === 'npm' ? 'npm' : pkg.ecosystem
        },
        version: pkg.version
      }));

      const chunkResults = await executeBatchChunkWithRetry(osvQueries, options);

      // Persist advisories and update cache
      try {
        await storeAdvisoriesAndCache(chunk, chunkResults, dbPool);
      } catch (cacheErr) {
        logger.warn({ err: cacheErr.message }, 'Non-fatal error updating cache during batch scan');
      }

      // Populate resultMap for freshly queried items
      for (let i = 0; i < chunk.length; i++) {
        const pkg = chunk[i];
        const res = chunkResults[i];
        const rawVulns = Array.isArray(res?.vulns) ? res.vulns : [];

        // Format each raw vulnerability into normalized object
        const formattedVulns = rawVulns.map(raw => {
          const canonicalId = extractCanonicalId(raw);
          const { cvssScore, cvssVector, severity } = extractCvssAndSeverity(raw);
          const { ranges, versions, fixedVersions } = extractAffectedRangesAndVersions(raw.affected);
          const refs = normalizeReferences(raw.references);

          return {
            id: raw.id,
            canonical_id: canonicalId,
            aliases: raw.aliases || [],
            ecosystem: pkg.ecosystem,
            package_name: pkg.name,
            normalized_name: pkg.normalizedName,
            summary: raw.summary || '',
            details: raw.details || '',
            severity,
            cvss_score: cvssScore,
            cvss_vector: cvssVector,
            affected_ranges: ranges,
            affected_versions: versions,
            fixed_versions: fixedVersions,
            advisory_references: refs,
            published_at: raw.published || null,
            modified_at: raw.modified || null
          };
        });

        const key = `${pkg.ecosystem}:::${pkg.normalizedName}:::${pkg.version}`;
        resultMap.set(key, formattedVulns);
      }
    }
  }

  return resultMap;
}

/**
 * Fetches a single vulnerability by advisory ID (e.g. "GHSA-xxxx-yyyy-zzzz" or "CVE-2023-xxxx")
 * @param {string} advisoryId
 * @param {Object} dbPool
 * @returns {Promise<Object|null>}
 */
export async function getVulnerabilityById(advisoryId, dbPool = pool) {
  if (!advisoryId) return null;

  try {
    const { rows } = await dbPool.query(
      'SELECT * FROM vulnerability_advisories WHERE id = $1 OR canonical_id = $1 OR $1 = ANY(aliases) LIMIT 1',
      [advisoryId]
    );

    if (rows.length > 0) {
      return rows[0];
    }

    // If not found in DB, attempt individual lookup from OSV
    const response = await fetch(`${OSV_VULN_URL}/${encodeURIComponent(advisoryId)}`, {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS)
    });

    if (!response.ok) return null;

    const raw = await response.json();
    if (!raw?.id) return null;

    const canonicalId = extractCanonicalId(raw);
    const { cvssScore, cvssVector, severity } = extractCvssAndSeverity(raw);
    const { ranges, versions, fixedVersions } = extractAffectedRangesAndVersions(raw.affected);
    const refs = normalizeReferences(raw.references);
    const firstPkg = raw.affected?.[0]?.package || { name: '', ecosystem: 'npm' };

    const insertQuery = `
      INSERT INTO vulnerability_advisories (
        id, canonical_id, aliases, ecosystem, package_name, normalized_name,
        summary, details, severity, cvss_score, cvss_vector,
        affected_ranges, affected_versions, fixed_versions, advisory_references,
        published_at, modified_at, withdrawn_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6,
        $7, $8, $9, $10, $11,
        $12, $13, $14, $15,
        $16, $17, $18, NOW()
      )
      ON CONFLICT (id) DO UPDATE SET updated_at = NOW()
      RETURNING *
    `;

    const { rows: inserted } = await dbPool.query(insertQuery, [
      raw.id,
      canonicalId,
      raw.aliases || [],
      firstPkg.ecosystem || 'npm',
      firstPkg.name || '',
      normalizePackageName(firstPkg.ecosystem || 'npm', firstPkg.name || ''),
      raw.summary || '',
      raw.details || '',
      severity,
      cvssScore,
      cvssVector,
      JSON.stringify(ranges),
      versions,
      fixedVersions,
      JSON.stringify(refs),
      raw.published ? new Date(raw.published) : null,
      raw.modified ? new Date(raw.modified) : null,
      raw.withdrawn ? new Date(raw.withdrawn) : null
    ]);

    return inserted[0] || null;
  } catch (err) {
    logger.warn({ advisoryId, err: err.message }, 'Failed fetching individual vulnerability advisory');
    return null;
  }
}
