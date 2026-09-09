/**
 * Security Intelligence REST API Routes
 * Checkpoint 9 Phase E
 *
 * Mounted at /api/repositories/:id/security
 * Enforces strict tenant isolation and exposes:
 * - GET /: Latest security scan summary & posture score
 * - GET /vulnerabilities: Filtered, paginated vulnerability findings
 * - GET /vulnerabilities/:vulnerabilityId: Deep finding details
 * - GET /dependencies: Dependency vulnerability exposure inventory
 * - GET /trajectory: Longitudinal security posture timeline & deltas
 * - POST /scan: Trigger on-demand security scan for snapshot
 */

import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import { pool } from '../db/pool.js';
import { logger } from '../utils/logger.js';
import { scanSnapshotSecurity } from '../services/intelligence/vulnerabilityMatcher.js';
import { getRepositorySecurityTrajectory } from '../services/intelligence/trajectoryEngine.js';

export const securityRouter = express.Router({ mergeParams: true });

/**
 * Validates repository existence and ownership for the authenticated tenant.
 * Returns 404 (not 403) to prevent leaking repository existence across tenants.
 * @param {string} repositoryId
 * @param {string} userId
 * @returns {Promise<Object>}
 */
async function verifyRepositoryOwnership(repositoryId, userId) {
  const { rows } = await pool.query(
    'SELECT * FROM repositories WHERE id = $1 AND user_id = $2',
    [repositoryId, userId]
  );
  if (rows.length === 0) {
    const err = new Error('Repository not found or access denied.');
    err.status = 404;
    throw err;
  }
  return rows[0];
}

/**
 * Retrieves the latest snapshot for a repository
 * @param {string} repositoryId
 * @returns {Promise<Object|null>}
 */
async function getLatestSnapshot(repositoryId) {
  const { rows } = await pool.query(
    'SELECT * FROM repository_snapshots WHERE repository_id = $1 ORDER BY created_at DESC LIMIT 1',
    [repositoryId]
  );
  return rows[0] || null;
}

/**
 * GET /api/repositories/:id/security
 * Returns the latest security scan overview and security posture score.
 */
securityRouter.get('/', requireAuth, async (req, res, next) => {
  try {
    const { id: repositoryId } = req.params;
    await verifyRepositoryOwnership(repositoryId, req.user.id);

    const latestSnapshot = await getLatestSnapshot(repositoryId);
    if (!latestSnapshot) {
      return res.json({
        scan: null,
        posture: {
          score: 100,
          totalVulnerabilities: 0,
          severityBreakdown: { critical: 0, high: 0, medium: 0, low: 0, unknown: 0 },
          directVulnerabilities: 0,
          transitiveVulnerabilities: 0,
          vulnerablePackages: 0,
          totalDependencies: 0
        },
        message: 'No snapshots available for repository.'
      });
    }

    // Fetch latest completed security scan for this snapshot
    const { rows: scanRows } = await pool.query(
      'SELECT * FROM security_scans WHERE snapshot_id = $1 AND status = \'completed\' ORDER BY created_at DESC LIMIT 1',
      [latestSnapshot.id]
    );

    let scan = scanRows[0];

    // If no completed scan exists yet, check if dependencies exist and run scan on-the-fly
    if (!scan) {
      const { rows: depCount } = await pool.query(
        'SELECT COUNT(*) as count FROM snapshot_dependencies WHERE snapshot_id = $1',
        [latestSnapshot.id]
      );
      if (parseInt(depCount[0]?.count || 0, 10) > 0) {
        try {
          scan = await scanSnapshotSecurity(latestSnapshot.id, repositoryId, {}, pool);
        } catch (scanErr) {
          logger.warn({ snapshotId: latestSnapshot.id, err: scanErr.message }, 'Failed on-the-fly scan');
        }
      }
    }

    const postureScore = scan?.security_score ?? 100;
    const severityBreakdown = {
      critical: scan?.critical_count ?? 0,
      high: scan?.high_count ?? 0,
      medium: scan?.medium_count ?? 0,
      low: scan?.low_count ?? 0,
      unknown: scan?.unknown_count ?? 0
    };

    return res.json({
      snapshot: {
        id: latestSnapshot.id,
        commitSha: latestSnapshot.commit_sha,
        branch: latestSnapshot.branch,
        createdAt: latestSnapshot.created_at
      },
      scan: scan ? {
        id: scan.id,
        snapshotId: scan.snapshot_id,
        status: scan.status,
        securityScore: scan.security_score,
        totalDependencies: scan.total_dependencies,
        vulnerablePackages: scan.vulnerable_packages,
        totalVulnerabilities: scan.total_vulnerabilities,
        severityBreakdown,
        directVulnerabilities: scan.direct_vulnerabilities,
        transitiveVulnerabilities: scan.transitive_vulnerabilities,
        scanDurationMs: scan.scan_duration_ms,
        completedAt: scan.completed_at
      } : null,
      posture: {
        score: postureScore,
        totalVulnerabilities: scan?.total_vulnerabilities ?? 0,
        severityBreakdown,
        directVulnerabilities: scan?.direct_vulnerabilities ?? 0,
        transitiveVulnerabilities: scan?.transitive_vulnerabilities ?? 0,
        vulnerablePackages: scan?.vulnerable_packages ?? 0,
        totalDependencies: scan?.total_dependencies ?? 0
      }
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/repositories/:id/security/vulnerabilities
 * Lists vulnerability findings for the snapshot with filtering and pagination.
 */
securityRouter.get('/vulnerabilities', requireAuth, async (req, res, next) => {
  try {
    const { id: repositoryId } = req.params;
    await verifyRepositoryOwnership(repositoryId, req.user.id);

    const snapshotId = req.query.snapshotId || (await getLatestSnapshot(repositoryId))?.id;
    if (!snapshotId) {
      return res.json({
        vulnerabilities: [],
        pagination: { total: 0, page: 1, limit: 50, totalPages: 0 }
      });
    }

    const {
      severity,
      scope,
      status,
      search,
      page = 1,
      limit = 50
    } = req.query;

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 50));
    const offset = (pageNum - 1) * limitNum;

    let whereClause = 'WHERE sv.snapshot_id = $1';
    const params = [snapshotId];
    let paramIdx = 2;

    if (severity && severity !== 'ALL') {
      whereClause += ` AND UPPER(sv.severity) = $${paramIdx++}`;
      params.push(severity.toUpperCase());
    }

    if (scope && scope !== 'ALL') {
      if (scope.toLowerCase() === 'direct') {
        whereClause += ` AND sv.is_direct = true`;
      } else if (scope.toLowerCase() === 'transitive') {
        whereClause += ` AND sv.is_direct = false`;
      }
    }

    if (status && status !== 'ALL') {
      whereClause += ` AND sv.status = $${paramIdx++}`;
      params.push(status);
    }

    if (search && search.trim()) {
      const q = `%${search.trim()}%`;
      whereClause += ` AND (
        sv.package_name ILIKE $${paramIdx} OR
        sv.canonical_id ILIKE $${paramIdx} OR
        sv.title ILIKE $${paramIdx} OR
        $${paramIdx} = ANY(sv.aliases)
      )`;
      params.push(q);
      paramIdx++;
    }

    // Count query
    const countQuery = `
      SELECT COUNT(*) AS total
      FROM snapshot_vulnerabilities sv
      ${whereClause}
    `;
    const { rows: countRows } = await pool.query(countQuery, params);
    const total = parseInt(countRows[0]?.total || 0, 10);

    // Data query with severity ranking: CRITICAL > HIGH > MEDIUM > LOW > UNKNOWN
    const dataQuery = `
      SELECT
        sv.id,
        sv.snapshot_id,
        sv.canonical_id,
        sv.aliases,
        sv.package_name,
        sv.installed_version,
        sv.is_direct,
        sv.dependency_scope,
        sv.depth,
        sv.parent_package,
        sv.source_file,
        sv.severity,
        sv.cvss_score,
        sv.cvss_vector,
        sv.title,
        sv.description,
        sv.remediation,
        sv.fixed_versions,
        sv.status,
        sv.first_seen_snapshot_id,
        sv.created_at
      FROM snapshot_vulnerabilities sv
      ${whereClause}
      ORDER BY
        CASE UPPER(sv.severity)
          WHEN 'CRITICAL' THEN 1
          WHEN 'HIGH' THEN 2
          WHEN 'MEDIUM' THEN 3
          WHEN 'LOW' THEN 4
          ELSE 5
        END ASC,
        sv.package_name ASC
      LIMIT $${paramIdx++} OFFSET $${paramIdx++}
    `;

    params.push(limitNum, offset);
    const { rows: dataRows } = await pool.query(dataQuery, params);

    const vulnerabilities = dataRows.map(r => ({
      id: r.id,
      snapshotId: r.snapshot_id,
      canonicalId: r.canonical_id,
      aliases: r.aliases || [],
      packageName: r.package_name,
      installedVersion: r.installed_version,
      isDirect: r.is_direct,
      dependencyScope: r.dependency_scope,
      depth: r.depth,
      parentPackage: r.parent_package,
      sourceFile: r.source_file,
      severity: r.severity,
      cvssScore: r.cvss_score,
      cvssVector: r.cvss_vector,
      title: r.title,
      description: r.description,
      remediation: r.remediation,
      fixedVersions: r.fixed_versions || [],
      status: r.status,
      firstSeenSnapshotId: r.first_seen_snapshot_id,
      createdAt: r.created_at
    }));

    return res.json({
      vulnerabilities,
      pagination: {
        total,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(total / limitNum)
      }
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/repositories/:id/security/vulnerabilities/:vulnerabilityId
 * Deep finding details including external references and full remediation context.
 */
securityRouter.get('/vulnerabilities/:vulnerabilityId', requireAuth, async (req, res, next) => {
  try {
    const { id: repositoryId, vulnerabilityId } = req.params;
    await verifyRepositoryOwnership(repositoryId, req.user.id);

    const query = `
      SELECT
        sv.*,
        va.advisory_references,
        va.published_at,
        va.modified_at
      FROM snapshot_vulnerabilities sv
      LEFT JOIN vulnerability_advisories va ON sv.advisory_id = va.id
      WHERE sv.id = $1 AND sv.repository_id = $2
    `;

    const { rows } = await pool.query(query, [vulnerabilityId, repositoryId]);
    if (rows.length === 0) {
      return res.status(404).json({
        error: {
          message: 'Vulnerability finding not found.',
          status: 404
        }
      });
    }

    const r = rows[0];
    return res.json({
      id: r.id,
      snapshotId: r.snapshot_id,
      repositoryId: r.repository_id,
      dependencyId: r.dependency_id,
      advisoryId: r.advisory_id,
      canonicalId: r.canonical_id,
      aliases: r.aliases || [],
      packageName: r.package_name,
      installedVersion: r.installed_version,
      isDirect: r.is_direct,
      dependencyScope: r.dependency_scope,
      depth: r.depth,
      parentPackage: r.parent_package,
      sourceFile: r.source_file,
      severity: r.severity,
      cvssScore: r.cvss_score,
      cvssVector: r.cvss_vector,
      title: r.title,
      description: r.description,
      remediation: r.remediation,
      fixedVersions: r.fixed_versions || [],
      status: r.status,
      advisoryReferences: r.advisory_references || [],
      publishedAt: r.published_at,
      modifiedAt: r.modified_at,
      firstSeenSnapshotId: r.first_seen_snapshot_id,
      resolvedAtSnapshotId: r.resolved_at_snapshot_id,
      createdAt: r.created_at
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/repositories/:id/security/dependencies
 * Returns dependency inventory annotated with vulnerability exposure.
 */
securityRouter.get('/dependencies', requireAuth, async (req, res, next) => {
  try {
    const { id: repositoryId } = req.params;
    await verifyRepositoryOwnership(repositoryId, req.user.id);

    const snapshotId = req.query.snapshotId || (await getLatestSnapshot(repositoryId))?.id;
    if (!snapshotId) {
      return res.json({ dependencies: [], total: 0 });
    }

    // Fetch snapshot dependencies
    const depQuery = `
      SELECT
        sd.id,
        sd.package_name,
        sd.ecosystem,
        sd.version,
        sd.is_direct,
        sd.dependency_type AS dependency_scope,
        sd.depth,
        sd.parent_package,
        sd.source_file,
        COALESCE(
          json_agg(
            json_build_object(
              'id', sv.id,
              'canonicalId', sv.canonical_id,
              'severity', sv.severity,
              'cvssScore', sv.cvss_score,
              'title', sv.title
            )
          ) FILTER (WHERE sv.id IS NOT NULL),
          '[]'
        ) AS vulnerabilities
      FROM snapshot_dependencies sd
      LEFT JOIN snapshot_vulnerabilities sv
        ON sd.snapshot_id = sv.snapshot_id AND sd.package_name = sv.package_name
      WHERE sd.snapshot_id = $1
      GROUP BY sd.id
      ORDER BY sd.is_direct DESC, sd.package_name ASC
    `;

    const { rows } = await pool.query(depQuery, [snapshotId]);

    const dependencies = rows.map(r => {
      const vulns = Array.isArray(r.vulnerabilities) ? r.vulnerabilities : [];
      let maxSeverity = null;
      const rank = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1, UNKNOWN: 0 };
      let maxScore = -1;

      for (const v of vulns) {
        const score = rank[(v.severity || '').toUpperCase()] ?? -1;
        if (score > maxScore) {
          maxScore = score;
          maxSeverity = v.severity;
        }
      }

      return {
        id: r.id,
        name: r.package_name,
        ecosystem: r.ecosystem,
        version: r.version,
        isDirect: r.is_direct,
        dependencyScope: r.dependency_scope,
        depth: r.depth,
        parentPackage: r.parent_package,
        sourceFile: r.source_file,
        vulnerabilitiesCount: vulns.length,
        maxSeverity,
        vulnerabilities: vulns
      };
    });

    let filtered = dependencies;
    if (req.query.vulnerableOnly === 'true') {
      filtered = filtered.filter(d => d.vulnerabilitiesCount > 0);
    }
    if (req.query.search) {
      const q = req.query.search.toLowerCase();
      filtered = filtered.filter(d => d.name.toLowerCase().includes(q));
    }

    return res.json({
      dependencies: filtered,
      total: filtered.length
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/repositories/:id/security/trajectory
 * Returns longitudinal security score and vulnerability trend timeline across snapshots.
 */
securityRouter.get('/trajectory', requireAuth, async (req, res, next) => {
  try {
    const { id: repositoryId } = req.params;
    await verifyRepositoryOwnership(repositoryId, req.user.id);

    const trajectory = await getRepositorySecurityTrajectory(repositoryId, pool);
    return res.json({ trajectory });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/repositories/:id/security/scan
 * Triggers an on-demand security scan for a snapshot.
 */
securityRouter.post('/scan', requireAuth, async (req, res, next) => {
  try {
    const { id: repositoryId } = req.params;
    await verifyRepositoryOwnership(repositoryId, req.user.id);

    let snapshotId = req.body.snapshotId;
    if (!snapshotId) {
      const latestSnapshot = await getLatestSnapshot(repositoryId);
      if (!latestSnapshot) {
        return res.status(400).json({
          error: { message: 'No snapshot found to scan.', status: 400 }
        });
      }
      snapshotId = latestSnapshot.id;
    }

    const scanResult = await scanSnapshotSecurity(snapshotId, repositoryId, {
      bypassCache: req.body.bypassCache === true
    }, pool);

    return res.status(200).json({
      message: 'Security scan completed successfully.',
      scan: scanResult
    });
  } catch (err) {
    next(err);
  }
});
