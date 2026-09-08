import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { pool, closePool } from '../src/db/pool.js';
import { parseUnifiedDiff } from '../src/services/intelligence/diffParser.js';
import { mapDiffToAstImpact } from '../src/services/intelligence/astImpact.js';
import { calculateBlastRadius } from '../src/services/intelligence/blastRadius.js';
import { extractRelationships } from '../src/services/intelligence/relationshipExtractor.js';
import { dispatchAndParseFile } from '../src/services/intelligence/dispatcher.js';

test('pullRequestIntegration: end-to-end pipeline (base -> diff -> AST impact -> blast radius -> DB persistence)', async (t) => {
  // 1. Fixture Files (Base Snapshot)
  const baseAuthCode = `
export function login(user, pass) {
  return user === 'admin' && pass === 'secret';
}

export function logout(user) {
  return true;
}
`;

  const baseUserCode = `
import { login } from './auth.js';

export function authenticateUser(credentials) {
  return login(credentials.user, credentials.pass);
}
`;

  const baseAppCode = `
import { authenticateUser } from './userService.js';

export function startApp() {
  return authenticateUser({ user: 'admin', pass: 'secret' });
}
`;

  const baseFiles = [
    { filePath: 'src/auth.js', content: baseAuthCode, language: 'javascript' },
    { filePath: 'src/userService.js', content: baseUserCode, language: 'javascript' },
    { filePath: 'src/app.js', content: baseAppCode, language: 'javascript' }
  ];

  // Parse base files to extract symbols and repository relationships
  const parsedFiles = baseFiles.map(f => dispatchAndParseFile({ path: f.filePath, content: f.content, language: f.language }));
  const allSymbols = parsedFiles.flatMap(pf => pf.symbols);
  const { relationships } = extractRelationships(parsedFiles, allSymbols);

  assert.ok(relationships.length >= 2, 'Should extract at least 2 import relationships');
  assert.ok(relationships.some(r => r.sourceFilePath === 'src/userService.js' && r.targetFilePath === 'src/auth.js'));
  assert.ok(relationships.some(r => r.sourceFilePath === 'src/app.js' && r.targetFilePath === 'src/userService.js'));

  // 2. PR Modification (Head Snapshot)
  // Modify login function in src/auth.js
  const headAuthCode = `
export function login(user, pass) {
  if (!user || !pass) {
    throw new Error('Invalid credentials');
  }
  return user === 'admin' && pass === 'secret';
}

export function logout(user) {
  return true;
}
`;

  const headFiles = [
    { filePath: 'src/auth.js', content: headAuthCode, language: 'javascript' },
    { filePath: 'src/userService.js', content: baseUserCode, language: 'javascript' },
    { filePath: 'src/app.js', content: baseAppCode, language: 'javascript' }
  ];

  const diffText = `diff --git a/src/auth.js b/src/auth.js
index 1000000..2000000 100644
--- a/src/auth.js
+++ b/src/auth.js
@@ -2,2 +2,5 @@
 export function login(user, pass) {
+  if (!user || !pass) {
+    throw new Error('Invalid credentials');
+  }
   return user === 'admin' && pass === 'secret';
`;

  // 3. Parse Diff
  const parsedDiff = parseUnifiedDiff(diffText);
  assert.equal(parsedDiff.files.length, 1);
  assert.equal(parsedDiff.files[0].filePath, 'src/auth.js');
  assert.equal(parsedDiff.files[0].changeType, 'modified');
  assert.equal(parsedDiff.totalAdditions, 3);
  assert.equal(parsedDiff.totalDeletions, 0);

  // 4. Map AST Impact
  const astImpact = mapDiffToAstImpact({
    parsedDiff,
    baseFiles,
    headFiles
  });

  assert.equal(astImpact.files.length, 1);
  const authImpact = astImpact.files[0];

  const modifiedLogin = authImpact.entities.find(e => e.name === 'login');
  assert.ok(modifiedLogin, 'login entity must be present');
  assert.equal(modifiedLogin.entityType, 'FUNCTION');
  assert.equal(modifiedLogin.changeClassification, 'MODIFIED');
  assert.ok(modifiedLogin.overlappingLineRanges.length > 0);

  const unchangedLogout = authImpact.entities.find(e => e.name === 'logout');
  assert.ok(unchangedLogout, 'logout entity must be present');
  assert.equal(unchangedLogout.entityType, 'FUNCTION');
  assert.equal(unchangedLogout.changeClassification, 'UNCHANGED');

  // 5. Blast Radius Calculation
  const touchedFilePaths = astImpact.files.map(f => f.filePath);
  const touchedSymbols = astImpact.touchedEntities.filter(e => e.entityType !== 'FILE');

  const blastRadius = calculateBlastRadius({
    changedFiles: touchedFilePaths,
    changedSymbols: touchedSymbols,
    relationships,
    maxDepth: 3
  });

  assert.equal(blastRadius.totalAffectedNodes, 2);
  assert.equal(blastRadius.maxDepthReached, 2);
  assert.deepEqual(blastRadius.affectedFiles, ['src/app.js', 'src/userService.js']);

  // Directly affected at depth 1: src/userService.js
  assert.equal(blastRadius.directlyAffected.length, 1);
  assert.equal(blastRadius.directlyAffected[0].filePath, 'src/userService.js');
  assert.equal(blastRadius.directlyAffected[0].depth, 1);
  assert.equal(blastRadius.directlyAffected[0].dependedOn, 'src/auth.js');

  // Transitively affected at depth 2: src/app.js
  assert.equal(blastRadius.transitivelyAffected.length, 1);
  assert.equal(blastRadius.transitivelyAffected[0].filePath, 'src/app.js');
  assert.equal(blastRadius.transitivelyAffected[0].depth, 2);
  assert.equal(blastRadius.transitivelyAffected[0].dependedOn, 'src/userService.js');

  // 6. Database Persistence & Foreign Key Cascade Verification
  const client = await pool.connect();
  try {
    // Check if test repo exists or create one
    let repoRes = await client.query('SELECT id FROM repositories LIMIT 1');
    let repoId;
    let createdRepo = false;

    if (repoRes.rows.length === 0) {
      const userRes = await client.query(`
        INSERT INTO users (username, email, password_hash)
        VALUES ('pr_tester', 'pr_tester@test.com', 'hash123')
        RETURNING id
      `);
      const insRepo = await client.query(`
        INSERT INTO repositories (name, description, owner_id)
        VALUES ('pr_test_repo', 'Test repository for PR intelligence', $1)
        RETURNING id
      `, [userRes.rows[0].id]);
      repoId = insRepo.rows[0].id;
      createdRepo = true;
    } else {
      repoId = repoRes.rows[0].id;
    }

    const testPrNumber = 999999;
    // Clean up any stale test PR with this number
    await client.query('DELETE FROM pull_requests WHERE repository_id = $1 AND pr_number = $2', [repoId, testPrNumber]);

    // Insert Pull Request
    const prRes = await client.query(`
      INSERT INTO pull_requests (
        repository_id, pr_number, title, description, author,
        source_branch, target_branch, source_commit_sha, target_commit_sha, status
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10
      ) RETURNING id
    `, [
      repoId,
      testPrNumber,
      'Feature: Harden auth credentials check',
      'Validates username and password inputs in login',
      'developer',
      'feature/harden-auth',
      'main',
      '2000000000000000000000000000000000000000',
      '1000000000000000000000000000000000000000',
      'open'
    ]);
    const pullRequestId = prRes.rows[0].id;

    // Test unique constraint on (repository_id, pr_number)
    await assert.rejects(
      async () => {
        await client.query(`
          INSERT INTO pull_requests (
            repository_id, pr_number, title, source_branch, target_branch,
            source_commit_sha, target_commit_sha
          ) VALUES ($1, $2, 'Duplicate PR', 'b1', 'main', '2000000', '1000000')
        `, [repoId, testPrNumber]);
      },
      /uq_pull_requests_repo_number/
    );

    // Insert Analysis Run
    const analysisRes = await client.query(`
      INSERT INTO pull_request_analyses (
        pull_request_id, commit_sha, status, analysis_version,
        churn_metrics, blast_radius, findings, summary
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING id
    `, [
      pullRequestId,
      '2000000000000000000000000000000000000000',
      'completed',
      '1.0',
      JSON.stringify({ additions: parsedDiff.totalAdditions, deletions: parsedDiff.totalDeletions }),
      JSON.stringify(blastRadius),
      JSON.stringify(astImpact.touchedEntities),
      'Authentication hardening PR affects userService and app'
    ]);
    const analysisId = analysisRes.rows[0].id;

    // Insert Diffs
    for (const file of parsedDiff.files) {
      await client.query(`
        INSERT INTO pull_request_diffs (
          pull_request_id, analysis_id, file_path, old_path,
          change_type, additions, deletions, changed_line_ranges, patch, touched_symbols
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      `, [
        pullRequestId,
        analysisId,
        file.filePath,
        file.oldPath,
        file.changeType,
        file.additions,
        file.deletions,
        JSON.stringify(file.changedLineRanges),
        diffText,
        JSON.stringify(authImpact.entities)
      ]);
    }

    // Query back diffs and assert persistence
    const savedDiffs = await client.query(`
      SELECT file_path, change_type, additions, deletions, changed_line_ranges, touched_symbols
      FROM pull_request_diffs
      WHERE analysis_id = $1
    `, [analysisId]);

    assert.equal(savedDiffs.rows.length, 1);
    assert.equal(savedDiffs.rows[0].file_path, 'src/auth.js');
    assert.equal(savedDiffs.rows[0].change_type, 'modified');
    assert.equal(savedDiffs.rows[0].additions, 3);
    assert.equal(savedDiffs.rows[0].deletions, 0);

    // Test Cascade Deletion: Deleting the pull request should cascade-delete analyses and diffs
    await client.query('DELETE FROM pull_requests WHERE id = $1', [pullRequestId]);

    const remainingAnalyses = await client.query('SELECT count(*) FROM pull_request_analyses WHERE id = $1', [analysisId]);
    assert.equal(parseInt(remainingAnalyses.rows[0].count, 10), 0, 'Analyses should be cascade deleted');

    const remainingDiffs = await client.query('SELECT count(*) FROM pull_request_diffs WHERE analysis_id = $1', [analysisId]);
    assert.equal(parseInt(remainingDiffs.rows[0].count, 10), 0, 'Diffs should be cascade deleted');

  } finally {
    client.release();
  }
});

after(async () => {
  await closePool();
});
