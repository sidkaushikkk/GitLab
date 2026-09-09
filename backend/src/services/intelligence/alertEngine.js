import { pool } from '../../db/pool.js';
import { logger } from '../../utils/logger.js';

export const SEVERITY_WEIGHTS = {
  CRITICAL: 4,
  HIGH: 3,
  MEDIUM: 2,
  LOW: 1,
  INFO: 0
};

export const DEFAULT_NOTIFICATION_PREFERENCES = {
  in_app_enabled: true,
  email_enabled: false,
  security_alerts: true,
  pr_risk_alerts: true,
  code_health_alerts: true,
  api_reliability_alerts: true,
  dependency_alerts: true,
  min_severity: 'LOW'
};

/**
 * Normalizes severity string to uppercase valid enum
 */
export function normalizeSeverity(sev) {
  const s = String(sev || 'MEDIUM').toUpperCase();
  if (s in SEVERITY_WEIGHTS) return s;
  if (s === 'MODERATE') return 'MEDIUM';
  return 'MEDIUM';
}

/**
 * Checks whether an alert satisfies user notification preferences
 */
export function shouldNotifyUser(alert, prefs) {
  const p = { ...DEFAULT_NOTIFICATION_PREFERENCES, ...prefs };

  if (!p.in_app_enabled && !p.email_enabled) {
    return false;
  }

  const alertWeight = SEVERITY_WEIGHTS[normalizeSeverity(alert.severity)] ?? 2;
  const minWeight = SEVERITY_WEIGHTS[normalizeSeverity(p.min_severity)] ?? 1;

  if (alertWeight < minWeight) {
    return false;
  }

  const cat = String(alert.category || '').toUpperCase();
  if (cat === 'SECURITY' && !p.security_alerts) return false;
  if (cat === 'PR_RISK' && !p.pr_risk_alerts) return false;
  if (cat === 'CODE_HEALTH' && !p.code_health_alerts) return false;
  if (cat === 'API_RELIABILITY' && !p.api_reliability_alerts) return false;
  if (cat === 'DEPENDENCY' && !p.dependency_alerts) return false;

  return true;
}

/**
 * Retrieves or initializes user notification preferences
 */
export async function getUserPreferences(userId, dbPool = pool) {
  const { rows } = await dbPool.query(
    'SELECT * FROM user_notification_preferences WHERE user_id = $1',
    [userId]
  );
  if (rows.length > 0) {
    return rows[0];
  }
  return {
    user_id: userId,
    ...DEFAULT_NOTIFICATION_PREFERENCES
  };
}

/**
 * Dispatches in-app and external notifications for an alert
 */
export async function dispatchNotifications(alert, recipientUserId, dbPool = pool) {
  try {
    const prefs = await getUserPreferences(recipientUserId, dbPool);
    if (!shouldNotifyUser(alert, prefs)) {
      logger.debug({ alertId: alert.id, userId: recipientUserId }, 'Alert skipped per user preferences');
      return [];
    }

    const notifications = [];

    // 1. In-app notification
    if (prefs.in_app_enabled) {
      const { rows: inAppRows } = await dbPool.query(
        `INSERT INTO notifications (
           user_id, alert_id, repository_id, channel, title, message, severity, status, is_read, attempted_at, delivered_at
         ) VALUES ($1, $2, $3, 'in_app', $4, $5, $6, 'DELIVERED', false, NOW(), NOW())
         RETURNING *`,
        [
          recipientUserId,
          alert.id,
          alert.repository_id,
          alert.title,
          alert.description,
          normalizeSeverity(alert.severity)
        ]
      );
      notifications.push(inAppRows[0]);
    }

    // 2. Email notification (honest delivery: fail if no SMTP configured)
    if (prefs.email_enabled) {
      const { rows: emailRows } = await dbPool.query(
        `INSERT INTO notifications (
           user_id, alert_id, repository_id, channel, title, message, severity, status, is_read, attempted_at, delivered_at, failure_reason
         ) VALUES ($1, $2, $3, 'email', $4, $5, $6, 'FAILED', false, NOW(), NULL, 'No outbound SMTP gateway configured in environment')
         RETURNING *`,
        [
          recipientUserId,
          alert.id,
          alert.repository_id,
          alert.title,
          alert.description,
          normalizeSeverity(alert.severity)
        ]
      );
      notifications.push(emailRows[0]);
    }

    return notifications;
  } catch (err) {
    logger.warn({ alertId: alert?.id, err: err.message }, 'Non-fatal error creating notifications');
    return [];
  }
}

/**
 * Evaluates deterministic findings from a completed snapshot and produces idempotent alerts
 */
export async function evaluateSnapshotAlerts(snapshotId, repositoryId, dbPool = pool) {
  const { rows: repoRows } = await dbPool.query(
    'SELECT id, user_id, name FROM repositories WHERE id = $1',
    [repositoryId]
  );
  if (repoRows.length === 0) return [];
  const repo = repoRows[0];

  const candidateAlerts = [];

  // =========================================================================
  // 1. CP9: Security Vulnerabilities (CRITICAL and HIGH)
  // =========================================================================
  const { rows: vulns } = await dbPool.query(
    `SELECT canonical_id, package_name, installed_version, severity, cvss_score, cvss_vector, title, description, remediation, is_direct
     FROM snapshot_vulnerabilities
     WHERE snapshot_id = $1 AND severity IN ('CRITICAL', 'HIGH')`,
    [snapshotId]
  );

  for (const v of vulns) {
    const sev = normalizeSeverity(v.severity);
    const ruleId = sev === 'CRITICAL' ? 'SEC_CRITICAL_VULNERABILITY' : 'SEC_HIGH_VULNERABILITY';
    const dedupKey = `SEC:${v.canonical_id}:${v.package_name}`;

    candidateAlerts.push({
      ruleId,
      category: 'SECURITY',
      severity: sev,
      title: `[${sev}] Vulnerability in ${v.package_name}: ${v.canonical_id}`,
      description: `Package "${v.package_name}@${v.installed_version}" is affected by ${v.canonical_id}${v.title ? ` (${v.title})` : ''}.`,
      evidence: {
        canonicalId: v.canonical_id,
        packageName: v.package_name,
        installedVersion: v.installed_version,
        cvssScore: v.cvss_score,
        cvssVector: v.cvss_vector,
        remediation: v.remediation,
        isDirect: v.is_direct
      },
      sourceType: 'snapshot_vulnerability',
      sourceId: v.canonical_id,
      snapshotId,
      pullRequestId: null,
      deduplicationKey: dedupKey
    });
  }

  // Check overall security scan score
  const { rows: secScans } = await dbPool.query(
    `SELECT security_score, critical_count, high_count
     FROM security_scans
     WHERE snapshot_id = $1 AND status = 'completed'
     LIMIT 1`,
    [snapshotId]
  );

  if (secScans.length > 0 && secScans[0].security_score < 70) {
    const scan = secScans[0];
    candidateAlerts.push({
      ruleId: 'SEC_SCORE_LOW',
      category: 'SECURITY',
      severity: 'HIGH',
      title: `Security Health Score Below Threshold (${scan.security_score}/100)`,
      description: `Snapshot security posture dropped to ${scan.security_score}/100 with ${scan.critical_count} critical and ${scan.high_count} high vulnerabilities.`,
      evidence: {
        securityScore: scan.security_score,
        criticalCount: scan.critical_count,
        highCount: scan.high_count
      },
      sourceType: 'security_scan',
      sourceId: snapshotId,
      snapshotId,
      pullRequestId: null,
      deduplicationKey: `SEC_SCORE_LOW:${snapshotId}`
    });
  }

  // =========================================================================
  // 2. CP11: API Reliability Findings
  // =========================================================================
  const { rows: apiFindings } = await dbPool.query(
    `SELECT rule_id, severity, category, method, route_path, source_file, source_line, evidence, explanation, remediation
     FROM snapshot_api_findings
     WHERE snapshot_id = $1`,
    [snapshotId]
  );

  for (const f of apiFindings) {
    if (f.category === 'SECURITY' || f.rule_id === 'AUTH_MISSING' || f.rule_id === 'SECURITY_MISSING_AUTH') {
      candidateAlerts.push({
        ruleId: 'API_MISSING_AUTH',
        category: 'API_RELIABILITY',
        severity: 'HIGH',
        title: `API Missing Authentication: ${f.method} ${f.route_path}`,
        description: f.explanation || `Endpoint ${f.method} ${f.route_path} lacks mandatory authentication middleware.`,
        evidence: {
          method: f.method,
          routePath: f.route_path,
          sourceFile: f.source_file,
          sourceLine: f.source_line,
          evidence: f.evidence,
          remediation: f.remediation
        },
        sourceType: 'api_finding',
        sourceId: `${f.method}:${f.route_path}`,
        snapshotId,
        pullRequestId: null,
        deduplicationKey: `API_AUTH:${f.method}:${f.route_path}`
      });
    } else if (f.rule_id === 'ASYNC_NO_TRY_CATCH' || f.rule_id === 'ERROR_HANDLING_INCOMPLETE') {
      candidateAlerts.push({
        ruleId: 'API_UNHANDLED_ASYNC',
        category: 'API_RELIABILITY',
        severity: 'HIGH',
        title: `API Route Missing Async Error Handling: ${f.method} ${f.route_path}`,
        description: f.explanation || `Asynchronous route handler for ${f.method} ${f.route_path} does not catch promise rejections.`,
        evidence: {
          method: f.method,
          routePath: f.route_path,
          sourceFile: f.source_file,
          sourceLine: f.source_line,
          evidence: f.evidence
        },
        sourceType: 'api_finding',
        sourceId: `${f.method}:${f.route_path}`,
        snapshotId,
        pullRequestId: null,
        deduplicationKey: `API_ASYNC:${f.method}:${f.route_path}`
      });
    }
  }

  // API reliability summary check
  const { rows: apiSummaries } = await dbPool.query(
    `SELECT reliability_score, total_endpoints, total_findings, unauthenticated_count
     FROM snapshot_api_summaries
     WHERE snapshot_id = $1
     LIMIT 1`,
    [snapshotId]
  );

  if (apiSummaries.length > 0 && Number(apiSummaries[0].reliability_score) < 70) {
    const summary = apiSummaries[0];
    candidateAlerts.push({
      ruleId: 'API_SCORE_DROP',
      category: 'API_RELIABILITY',
      severity: 'HIGH',
      title: `API Reliability Score Below Threshold (${summary.reliability_score}/100)`,
      description: `API reliability score is ${summary.reliability_score}/100 across ${summary.total_endpoints} discovered endpoints (${summary.total_findings} findings, ${summary.unauthenticated_count} unauthenticated).`,
      evidence: {
        reliabilityScore: Number(summary.reliability_score),
        totalEndpoints: summary.total_endpoints,
        totalFindings: summary.total_findings
      },
      sourceType: 'api_summary',
      sourceId: snapshotId,
      snapshotId,
      pullRequestId: null,
      deduplicationKey: `API_SCORE_DROP:${snapshotId}`
    });
  }

  // =========================================================================
  // 3. CP10: Code Duplication Spikes (> 30% duplication ratio)
  // =========================================================================
  const { rows: dupSummaries } = await dbPool.query(
    `SELECT duplication_ratio, duplicated_lines, clone_count, clone_group_count
     FROM snapshot_duplication_summaries
     WHERE snapshot_id = $1
     LIMIT 1`,
    [snapshotId]
  );

  if (dupSummaries.length > 0 && Number(dupSummaries[0].duplication_ratio) > 0.30) {
    const dup = dupSummaries[0];
    candidateAlerts.push({
      ruleId: 'CODE_DUPLICATION_SPIKE',
      category: 'CODE_HEALTH',
      severity: 'HIGH',
      title: `Excessive Code Duplication Detected (${(Number(dup.duplication_ratio) * 100).toFixed(1)}%)`,
      description: `Duplication ratio of ${(Number(dup.duplication_ratio) * 100).toFixed(1)}% exceeds standard 30% tolerance (${dup.duplicated_lines} duplicated lines in ${dup.clone_group_count} clone groups).`,
      evidence: {
        duplicationRatio: Number(dup.duplication_ratio),
        duplicatedLines: dup.duplicated_lines,
        cloneCount: dup.clone_count,
        cloneGroupCount: dup.clone_group_count
      },
      sourceType: 'snapshot_duplication',
      sourceId: snapshotId,
      snapshotId,
      pullRequestId: null,
      deduplicationKey: `DUP_SPIKE:${snapshotId}`
    });
  }

  // =========================================================================
  // 4. CP7: Critical Code Smells & High Defect Propensity
  // =========================================================================
  const { rows: smells } = await dbPool.query(
    `SELECT cs.rule_id, cs.severity, cs.file_path, cs.symbol_name, cs.line, cs.measured_value, cs.threshold, cs.message
     FROM code_smells cs
     JOIN analysis_runs ar ON cs.analysis_run_id = ar.id
     WHERE ar.snapshot_id = $1 AND cs.severity = 'critical'`,
    [snapshotId]
  );

  for (const smell of smells) {
    candidateAlerts.push({
      ruleId: 'DEFECT_HIGH_PROPENSITY',
      category: 'CODE_HEALTH',
      severity: 'HIGH',
      title: `Critical Code Health Smell in ${smell.file_path}: ${smell.rule_id}`,
      description: smell.message || `Critical smell ${smell.rule_id} detected at line ${smell.line}.`,
      evidence: {
        filePath: smell.file_path,
        symbolName: smell.symbol_name,
        line: smell.line,
        measuredValue: smell.measured_value,
        threshold: smell.threshold
      },
      sourceType: 'code_smell',
      sourceId: `${smell.file_path}:${smell.rule_id}`,
      snapshotId,
      pullRequestId: null,
      deduplicationKey: `DEFECT:${smell.file_path}:${smell.rule_id}`
    });
  }

  // =========================================================================
  // 5. Persist candidate alerts idempotently & record audit activities
  // =========================================================================
  const createdOrUpdatedAlerts = [];

  for (const a of candidateAlerts) {
    const insertQuery = `
      INSERT INTO alerts (
        repository_id, rule_id, category, severity, status, title, description, evidence,
        source_type, source_id, snapshot_id, pull_request_id, deduplication_key, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, 'OPEN', $5, $6, $7, $8, $9, $10, $11, $12, NOW(), NOW())
      ON CONFLICT (repository_id, deduplication_key)
      DO UPDATE SET
        updated_at = NOW(),
        evidence = EXCLUDED.evidence,
        snapshot_id = EXCLUDED.snapshot_id
      WHERE alerts.status != 'RESOLVED'
      RETURNING *, (xmax = 0) AS is_new_record
    `;

    const { rows } = await dbPool.query(insertQuery, [
      repositoryId,
      a.ruleId,
      a.category,
      a.severity,
      a.title,
      a.description,
      JSON.stringify(a.evidence),
      a.sourceType,
      a.sourceId,
      a.snapshotId,
      a.pullRequestId,
      a.deduplicationKey
    ]);

    if (rows.length > 0) {
      const alertRow = rows[0];
      createdOrUpdatedAlerts.push(alertRow);

      if (alertRow.is_new_record) {
        // Record immutable audit activity for creation
        await dbPool.query(
          `INSERT INTO alert_activities (alert_id, user_id, action, note, metadata)
           VALUES ($1, NULL, 'CREATED', 'Alert automatically generated by analysis engine', $2)`,
          [alertRow.id, JSON.stringify({ ruleId: a.ruleId, snapshotId })]
        );

        // Dispatch notifications for new alert
        await dispatchNotifications(alertRow, repo.user_id, dbPool);
      }
    }
  }

  // =========================================================================
  // 6. Auto-Resolve previously open alerts if finding is no longer present
  // =========================================================================
  // Auto-resolve fixed vulnerabilities
  const currentVulnKeys = new Set(vulns.map(v => `SEC:${v.canonical_id}:${v.package_name}`));
  const { rows: openSecAlerts } = await dbPool.query(
    `SELECT id, deduplication_key, title
     FROM alerts
     WHERE repository_id = $1 AND category = 'SECURITY' AND status IN ('OPEN', 'ACKNOWLEDGED')
       AND deduplication_key LIKE 'SEC:%'`,
    [repositoryId]
  );

  for (const prevAlert of openSecAlerts) {
    if (!currentVulnKeys.has(prevAlert.deduplication_key)) {
      await dbPool.query(
        `UPDATE alerts
         SET status = 'RESOLVED', resolved_at = NOW(), updated_at = NOW()
         WHERE id = $1`,
        [prevAlert.id]
      );
      await dbPool.query(
        `INSERT INTO alert_activities (alert_id, user_id, action, note, metadata)
         VALUES ($1, NULL, 'RESOLVED', 'Vulnerability no longer detected in latest snapshot', $2)`,
        [prevAlert.id, JSON.stringify({ resolvedInSnapshotId: snapshotId })]
      );
      logger.info({ alertId: prevAlert.id, title: prevAlert.title }, 'Auto-resolved security alert');
    }
  }

  // Auto-resolve fixed API auth findings
  const currentApiAuthKeys = new Set(
    candidateAlerts
      .filter(a => a.ruleId === 'API_MISSING_AUTH')
      .map(a => a.deduplicationKey)
  );
  const { rows: openApiAuthAlerts } = await dbPool.query(
    `SELECT id, deduplication_key, title
     FROM alerts
     WHERE repository_id = $1 AND category = 'API_RELIABILITY' AND rule_id = 'API_MISSING_AUTH' AND status IN ('OPEN', 'ACKNOWLEDGED')`,
    [repositoryId]
  );

  for (const prevAlert of openApiAuthAlerts) {
    if (!currentApiAuthKeys.has(prevAlert.deduplication_key)) {
      await dbPool.query(
        `UPDATE alerts
         SET status = 'RESOLVED', resolved_at = NOW(), updated_at = NOW()
         WHERE id = $1`,
        [prevAlert.id]
      );
      await dbPool.query(
        `INSERT INTO alert_activities (alert_id, user_id, action, note, metadata)
         VALUES ($1, NULL, 'RESOLVED', 'API endpoint now authenticated in latest snapshot', $2)`,
        [prevAlert.id, JSON.stringify({ resolvedInSnapshotId: snapshotId })]
      );
      logger.info({ alertId: prevAlert.id, title: prevAlert.title }, 'Auto-resolved API auth alert');
    }
  }

  return createdOrUpdatedAlerts;
}

/**
 * Evaluates deterministic findings from a PR risk analysis and produces idempotent alerts
 */
export async function evaluatePullRequestAlerts(pullRequestId, analysisId, dbPool = pool) {
  const { rows: prRows } = await dbPool.query(
    `SELECT pr.id, pr.repository_id, pr.pr_number, pr.title, pr.status,
            pra.risk_score, pra.risk_category, pra.quality_gate, pra.summary, pra.churn_metrics, pra.blast_radius,
            r.user_id AS repo_owner_id
     FROM pull_request_analyses pra
     JOIN pull_requests pr ON pra.pull_request_id = pr.id
     JOIN repositories r ON pr.repository_id = r.id
     WHERE pra.id = $1 AND pra.status = 'completed'`,
    [analysisId]
  );

  if (prRows.length === 0) return [];
  const prData = prRows[0];

  const candidateAlerts = [];

  const isBlocked = prData.quality_gate === 'BLOCKED';
  const riskCat = String(prData.risk_category || '').toUpperCase();
  const riskScore = Math.round(Number(prData.risk_score) || 0);

  if (isBlocked) {
    candidateAlerts.push({
      ruleId: 'PR_BLOCKED',
      category: 'PR_RISK',
      severity: 'CRITICAL',
      title: `PR #${prData.pr_number} Quality Gate Blocked (${riskCat} Risk)`,
      description: `Pull request #${prData.pr_number} ("${prData.title}") failed quality gate with risk score ${riskScore}/100. ${prData.summary || ''}`,
      evidence: {
        prNumber: prData.pr_number,
        riskScore,
        riskCategory: riskCat,
        qualityGate: prData.quality_gate,
        churnMetrics: prData.churn_metrics,
        blastRadius: prData.blast_radius
      },
      sourceType: 'pull_request',
      sourceId: String(prData.pr_number),
      snapshotId: null,
      pullRequestId: prData.id,
      deduplicationKey: `PR_BLOCKED:${prData.pr_number}`
    });
  } else if (riskCat === 'CRITICAL') {
    candidateAlerts.push({
      ruleId: 'PR_CRITICAL_RISK',
      category: 'PR_RISK',
      severity: 'CRITICAL',
      title: `PR #${prData.pr_number} Critical Risk Score (${riskScore}/100)`,
      description: `Pull request #${prData.pr_number} evaluated as CRITICAL risk (${riskScore}/100).`,
      evidence: {
        prNumber: prData.pr_number,
        riskScore,
        riskCategory: riskCat,
        qualityGate: prData.quality_gate
      },
      sourceType: 'pull_request',
      sourceId: String(prData.pr_number),
      snapshotId: null,
      pullRequestId: prData.id,
      deduplicationKey: `PR_CRITICAL:${prData.pr_number}`
    });
  } else if (riskCat === 'HIGH') {
    candidateAlerts.push({
      ruleId: 'PR_HIGH_RISK',
      category: 'PR_RISK',
      severity: 'HIGH',
      title: `PR #${prData.pr_number} High Risk Score (${riskScore}/100)`,
      description: `Pull request #${prData.pr_number} evaluated as HIGH risk (${riskScore}/100).`,
      evidence: {
        prNumber: prData.pr_number,
        riskScore,
        riskCategory: riskCat,
        qualityGate: prData.quality_gate
      },
      sourceType: 'pull_request',
      sourceId: String(prData.pr_number),
      snapshotId: null,
      pullRequestId: prData.id,
      deduplicationKey: `PR_HIGH:${prData.pr_number}`
    });
  }

  const createdOrUpdatedAlerts = [];

  for (const a of candidateAlerts) {
    const insertQuery = `
      INSERT INTO alerts (
        repository_id, rule_id, category, severity, status, title, description, evidence,
        source_type, source_id, snapshot_id, pull_request_id, deduplication_key, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, 'OPEN', $5, $6, $7, $8, $9, $10, $11, $12, NOW(), NOW())
      ON CONFLICT (repository_id, deduplication_key)
      DO UPDATE SET
        updated_at = NOW(),
        evidence = EXCLUDED.evidence,
        pull_request_id = EXCLUDED.pull_request_id
      WHERE alerts.status != 'RESOLVED'
      RETURNING *, (xmax = 0) AS is_new_record
    `;

    const { rows } = await dbPool.query(insertQuery, [
      prData.repository_id,
      a.ruleId,
      a.category,
      a.severity,
      a.title,
      a.description,
      JSON.stringify(a.evidence),
      a.sourceType,
      a.sourceId,
      a.snapshotId,
      a.pullRequestId,
      a.deduplicationKey
    ]);

    if (rows.length > 0) {
      const alertRow = rows[0];
      createdOrUpdatedAlerts.push(alertRow);

      if (alertRow.is_new_record) {
        await dbPool.query(
          `INSERT INTO alert_activities (alert_id, user_id, action, note, metadata)
           VALUES ($1, NULL, 'CREATED', 'Alert automatically generated for high-risk pull request', $2)`,
          [alertRow.id, JSON.stringify({ pullRequestId: prData.id, prNumber: prData.pr_number, riskScore })]
        );

        await dispatchNotifications(alertRow, prData.repo_owner_id, dbPool);
      }
    }
  }

  // Auto-resolve PR risk alerts if risk has reduced to LOW/MEDIUM and gate is not blocked
  if (!isBlocked && (riskCat === 'LOW' || riskCat === 'MEDIUM')) {
    const { rows: openPrAlerts } = await dbPool.query(
      `SELECT id, title FROM alerts
       WHERE repository_id = $1 AND pull_request_id = $2 AND status IN ('OPEN', 'ACKNOWLEDGED')`,
      [prData.repository_id, prData.id]
    );

    for (const prevAlert of openPrAlerts) {
      await dbPool.query(
        `UPDATE alerts SET status = 'RESOLVED', resolved_at = NOW(), updated_at = NOW() WHERE id = $1`,
        [prevAlert.id]
      );
      await dbPool.query(
        `INSERT INTO alert_activities (alert_id, user_id, action, note, metadata)
         VALUES ($1, NULL, 'RESOLVED', 'PR risk dropped to acceptable levels on latest revision', $2)`,
        [prevAlert.id, JSON.stringify({ riskScore, qualityGate: prData.quality_gate })]
      );
      logger.info({ alertId: prevAlert.id, title: prevAlert.title }, 'Auto-resolved PR risk alert');
    }
  }

  return createdOrUpdatedAlerts;
}

/**
 * Acknowledges an alert
 */
export async function acknowledgeAlert(alertId, userId, note = '', dbPool = pool) {
  const { rows } = await dbPool.query(
    `UPDATE alerts
     SET status = 'ACKNOWLEDGED', acknowledged_at = NOW(), updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [alertId]
  );
  if (rows.length === 0) return null;

  await dbPool.query(
    `INSERT INTO alert_activities (alert_id, user_id, action, note, metadata)
     VALUES ($1, $2, 'ACKNOWLEDGED', $3, '{}'::jsonb)`,
    [alertId, userId, note || 'Alert acknowledged by user']
  );

  return rows[0];
}

/**
 * Resolves an alert
 */
export async function resolveAlert(alertId, userId, note = '', dbPool = pool) {
  const { rows } = await dbPool.query(
    `UPDATE alerts
     SET status = 'RESOLVED', resolved_at = NOW(), updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [alertId]
  );
  if (rows.length === 0) return null;

  await dbPool.query(
    `INSERT INTO alert_activities (alert_id, user_id, action, note, metadata)
     VALUES ($1, $2, 'RESOLVED', $3, '{}'::jsonb)`,
    [alertId, userId, note || 'Alert resolved by user']
  );

  return rows[0];
}

/**
 * Dismisses an alert
 */
export async function dismissAlert(alertId, userId, note = '', dbPool = pool) {
  const { rows } = await dbPool.query(
    `UPDATE alerts
     SET status = 'DISMISSED', dismissed_at = NOW(), updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [alertId]
  );
  if (rows.length === 0) return null;

  await dbPool.query(
    `INSERT INTO alert_activities (alert_id, user_id, action, note, metadata)
     VALUES ($1, $2, 'DISMISSED', $3, '{}'::jsonb)`,
    [alertId, userId, note || 'Alert dismissed by user']
  );

  return rows[0];
}

/**
 * Reopens an alert
 */
export async function reopenAlert(alertId, userId, note = '', dbPool = pool) {
  const { rows } = await dbPool.query(
    `UPDATE alerts
     SET status = 'OPEN', resolved_at = NULL, dismissed_at = NULL, updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [alertId]
  );
  if (rows.length === 0) return null;

  await dbPool.query(
    `INSERT INTO alert_activities (alert_id, user_id, action, note, metadata)
     VALUES ($1, $2, 'REOPENED', $3, '{}'::jsonb)`,
    [alertId, userId, note || 'Alert reopened by user']
  );

  return rows[0];
}

/**
 * Assigns or reassigns an alert to a user
 */
export async function assignAlert(alertId, actorUserId, assignedUserId, note = '', dbPool = pool) {
  let assignee = null;
  if (assignedUserId) {
    const { rows: userRows } = await dbPool.query(
      'SELECT id, login, name, email FROM users WHERE id = $1',
      [assignedUserId]
    );
    if (userRows.length === 0) {
      const err = new Error('Assigned user not found.');
      err.status = 400;
      throw err;
    }
    assignee = userRows[0];
  }

  const { rows } = await dbPool.query(
    `UPDATE alerts
     SET assigned_user_id = $2, updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [alertId, assignedUserId || null]
  );
  if (rows.length === 0) return null;

  const action = assignedUserId ? 'ASSIGNED' : 'UNASSIGNED';
  const actionNote = note || (assignedUserId ? `Assigned to @${assignee.login}` : 'Alert unassigned');

  await dbPool.query(
    `INSERT INTO alert_activities (alert_id, user_id, action, note, metadata)
     VALUES ($1, $2, $3, $4, $5)`,
    [alertId, actorUserId, action, actionNote, JSON.stringify({ assignedUserId })]
  );

  // If assigned to a user other than the actor, notify the assignee
  if (assignedUserId && assignedUserId !== actorUserId) {
    const alert = rows[0];
    await dispatchNotifications({
      ...alert,
      title: `Assignment: ${alert.title}`,
      description: `You were assigned this alert by an engineering collaborator.`
    }, assignedUserId, dbPool);
  }

  return rows[0];
}

/**
 * Adds a comment to an alert
 */
export async function addAlertComment(alertId, userId, content, dbPool = pool) {
  if (!content || !content.trim()) {
    const err = new Error('Comment content cannot be empty.');
    err.status = 400;
    throw err;
  }

  const { rows } = await dbPool.query(
    `INSERT INTO alert_comments (alert_id, user_id, content, created_at)
     VALUES ($1, $2, $3, NOW())
     RETURNING *`,
    [alertId, userId, content.trim()]
  );

  await dbPool.query(
    `INSERT INTO alert_activities (alert_id, user_id, action, note, metadata)
     VALUES ($1, $2, 'COMMENTED', $3, '{}'::jsonb)`,
    [alertId, userId, `Added a comment: "${content.trim().slice(0, 50)}..."`]
  );

  return rows[0];
}

/**
 * Fetches the immutable activity trail for an alert
 */
export async function getAlertActivityTrail(alertId, dbPool = pool) {
  const query = `
    SELECT act.*, u.login, u.name, u.avatar_url
    FROM alert_activities act
    LEFT JOIN users u ON act.user_id = u.id
    WHERE act.alert_id = $1
    ORDER BY act.created_at ASC
  `;
  const { rows } = await dbPool.query(query, [alertId]);
  return rows;
}
