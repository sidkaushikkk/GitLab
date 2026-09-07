import { pool } from '../../db/pool.js';
import { logger } from '../../utils/logger.js';
import { defaultStorageProvider } from '../ingestion/storage/LocalStorageProvider.js';
import { dispatchAndParseFile } from './dispatcher.js';
import { extractRelationships } from './relationshipExtractor.js';
import { detectCodeSmells } from './codeSmells.js';
import { extractFeatures, FEATURE_SCHEMA_VERSION } from './featureExtractor.js';
import { parseManifestFile } from './manifestParser.js';

/**
 * Service orchestrating AST code intelligence analysis and ML-ready feature extraction
 */
export const codeIntelligenceService = {
  /**
   * Runs AST analysis on a CP5 repository snapshot
   * @param {Object} params
   * @param {string} params.repositoryId - Repository UUID
   * @param {string} params.snapshotId - Snapshot UUID
   * @param {string} params.userId - Authenticated user UUID
   * @param {boolean} [params.forceReanalyze=false] - Whether to re-run analysis
   * @param {Object} [params.storageProvider] - Storage provider instance
   * @returns {Promise<Object>} Analysis run summary
   */
  async analyzeSnapshot({
    repositoryId,
    snapshotId,
    userId,
    forceReanalyze = false,
    storageProvider = defaultStorageProvider
  }) {
    // 1. Verify repository ownership
    const { rows: repoRows } = await pool.query(
      'SELECT * FROM repositories WHERE id = $1 AND user_id = $2',
      [repositoryId, userId]
    );

    if (repoRows.length === 0) {
      const err = new Error('Repository not found or you do not have permission to access it.');
      err.status = 404;
      throw err;
    }

    const repo = repoRows[0];

    // 2. Verify snapshot belongs to this repository
    const { rows: snapshotRows } = await pool.query(
      'SELECT * FROM repository_snapshots WHERE id = $1 AND repository_id = $2',
      [snapshotId, repositoryId]
    );

    if (snapshotRows.length === 0) {
      const err = new Error('Snapshot not found for this repository.');
      err.status = 404;
      throw err;
    }

    const snapshot = snapshotRows[0];
    if (snapshot.status !== 'completed') {
      const err = new Error(`Cannot analyze snapshot in status '${snapshot.status}'. Snapshot must be 'completed'.`);
      err.status = 400;
      throw err;
    }

    // 3. Idempotency Check: Return existing completed analysis run if available
    if (!forceReanalyze) {
      const { rows: existingRuns } = await pool.query(
        'SELECT * FROM analysis_runs WHERE repository_id = $1 AND snapshot_id = $2 AND status = \'completed\' ORDER BY completed_at DESC LIMIT 1',
        [repositoryId, snapshotId]
      );

      if (existingRuns.length > 0) {
        logger.info(
          { repositoryId, snapshotId, analysisRunId: existingRuns[0].id },
          'Reusing existing completed analysis run (idempotent)'
        );
        return this.getAnalysisRunSummary(existingRuns[0].id, userId, { reused: true });
      }
    }

    // 4. Create analysis run in database
    const { rows: newRunRows } = await pool.query(
      `INSERT INTO analysis_runs (
        repository_id, snapshot_id, commit_sha, status, started_at
      ) VALUES ($1, $2, $3, 'running', NOW())
      RETURNING *`,
      [repositoryId, snapshotId, snapshot.commit_sha]
    );

    const runId = newRunRows[0].id;
    logger.info({ runId, repositoryId, snapshotId }, 'Started AST code intelligence analysis');

    try {
      // 5. Load snapshot payload from storage provider
      const snapshotPayload = await storageProvider.getSnapshot(snapshotId);
      const files = Array.isArray(snapshotPayload.files) ? snapshotPayload.files : [];

      // 6. Dispatch and parse files
      const parsedFiles = [];
      let totalFailed = 0;

      for (const file of files) {
        const parsed = dispatchAndParseFile(file);
        parsedFiles.push(parsed);
        if (parsed.status === 'parse_failed') {
          totalFailed++;
        }
      }

      // 7. Persist analysis_files and symbols in PostgreSQL
      const allSymbols = [];

      for (const file of parsedFiles) {
        const { rows: fileRows } = await pool.query(
          `INSERT INTO analysis_files (
            analysis_run_id, file_path, language, status, line_count, error_message
          ) VALUES ($1, $2, $3, $4, $5, $6)
          RETURNING id`,
          [
            runId,
            file.filePath,
            file.language,
            file.status,
            file.lineCount,
            file.error || null
          ]
        );

        const fileDbId = fileRows[0].id;

        for (const sym of file.symbols) {
          const { rows: symRows } = await pool.query(
            `INSERT INTO symbols (
              analysis_run_id, file_id, symbol_type, name, file_path, start_line, end_line
            ) VALUES ($1, $2, $3, $4, $5, $6, $7)
            RETURNING id`,
            [
              runId,
              fileDbId,
              sym.symbolType,
              sym.name,
              sym.filePath,
              sym.startLine || 1,
              sym.endLine || 1
            ]
          );

          allSymbols.push({
            ...sym,
            id: symRows[0].id,
            fileDbId
          });
        }
      }

      // 8. Extract relationships & calculate graph metrics (fan-in, fan-out, circular deps)
      const { relationships, graphMetrics } = extractRelationships(parsedFiles, allSymbols);

      for (const rel of relationships) {
        await pool.query(
          `INSERT INTO relationships (
            analysis_run_id, source_symbol_id, source_file_path, target_symbol_id, target_file_path, relationship_type, symbols_imported
          ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            runId,
            rel.sourceSymbolId,
            rel.sourceFilePath,
            rel.targetSymbolId,
            rel.targetFilePath,
            rel.relationshipType,
            rel.symbolsImported
          ]
        );
      }

      // 9. Detect deterministic code smells
      const codeSmells = detectCodeSmells(parsedFiles, graphMetrics);

      for (const smell of codeSmells) {
        await pool.query(
          `INSERT INTO code_smells (
            analysis_run_id, rule_id, severity, file_path, symbol_name, line, measured_value, threshold, message
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            runId,
            smell.ruleId,
            smell.severity,
            smell.filePath,
            smell.symbolName,
            smell.line,
            smell.measuredValue,
            smell.threshold,
            smell.message
          ]
        );
      }

      // 10. Compute and persist entity metrics
      for (const file of parsedFiles) {
        for (const [mName, mVal] of Object.entries(file.fileMetrics)) {
          await pool.query(
            `INSERT INTO metrics (
              analysis_run_id, entity_type, entity_id, metric_name, metric_value
            ) VALUES ($1, 'file', $2, $3, $4)`,
            [runId, file.filePath, mName, mVal]
          );
        }

        for (const fn of file.functionMetrics) {
          const fnEntityId = `${file.filePath}::${fn.symbolName}#${fn.startLine}`;
          for (const [mName, mVal] of Object.entries(fn)) {
            if (mName === 'symbolName') continue;
            await pool.query(
              `INSERT INTO metrics (
                analysis_run_id, entity_type, entity_id, metric_name, metric_value
              ) VALUES ($1, 'function', $2, $3, $4)`,
              [runId, fnEntityId, mName, Number(mVal)]
            );
          }
        }
      }

      // 11. Extract and persist ML-ready numerical features
      const features = extractFeatures(parsedFiles, allSymbols, graphMetrics, codeSmells);

      for (const feat of features) {
        await pool.query(
          `INSERT INTO features (
            analysis_run_id, entity_type, entity_id, feature_schema_version, feature_name, feature_value
          ) VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            runId,
            feat.entityType,
            feat.entityId,
            feat.featureSchemaVersion || FEATURE_SCHEMA_VERSION,
            feat.featureName,
            feat.featureValue
          ]
        );
      }

      // 12. Complete analysis run in database
      const totalSymbolsCount = allSymbols.length;
      const totalRelsCount = relationships.length;
      const totalSmellsCount = codeSmells.length;

      await pool.query(
        `UPDATE analysis_runs
        SET status = 'completed',
            total_files_analyzed = $1,
            total_files_failed = $2,
            total_symbols = $3,
            total_relationships = $4,
            total_smells = $5,
            completed_at = NOW()
        WHERE id = $6`,
        [
          parsedFiles.length,
          totalFailed,
          totalSymbolsCount,
          totalRelsCount,
          totalSmellsCount,
          runId
        ]
      );

      logger.info(
        {
          runId,
          filesAnalyzed: parsedFiles.length,
          symbols: totalSymbolsCount,
          relationships: totalRelsCount,
          smells: totalSmellsCount
        },
        'Analysis run completed successfully'
      );

      return this.getAnalysisRunSummary(runId, userId, { reused: false });
    } catch (analysisErr) {
      logger.error({ runId, err: analysisErr.message }, 'Analysis run failed');
      await pool.query(
        'UPDATE analysis_runs SET status = \'failed\', error_message = $1, completed_at = NOW() WHERE id = $2',
        [analysisErr.message, runId]
      );
      throw analysisErr;
    }
  },

  /**
   * Retrieves summary details of an analysis run
   */
  async getAnalysisRunSummary(runId, userId, extra = {}) {
    const query = `
      SELECT a.*, r.user_id, s.branch
      FROM analysis_runs a
      JOIN repositories r ON a.repository_id = r.id
      JOIN repository_snapshots s ON a.snapshot_id = s.id
      WHERE a.id = $1 AND r.user_id = $2
    `;

    const { rows } = await pool.query(query, [runId, userId]);
    if (rows.length === 0) {
      const err = new Error('Analysis run not found or access denied.');
      err.status = 404;
      throw err;
    }

    const row = rows[0];

    // Query high-level summary counts and top smells
    const { rows: smellRows } = await pool.query(
      'SELECT rule_id, severity, file_path, symbol_name, line, message FROM code_smells WHERE analysis_run_id = $1 ORDER BY line ASC LIMIT 50',
      [runId]
    );

    return {
      id: row.id,
      repositoryId: row.repository_id,
      snapshotId: row.snapshot_id,
      commitSha: row.commit_sha,
      branch: row.branch,
      status: row.status,
      totalFilesAnalyzed: row.total_files_analyzed,
      totalFilesFailed: row.total_files_failed,
      totalSymbols: row.total_symbols,
      totalRelationships: row.total_relationships,
      totalSmells: row.total_smells,
      startedAt: row.started_at,
      completedAt: row.completed_at,
      createdAt: row.created_at,
      codeSmells: smellRows,
      summary: {
        filesAnalyzed: row.total_files_analyzed,
        filesFailed: row.total_files_failed,
        symbols: row.total_symbols,
        relationships: row.total_relationships,
        smells: row.total_smells
      },
      ...extra
    };
  },

  /**
   * Retrieves ML-ready feature dataset for a snapshot analysis
   */
  async getAnalysisFeatures(snapshotId, userId) {
    const query = `
      SELECT f.entity_type, f.entity_id, f.feature_schema_version, f.feature_name, f.feature_value
      FROM features f
      JOIN analysis_runs a ON f.analysis_run_id = a.id
      JOIN repositories r ON a.repository_id = r.id
      WHERE a.snapshot_id = $1 AND r.user_id = $2 AND a.status = 'completed'
      ORDER BY f.entity_type, f.entity_id, f.feature_name
    `;

    const { rows } = await pool.query(query, [snapshotId, userId]);
    if (rows.length === 0) {
      const err = new Error('Completed analysis features not found for this snapshot.');
      err.status = 404;
      throw err;
    }

    // Group features by entity
    const grouped = {};
    for (const r of rows) {
      const key = `${r.entity_type}::${r.entity_id}`;
      if (!grouped[key]) {
        grouped[key] = {
          entityType: r.entity_type,
          entityId: r.entity_id,
          featureSchemaVersion: r.feature_schema_version,
          features: {}
        };
      }
      grouped[key].features[r.feature_name] = r.feature_value;
    }

    return {
      snapshotId,
      featureSchemaVersion: FEATURE_SCHEMA_VERSION,
      totalEntities: Object.keys(grouped).length,
      dataset: Object.values(grouped)
    };
  },

  /**
   * Retrieves dependency and call graph nodes and edges
   */
  async getAnalysisGraph(snapshotId, userId) {
    // 1. Verify snapshot and user access
    const { rows: runRows } = await pool.query(`
      SELECT a.id as run_id, a.repository_id
      FROM analysis_runs a
      JOIN repositories r ON a.repository_id = r.id
      WHERE a.snapshot_id = $1 AND r.user_id = $2 AND a.status = 'completed'
      ORDER BY a.created_at DESC LIMIT 1
    `, [snapshotId, userId]);

    if (runRows.length === 0) {
      const err = new Error('Completed analysis not found for this snapshot.');
      err.status = 404;
      throw err;
    }

    const runId = runRows[0].run_id;

    const query = `
      SELECT r.source_file_path, r.target_file_path, r.relationship_type, r.symbols_imported,
             s1.name as source_symbol_name, s2.name as target_symbol_name
      FROM relationships r
      LEFT JOIN symbols s1 ON r.source_symbol_id = s1.id
      LEFT JOIN symbols s2 ON r.target_symbol_id = s2.id
      WHERE r.analysis_run_id = $1
    `;

    const { rows } = await pool.query(query, [runId]);

    // Build unique nodes and edges
    const nodeSet = new Set();
    const edges = [];

    for (const r of rows) {
      if (r.source_file_path) nodeSet.add(r.source_file_path);
      if (r.target_file_path) nodeSet.add(r.target_file_path);

      edges.push({
        source: r.source_file_path,
        target: r.target_file_path,
        type: r.relationship_type,
        sourceSymbol: r.source_symbol_name,
        targetSymbol: r.target_symbol_name,
        symbols: r.symbols_imported
      });
    }

    return {
      snapshotId,
      nodes: Array.from(nodeSet).map(id => ({ id, label: id })),
      edges,
      relationships: edges
    };
  },

  /**
   * Retrieves paginated, filterable metrics for functions and files
   */
  async getAnalysisMetrics(snapshotId, userId, { entityType, sortBy = 'complexity', sortDir = 'desc', limit = 100, offset = 0, filePath } = {}) {
    // 1. Verify snapshot and user access
    const { rows: runRows } = await pool.query(`
      SELECT a.id as run_id, a.repository_id
      FROM analysis_runs a
      JOIN repositories r ON a.repository_id = r.id
      WHERE a.snapshot_id = $1 AND r.user_id = $2 AND a.status = 'completed'
      ORDER BY a.created_at DESC LIMIT 1
    `, [snapshotId, userId]);

    if (runRows.length === 0) {
      const err = new Error('Completed analysis not found for this snapshot.');
      err.status = 404;
      throw err;
    }

    const runId = runRows[0].run_id;

    // 2. Fetch metrics
    let query = `
      SELECT entity_type, entity_id, metric_name, metric_value
      FROM metrics
      WHERE analysis_run_id = $1
    `;
    const params = [runId];

    if (entityType) {
      params.push(entityType);
      query += ` AND entity_type = $${params.length}`;
    }

    if (filePath) {
      params.push(`%${filePath}%`);
      query += ` AND entity_id LIKE $${params.length}`;
    }

    query += ` ORDER BY entity_type, entity_id`;

    const { rows } = await pool.query(query, params);

    // Group metrics by entity
    const entityMap = new Map();
    for (const r of rows) {
      if (!entityMap.has(r.entity_id)) {
        entityMap.set(r.entity_id, {
          entityType: r.entity_type,
          entityId: r.entity_id,
          metrics: {}
        });
      }
      entityMap.get(r.entity_id).metrics[r.metric_name] = r.metric_value;
    }

    // Convert to flat list with enriched properties
    let items = Array.from(entityMap.values()).map(item => {
      const m = item.metrics;
      const complexity = m.cyclomaticComplexity || m.avg_complexity || 1;
      const nesting = m.maxNestingDepth || m.max_nesting_depth || 0;
      const lines = m.lines || m.physicalLines || 1;
      const branchCount = m.branchCount || 0;
      const callCount = m.callCount || 0;
      const fanIn = m.fan_in || 0;
      const fanOut = m.fan_out || 0;
      const smellsCount = m.code_smell_count || 0;
      const hasTest = m.has_test || 0;

      // Deterministic Technical Debt Score:
      // Complexity * 2 + Nesting * 3 + Smells * 5 - (hasTest * 5)
      const debtScore = Math.max(0, Math.round((complexity * 2) + (nesting * 3) + (smellsCount * 5) - (hasTest * 5)));

      return {
        entityType: item.entityType,
        entityId: item.entityId,
        lines,
        complexity,
        maxNestingDepth: nesting,
        branchCount,
        callCount,
        fanIn,
        fanOut,
        codeSmellCount: smellsCount,
        hasTest,
        debtScore,
        rawMetrics: m
      };
    });

    // Sort items
    const dir = String(sortDir).toLowerCase() === 'asc' ? 1 : -1;
    items.sort((a, b) => {
      let valA = a[sortBy] ?? a.rawMetrics?.[sortBy] ?? 0;
      let valB = b[sortBy] ?? b.rawMetrics?.[sortBy] ?? 0;
      return (valA - valB) * dir;
    });

    // Compute aggregate stats across items
    let totalFiles = 0;
    let totalFunctions = 0;
    let totalLines = 0;
    let sumComplexity = 0;
    let maxComplexity = 0;
    let totalDebtScore = 0;

    for (const item of items) {
      if (item.entityType === 'file') {
        totalFiles++;
        totalLines += Number(item.lines || 0);
      } else if (item.entityType === 'function') {
        totalFunctions++;
      }
      const c = Number(item.complexity || 0);
      sumComplexity += c;
      if (c > maxComplexity) {
        maxComplexity = c;
      }
      totalDebtScore += Number(item.debtScore || 0);
    }

    if (entityType === 'file' && totalFiles === 0 && items.length > 0) {
      totalFiles = items.length;
    } else if (entityType === 'function' && totalFunctions === 0 && items.length > 0) {
      totalFunctions = items.length;
    }

    const stats = {
      totalFiles: totalFiles || runRows[0].total_files_analyzed || items.length,
      totalFunctions: totalFunctions || runRows[0].total_symbols || 0,
      totalLines,
      avgComplexity: items.length > 0 ? Number((sumComplexity / items.length).toFixed(1)) : 0,
      maxComplexity,
      technicalDebtScore: totalDebtScore
    };

    const total = items.length;
    const paginated = items.slice(offset, offset + limit);

    return {
      snapshotId,
      total,
      limit,
      offset,
      stats,
      metrics: paginated
    };
  },

  /**
   * Retrieves paginated, filterable code smells for a snapshot
   */
  async getAnalysisCodeSmells(snapshotId, userId, { ruleId, severity, filePath, limit = 50, offset = 0 } = {}) {
    const { rows: runRows } = await pool.query(`
      SELECT a.id as run_id
      FROM analysis_runs a
      JOIN repositories r ON a.repository_id = r.id
      WHERE a.snapshot_id = $1 AND r.user_id = $2 AND a.status = 'completed'
      ORDER BY a.created_at DESC LIMIT 1
    `, [snapshotId, userId]);

    if (runRows.length === 0) {
      const err = new Error('Completed analysis not found for this snapshot.');
      err.status = 404;
      throw err;
    }

    const runId = runRows[0].run_id;

    let query = `
      SELECT id, rule_id, severity, file_path, symbol_name, line, measured_value, threshold, message, created_at
      FROM code_smells
      WHERE analysis_run_id = $1
    `;
    const params = [runId];

    if (ruleId) {
      params.push(ruleId);
      query += ` AND rule_id = $${params.length}`;
    }

    if (severity) {
      params.push(severity);
      query += ` AND severity = $${params.length}`;
    }

    if (filePath) {
      params.push(`%${filePath}%`);
      query += ` AND file_path LIKE $${params.length}`;
    }

    // Get total count
    const countQuery = `SELECT count(*) FROM (${query}) as filtered`;
    const { rows: countRows } = await pool.query(countQuery, params);
    const total = parseInt(countRows[0].count, 10);

    query += ` ORDER BY line ASC, created_at ASC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limit, offset);

    const { rows } = await pool.query(query, params);

    return {
      snapshotId,
      total,
      limit,
      offset,
      smells: rows.map(r => ({
        id: r.id,
        ruleId: r.rule_id,
        severity: r.severity,
        filePath: r.file_path,
        symbolName: r.symbol_name,
        line: r.line,
        measuredValue: r.measured_value,
        threshold: r.threshold,
        message: r.message,
        createdAt: r.created_at
      }))
    };
  },

  /**
   * Retrieves parsed manifests and external package dependencies for a snapshot
   */
  async getAnalysisDependencies(snapshotId, userId, { storageProvider = defaultStorageProvider } = {}) {
    const { rows: runRows } = await pool.query(`
      SELECT a.id as run_id, a.repository_id
      FROM analysis_runs a
      JOIN repositories r ON a.repository_id = r.id
      WHERE a.snapshot_id = $1 AND r.user_id = $2 AND a.status = 'completed'
      ORDER BY a.created_at DESC LIMIT 1
    `, [snapshotId, userId]);

    if (runRows.length === 0) {
      const err = new Error('Completed analysis not found for this snapshot.');
      err.status = 404;
      throw err;
    }

    const snapshotPayload = await storageProvider.getSnapshot(snapshotId);
    const files = Array.isArray(snapshotPayload.files) ? snapshotPayload.files : [];

    const manifests = [];
    const allDependencies = [];

    for (const file of files) {
      const parsed = parseManifestFile(file);
      if (parsed) {
        manifests.push({
          manifestPath: parsed.manifestPath,
          ecosystem: parsed.ecosystem,
          packageName: parsed.packageName || null,
          version: parsed.version || null,
          license: parsed.license || null,
          dependenciesCount: parsed.dependenciesCount
        });

        if (Array.isArray(parsed.dependencies)) {
          allDependencies.push(...parsed.dependencies);
        }
      }
    }

    // Also get module-level import relationships from database
    const { rows: importRels } = await pool.query(`
      SELECT source_file_path, target_file_path, symbols_imported
      FROM relationships
      WHERE analysis_run_id = $1 AND relationship_type = 'IMPORTS'
    `, [runRows[0].run_id]);

    return {
      snapshotId,
      manifestsCount: manifests.length,
      totalDependencies: allDependencies.length,
      manifests,
      dependencies: allDependencies,
      internalImportsCount: importRels.length,
      internalImports: importRels.map(r => ({
        sourceFilePath: r.source_file_path,
        targetFilePath: r.target_file_path,
        symbolsImported: r.symbols_imported
      }))
    };
  }
};
