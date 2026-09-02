import assert from 'node:assert/strict';
import { env } from '../src/config/env.js';
import { pool, closePool } from '../src/db/pool.js';
import {
  encryptToken,
  generateSessionToken,
  hashSessionToken
} from '../src/utils/crypto.js';
import { shouldIncludeFile } from '../src/services/ingestion/fileFilter.js';
import { defaultStorageProvider } from '../src/services/ingestion/storage/LocalStorageProvider.js';
import { githubService } from '../src/services/github.js';
import { githubTree } from '../src/services/ingestion/githubTree.js';
import { fileFetcher } from '../src/services/ingestion/fileFetcher.js';
import { app } from '../src/app.js';

let server;
let baseUrl;

async function startServer() {
  return new Promise((resolve) => {
    server = app.listen(0, () => {
      const port = server.address().port;
      baseUrl = `http://localhost:${port}`;
      resolve();
    });
  });
}

async function stopServer() {
  return new Promise((resolve) => {
    server.close(resolve);
  });
}

async function runTests() {
  console.log('--- Starting Checkpoint 5 Ingestion & Normalized Snapshot Test Suite ---');
  await startServer();

  try {
    // ------------------------------------------------------------------------
    // Test 1: File Filter Unit Validation
    // ------------------------------------------------------------------------
    console.log('[Test 1] Testing file filter inclusion, exclusion, and size boundaries...');

    // Accepted files
    const jsDecision = shouldIncludeFile('src/components/Button.jsx', 1500, 1000000);
    assert.equal(jsDecision.include, true);
    assert.equal(jsDecision.language, 'javascript');
    assert.equal(jsDecision.type, 'source');

    const pyDecision = shouldIncludeFile('backend/api/main.py', 2500, 1000000);
    assert.equal(pyDecision.include, true);
    assert.equal(pyDecision.language, 'python');

    const goDecision = shouldIncludeFile('pkg/service/handler.go', 3000, 1000000);
    assert.equal(goDecision.include, true);
    assert.equal(goDecision.language, 'go');

    const rsDecision = shouldIncludeFile('src/lib.rs', 4000, 1000000);
    assert.equal(rsDecision.include, true);
    assert.equal(rsDecision.language, 'rust');

    const pkgDecision = shouldIncludeFile('package.json', 800, 1000000);
    assert.equal(pkgDecision.include, true);
    assert.equal(pkgDecision.type, 'config');

    const docDecision = shouldIncludeFile('README.md', 1200, 1000000);
    assert.equal(docDecision.include, true);
    assert.equal(docDecision.type, 'documentation');

    // Excluded directory files
    const nodeModulesDecision = shouldIncludeFile('node_modules/react/index.js', 500, 1000000);
    assert.equal(nodeModulesDecision.include, false);
    assert.equal(nodeModulesDecision.reason, 'excluded_directory');

    const gitDecision = shouldIncludeFile('.git/objects/pack/pack-123.pack', 5000, 1000000);
    assert.equal(gitDecision.include, false);
    assert.equal(gitDecision.reason, 'excluded_directory');

    const distDecision = shouldIncludeFile('dist/assets/index.js', 5000, 1000000);
    assert.equal(distDecision.include, false);
    assert.equal(distDecision.reason, 'excluded_directory');

    // Excluded binary/media extensions
    const pngDecision = shouldIncludeFile('assets/logo.png', 12000, 1000000);
    assert.equal(pngDecision.include, false);
    assert.equal(pngDecision.reason, 'excluded_binary_or_media');

    const exeDecision = shouldIncludeFile('tools/tool.exe', 50000, 1000000);
    assert.equal(exeDecision.include, false);
    assert.equal(exeDecision.reason, 'excluded_binary_or_media');

    const zipDecision = shouldIncludeFile('archive.tar.gz', 80000, 1000000);
    assert.equal(zipDecision.include, false);
    assert.equal(zipDecision.reason, 'excluded_binary_or_media');

    // Excluded oversized files
    const oversizedDecision = shouldIncludeFile('data/large_dataset.json', 2000000, 1000000);
    assert.equal(oversizedDecision.include, false);
    assert.equal(oversizedDecision.reason, 'file_too_large');

    console.log('✓ Test 1 Passed: File filtering rules deterministically accepted source/config/docs and rejected binaries/directories/oversized files.');

    // ------------------------------------------------------------------------
    // Setup Test Users & Connected Repositories in PostgreSQL
    // ------------------------------------------------------------------------
    const key = env.githubTokenEncryptionKey;
    const testEncryptedToken = encryptToken('gho_test_user_token_abc123', key);

    // User A
    const userAGithubId = Date.now() + 101;
    const { rows: userARows } = await pool.query(`
      INSERT INTO users (github_id, login, name, avatar_url, email, github_access_token_encrypted)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id, login
    `, [userAGithubId, `user_a_${Date.now()}`, 'User Alpha', 'https://example.com/a.png', 'usera@example.com', testEncryptedToken]);
    const userA = userARows[0];

    const tokenA = generateSessionToken();
    const hashA = hashSessionToken(tokenA);
    await pool.query('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, NOW() + INTERVAL \'7 days\')', [hashA, userA.id]);

    // User B
    const userBGithubId = Date.now() + 202;
    const { rows: userBRows } = await pool.query(`
      INSERT INTO users (github_id, login, name, avatar_url, email, github_access_token_encrypted)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id, login
    `, [userBGithubId, `user_b_${Date.now()}`, 'User Beta', 'https://example.com/b.png', 'userb@example.com', testEncryptedToken]);
    const userB = userBRows[0];

    const tokenB = generateSessionToken();
    const hashB = hashSessionToken(tokenB);
    await pool.query('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, NOW() + INTERVAL \'7 days\')', [hashB, userB.id]);

    // Connect repository for User A
    const { rows: repoRowsA } = await pool.query(`
      INSERT INTO repositories (user_id, provider, owner, name, full_name, default_branch, status)
      VALUES ($1, 'github', 'HitachiSystems', 'payment-service', 'HitachiSystems/payment-service', 'main', 'connected')
      RETURNING id, name, owner, full_name
    `, [userA.id]);
    const repoA = repoRowsA[0];

    // Connect repository for User B
    const { rows: repoRowsB } = await pool.query(`
      INSERT INTO repositories (user_id, provider, owner, name, full_name, default_branch, status)
      VALUES ($1, 'github', 'HitachiSystems', 'customer-api', 'HitachiSystems/customer-api', 'main', 'connected')
      RETURNING id, name, owner, full_name
    `, [userB.id]);
    const repoB = repoRowsB[0];

    // ------------------------------------------------------------------------
    // Test 2: Unauthenticated Ingestion Returns HTTP 401
    // ------------------------------------------------------------------------
    console.log('[Test 2] Testing unauthenticated POST /api/repositories/:id/ingest...');
    const resUnauth = await fetch(`${baseUrl}/api/repositories/${repoA.id}/ingest`, {
      method: 'POST'
    });
    assert.equal(resUnauth.status, 401, 'Unauthenticated request must return HTTP 401');
    console.log('✓ Test 2 Passed: Unauthenticated request rejected with HTTP 401.');

    // ------------------------------------------------------------------------
    // Test 3: Cross-User Ingestion Isolation
    // ------------------------------------------------------------------------
    console.log('[Test 3] Testing cross-user ingestion authorization barrier...');
    const resCross = await fetch(`${baseUrl}/api/repositories/${repoB.id}/ingest`, {
      method: 'POST',
      headers: {
        'Cookie': `session_id=${tokenA}`,
        'Content-Type': 'application/json'
      }
    });
    assert.equal(resCross.status, 404, 'User A cannot ingest User B repository (must return 404)');
    console.log('✓ Test 3 Passed: User cannot trigger ingestion for repositories owned by other users.');

    // ------------------------------------------------------------------------
    // Mock GitHub Commit & Tree APIs for deterministic ingestion test
    // ------------------------------------------------------------------------
    let currentMockCommitSha = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f60001';

    const mockGitTree = [
      { path: 'src/index.js', type: 'blob', sha: 'blob111111111111111111111111111111111111', size: 120 },
      { path: 'src/config.json', type: 'blob', sha: 'blob222222222222222222222222222222222222', size: 85 },
      { path: 'package.json', type: 'blob', sha: 'blob333333333333333333333333333333333333', size: 300 },
      { path: 'README.md', type: 'blob', sha: 'blob444444444444444444444444444444444444', size: 500 },
      { path: 'node_modules/lodash/index.js', type: 'blob', sha: 'blob555555555555555555555555555555555555', size: 1000 },
      { path: 'assets/banner.png', type: 'blob', sha: 'blob666666666666666666666666666666666666', size: 50000 },
      { path: 'huge-data.txt', type: 'blob', sha: 'blob777777777777777777777777777777777777', size: 5000000 }
    ];

    const mockBlobContents = {
      'blob111111111111111111111111111111111111': 'console.log("Hello from payment-service");\r\nexport const pay = () => true;\r\n',
      'blob222222222222222222222222222222222222': '{\r\n  "service": "payment",\r\n  "version": "1.0.0"\r\n}\r\n',
      'blob333333333333333333333333333333333333': '{\n  "name": "payment-service",\n  "version": "1.0.0"\n}\n',
      'blob444444444444444444444444444444444444': '# Payment Service\n\nCore payment processor.\n'
    };

    // Override GitHub tree & blob resolvers for tests
    const origResolveBranchCommit = githubTree.resolveBranchCommit;
    const origGetRepositoryTree = githubTree.getRepositoryTree;
    const origFetchBlobContent = fileFetcher.fetchBlobContent;

    githubTree.resolveBranchCommit = async () => currentMockCommitSha;
    githubTree.getRepositoryTree = async () => ({
      commitSha: currentMockCommitSha,
      tree: mockGitTree,
      isTruncated: false
    });

    fileFetcher.fetchBlobContent = async (token, owner, name, blobSha) => {
      const rawText = mockBlobContents[blobSha] || 'export default {};';
      const normalized = rawText.replace(/\r\n/g, '\n');
      return {
        content: normalized,
        lineCount: normalized.split('\n').length,
        size: Buffer.byteLength(normalized, 'utf8')
      };
    };

    // ------------------------------------------------------------------------
    // Test 4: Run Real Repository Ingestion
    // ------------------------------------------------------------------------
    console.log('[Test 4] Testing full repository ingestion and snapshot generation...');
    const resIngest = await fetch(`${baseUrl}/api/repositories/${repoA.id}/ingest`, {
      method: 'POST',
      headers: {
        'Cookie': `session_id=${tokenA}`,
        'Content-Type': 'application/json'
      }
    });
    assert.equal(resIngest.status, 201, 'Fresh ingestion must return HTTP 201 Created');
    const bodyIngest = await resIngest.json();
    assert.ok(bodyIngest.snapshot, 'Response must contain snapshot object');
    const snapshot1 = bodyIngest.snapshot;

    assert.equal(snapshot1.repositoryId, repoA.id);
    assert.equal(snapshot1.commitSha, currentMockCommitSha);
    assert.equal(snapshot1.status, 'completed');
    assert.equal(snapshot1.includedFiles, 4, 'Should include 4 valid text/source files (index.js, config.json, package.json, README.md)');
    assert.equal(snapshot1.skippedFiles, 3, 'Should skip 3 files (node_modules, png, oversized)');
    assert.equal(snapshot1.reused, false);
    assert.ok(snapshot1.storageKey, 'Snapshot must have storageKey');

    // Verify row in PostgreSQL `repository_snapshots`
    const { rows: dbSnapshotRows } = await pool.query(
      'SELECT * FROM repository_snapshots WHERE id = $1',
      [snapshot1.id]
    );
    assert.equal(dbSnapshotRows.length, 1);
    assert.equal(dbSnapshotRows[0].status, 'completed');
    assert.equal(dbSnapshotRows[0].commit_sha, currentMockCommitSha);

    // Verify snapshot payload from LocalStorageProvider
    const storedSnapshot = await defaultStorageProvider.getSnapshot(snapshot1.id);
    assert.equal(storedSnapshot.snapshotId, snapshot1.id);
    assert.equal(storedSnapshot.files.length, 4);
    assert.equal(storedSnapshot.files[0].path, 'package.json'); // Sorted alphabetically
    assert.equal(storedSnapshot.files[0].type, 'config');
    assert.equal(storedSnapshot.files[1].path, 'README.md');
    assert.equal(storedSnapshot.files[1].type, 'documentation');
    assert.equal(storedSnapshot.files[2].path, 'src/config.json');
    assert.equal(storedSnapshot.files[3].path, 'src/index.js');
    assert.equal(storedSnapshot.files[3].language, 'javascript');
    // Verify line ending normalization (CRLF -> LF)
    assert.ok(!storedSnapshot.files[3].content.includes('\r\n'), 'CRLF must be normalized to LF');
    assert.ok(storedSnapshot.files[3].content.includes('\n'), 'Must contain LF');

    console.log('✓ Test 4 Passed: Repository ingestion produced deterministic normalized snapshot payload and database record.');

    // ------------------------------------------------------------------------
    // Test 5: Ingestion Idempotency (Same Commit SHA)
    // ------------------------------------------------------------------------
    console.log('[Test 5] Testing ingestion idempotency for identical commit SHA...');
    const resIngestDup = await fetch(`${baseUrl}/api/repositories/${repoA.id}/ingest`, {
      method: 'POST',
      headers: {
        'Cookie': `session_id=${tokenA}`,
        'Content-Type': 'application/json'
      }
    });
    assert.equal(resIngestDup.status, 200, 'Reused ingestion must return HTTP 200 OK');
    const bodyIngestDup = await resIngestDup.json();
    assert.equal(bodyIngestDup.snapshot.id, snapshot1.id, 'Must reuse existing snapshot ID');
    assert.equal(bodyIngestDup.snapshot.reused, true, 'Snapshot must be marked as reused');

    // Ensure database did not create a duplicate row
    const { rows: countSnapshots } = await pool.query(
      'SELECT count(*) AS count FROM repository_snapshots WHERE repository_id = $1 AND commit_sha = $2',
      [repoA.id, currentMockCommitSha]
    );
    assert.equal(parseInt(countSnapshots[0].count, 10), 1, 'Database must contain exactly 1 snapshot for the commit');
    console.log('✓ Test 5 Passed: Ingesting same commit SHA reuses existing snapshot without duplicate downloads.');

    // ------------------------------------------------------------------------
    // Test 6: Ingestion for New Commit SHA
    // ------------------------------------------------------------------------
    console.log('[Test 6] Testing ingestion for a new commit SHA...');
    currentMockCommitSha = 'b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f60002'; // New commit

    const resIngestNew = await fetch(`${baseUrl}/api/repositories/${repoA.id}/ingest`, {
      method: 'POST',
      headers: {
        'Cookie': `session_id=${tokenA}`,
        'Content-Type': 'application/json'
      }
    });
    assert.equal(resIngestNew.status, 201, 'New commit ingestion must return HTTP 201 Created');
    const bodyIngestNew = await resIngestNew.json();
    const snapshot2 = bodyIngestNew.snapshot;
    assert.notEqual(snapshot2.id, snapshot1.id, 'New commit must produce a distinct snapshot ID');
    assert.equal(snapshot2.commitSha, currentMockCommitSha);
    assert.equal(snapshot2.reused, false);

    // Database now has 2 distinct snapshots for repoA
    const { rows: totalSnapshots } = await pool.query(
      'SELECT count(*) AS count FROM repository_snapshots WHERE repository_id = $1',
      [repoA.id]
    );
    assert.equal(parseInt(totalSnapshots[0].count, 10), 2, 'Repository must have 2 snapshots across different commits');
    console.log('✓ Test 6 Passed: Ingesting new commit SHA created a fresh snapshot record.');

    // ------------------------------------------------------------------------
    // Test 7: List Snapshots & Get Single Snapshot Endpoints
    // ------------------------------------------------------------------------
    console.log('[Test 7] Testing GET /api/repositories/:id/snapshots endpoints...');
    const resListSnapshots = await fetch(`${baseUrl}/api/repositories/${repoA.id}/snapshots`, {
      headers: { 'Cookie': `session_id=${tokenA}` }
    });
    assert.equal(resListSnapshots.status, 200);
    const bodyListSnapshots = await resListSnapshots.json();
    assert.equal(bodyListSnapshots.snapshots.length, 2);

    const resGetSingleSnapshot = await fetch(`${baseUrl}/api/repositories/${repoA.id}/snapshots/${snapshot1.id}?includePayload=true`, {
      headers: { 'Cookie': `session_id=${tokenA}` }
    });
    assert.equal(resGetSingleSnapshot.status, 200);
    const bodySingle = await resGetSingleSnapshot.json();
    assert.equal(bodySingle.snapshot.id, snapshot1.id);
    assert.ok(bodySingle.snapshot.payload, 'Payload must be returned when requested');
    console.log('✓ Test 7 Passed: Snapshot listing and single snapshot retrieval endpoints verified.');

    // ------------------------------------------------------------------------
    // Test 8: Truncated Tree Detection
    // ------------------------------------------------------------------------
    console.log('[Test 8] Testing truncated tree response handling...');
    currentMockCommitSha = 'c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f60003';
    githubTree.getRepositoryTree = async () => ({
      commitSha: currentMockCommitSha,
      tree: [
        { path: 'src/index.js', type: 'blob', sha: 'blob111111111111111111111111111111111111', size: 120 }
      ],
      isTruncated: true
    });

    const resTruncated = await fetch(`${baseUrl}/api/repositories/${repoA.id}/ingest`, {
      method: 'POST',
      headers: {
        'Cookie': `session_id=${tokenA}`,
        'Content-Type': 'application/json'
      }
    });
    assert.equal(resTruncated.status, 201);
    const bodyTruncated = await resTruncated.json();
    const storedTruncated = await defaultStorageProvider.getSnapshot(bodyTruncated.snapshot.id);
    assert.equal(storedTruncated.metadata.isTruncated, true, 'Snapshot metadata must record truncation');
    console.log('✓ Test 8 Passed: Truncated tree explicitly recorded in snapshot provenance metadata.');

    // Clean up test data
    await defaultStorageProvider.deleteSnapshot(snapshot1.id);
    await defaultStorageProvider.deleteSnapshot(snapshot2.id);
    await defaultStorageProvider.deleteSnapshot(bodyTruncated.snapshot.id);
    await pool.query('DELETE FROM users WHERE id IN ($1, $2)', [userA.id, userB.id]);

    // Restore original functions
    githubTree.resolveBranchCommit = origResolveBranchCommit;
    githubTree.getRepositoryTree = origGetRepositoryTree;
    fileFetcher.fetchBlobContent = origFetchBlobContent;

    console.log('\n======================================================');
    console.log('ALL CHECKPOINT 5 INGESTION TESTS PASSED! (8/8)');
    console.log('======================================================\n');
  } finally {
    await stopServer();
    await closePool();
  }
}

runTests().catch((err) => {
  console.error('Ingestion Test Suite Failed:', err);
  process.exit(1);
});
