import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parsePackageLock,
  parsePackageKey,
  extractDirectDeclarations,
  normalizePackageName,
  extractDependenciesFromSnapshotFiles,
  persistSnapshotDependencies,
  getPersistedSnapshotDependencies
} from '../src/services/intelligence/lockfileParser.js';
import { pool, closePool } from '../src/db/pool.js';

// ============================================================================
// Fixture 1: npm lockfileVersion 3 (Modern packages representation)
// ============================================================================
const sampleLockfileV3 = JSON.stringify({
  name: 'my-service',
  version: '1.0.0',
  lockfileVersion: 3,
  requires: true,
  packages: {
    '': {
      name: 'my-service',
      version: '1.0.0',
      dependencies: {
        'express': '^4.19.2',
        'pg': '^8.11.3'
      },
      devDependencies: {
        'vitest': '^1.6.0'
      },
      optionalDependencies: {
        'fsevents': '^2.3.3'
      }
    },
    'node_modules/express': {
      version: '4.19.2',
      resolved: 'https://registry.npmjs.org/express/-/express-4.19.2.tgz',
      dependencies: {
        'accepts': '~1.3.8',
        'body-parser': '1.20.2'
      }
    },
    'node_modules/pg': {
      version: '8.11.3',
      resolved: 'https://registry.npmjs.org/pg/-/pg-8.11.3.tgz',
      dependencies: {
        'pg-pool': '^3.6.1'
      }
    },
    'node_modules/vitest': {
      version: '1.6.0',
      dev: true,
      resolved: 'https://registry.npmjs.org/vitest/-/vitest-1.6.0.tgz'
    },
    'node_modules/fsevents': {
      version: '2.3.3',
      optional: true,
      dev: true,
      resolved: 'https://registry.npmjs.org/fsevents/-/fsevents-2.3.3.tgz'
    },
    'node_modules/accepts': {
      version: '1.3.8',
      resolved: 'https://registry.npmjs.org/accepts/-/accepts-1.3.8.tgz',
      dependencies: {
        'mime-types': '~2.1.34'
      }
    },
    'node_modules/body-parser': {
      version: '1.20.2',
      resolved: 'https://registry.npmjs.org/body-parser/-/body-parser-1.20.2.tgz'
    },
    'node_modules/mime-types': {
      version: '2.1.35',
      resolved: 'https://registry.npmjs.org/mime-types/-/mime-types-2.1.35.tgz'
    },
    'node_modules/pg-pool': {
      version: '3.6.1',
      resolved: 'https://registry.npmjs.org/pg-pool/-/pg-pool-3.6.1.tgz'
    },
    'node_modules/express/node_modules/cookie': {
      version: '0.6.0',
      resolved: 'https://registry.npmjs.org/cookie/-/cookie-0.6.0.tgz'
    }
  }
}, null, 2);

// ============================================================================
// Fixture 2: npm lockfileVersion 2 with packages and fallback dependencies
// ============================================================================
const sampleLockfileV2 = JSON.stringify({
  name: 'legacy-service',
  version: '2.0.0',
  lockfileVersion: 2,
  requires: true,
  packages: {
    '': {
      name: 'legacy-service',
      version: '2.0.0',
      dependencies: {
        'axios': '^1.6.0'
      },
      devDependencies: {
        'eslint': '^8.0.0'
      }
    },
    'node_modules/axios': {
      version: '1.6.0',
      dependencies: {
        'follow-redirects': '^1.15.0'
      }
    },
    'node_modules/eslint': {
      version: '8.0.0',
      dev: true
    },
    'node_modules/follow-redirects': {
      version: '1.15.4'
    }
  },
  dependencies: {
    'axios': {
      'version': '1.6.0',
      'requires': {
        'follow-redirects': '^1.15.0'
      }
    },
    'eslint': {
      'version': '8.0.0',
      'dev': true
    },
    'follow-redirects': {
      'version': '1.15.4'
    }
  }
}, null, 2);

// ============================================================================
// Fixture 3: npm legacy format (lockfileVersion 1 / 2 without packages object)
// ============================================================================
const sampleLockfileLegacyDepsOnly = JSON.stringify({
  name: 'ancient-service',
  version: '1.0.0',
  lockfileVersion: 1,
  dependencies: {
    'lodash': {
      version: '4.17.21'
    },
    'jest': {
      version: '27.5.1',
      dev: true,
      requires: {
        'jest-core': '^27.5.1'
      },
      dependencies: {
        'chalk': {
          version: '4.1.2',
          dev: true
        }
      }
    }
  }
}, null, 2);

test('Unit: parsePackageKey correctly extracts package names, parent, and depth', () => {
  assert.deepEqual(parsePackageKey(''), { name: '', parentName: null, depth: 0, isRoot: true });
  assert.deepEqual(parsePackageKey('node_modules/express'), { name: 'express', parentName: null, depth: 1, isRoot: false });
  assert.deepEqual(parsePackageKey('node_modules/@babel/core'), { name: '@babel/core', parentName: null, depth: 1, isRoot: false });
  assert.deepEqual(parsePackageKey('node_modules/express/node_modules/cookie'), { name: 'cookie', parentName: 'express', depth: 2, isRoot: false });
  assert.deepEqual(parsePackageKey('node_modules/@scope/parent/node_modules/@scope/child'), { name: '@scope/child', parentName: '@scope/parent', depth: 2, isRoot: false });
  assert.deepEqual(parsePackageKey('node_modules/a/node_modules/b/node_modules/c'), { name: 'c', parentName: 'b', depth: 3, isRoot: false });
});

test('Unit: normalizePackageName standardizes ecosystem names', () => {
  assert.equal(normalizePackageName('npm', 'Express'), 'express');
  assert.equal(normalizePackageName('npm', '@Babel/Core'), '@babel/core');
  assert.equal(normalizePackageName('pypi', 'Flask_Cors.Ext'), 'flask-cors-ext');
  assert.equal(normalizePackageName('pypi', 'osv_detector'), 'osv-detector');
});

test('Unit: extractDirectDeclarations extracts from raw package.json and objects', () => {
  const pkgStr = JSON.stringify({
    dependencies: { 'react': '^19.0.0' },
    devDependencies: { 'vite': '^6.0.0' },
    peerDependencies: { 'react-dom': '^19.0.0' },
    optionalDependencies: { 'fsevents': '^2.0.0' }
  });

  const { prod, dev, peer, optional } = extractDirectDeclarations(pkgStr);
  assert.equal(prod.get('react'), '^19.0.0');
  assert.equal(dev.get('vite'), '^6.0.0');
  assert.equal(peer.get('react-dom'), '^19.0.0');
  assert.equal(optional.get('fsevents'), '^2.0.0');
});

test('Lockfile: npm lockfileVersion 3 - direct, transitive, depth, and parent relationships', () => {
  const result = parsePackageLock('package-lock.json', sampleLockfileV3);

  assert.equal(result.success, true);
  assert.equal(result.lockfileVersion, 3);
  assert.equal(result.totalDependencies, 9);
  assert.equal(result.directCount, 4); // express, pg, vitest, fsevents
  assert.equal(result.transitiveCount, 5); // accepts, body-parser, mime-types, pg-pool, cookie

  // 1. Check direct production dependency
  const expressDep = result.dependencies.find(d => d.packageName === 'express');
  assert.ok(expressDep, 'express should exist');
  assert.equal(expressDep.version, '4.19.2');
  assert.equal(expressDep.isDirect, true);
  assert.equal(expressDep.depth, 1);
  assert.equal(expressDep.parentPackage, null);
  assert.equal(expressDep.dependencyType, 'direct');
  assert.equal(expressDep.versionSpecifier, '^4.19.2');

  // 2. Check direct dev dependency
  const vitestDep = result.dependencies.find(d => d.packageName === 'vitest');
  assert.ok(vitestDep);
  assert.equal(vitestDep.version, '1.6.0');
  assert.equal(vitestDep.isDirect, true);
  assert.equal(vitestDep.depth, 1);
  assert.equal(vitestDep.dependencyType, 'development');

  // 3. Check direct optional dependency
  const fseventsDep = result.dependencies.find(d => d.packageName === 'fsevents');
  assert.ok(fseventsDep);
  assert.equal(fseventsDep.isDirect, true);
  assert.equal(fseventsDep.dependencyType, 'optional');

  // 4. Check transitive dependency at depth 2
  const acceptsDep = result.dependencies.find(d => d.packageName === 'accepts');
  assert.ok(acceptsDep);
  assert.equal(acceptsDep.version, '1.3.8');
  assert.equal(acceptsDep.isDirect, false);
  assert.equal(acceptsDep.depth, 2);
  assert.equal(acceptsDep.parentPackage, 'express');
  assert.equal(acceptsDep.dependencyType, 'transitive');

  // 5. Check transitive dependency at depth 3
  const mimeTypesDep = result.dependencies.find(d => d.packageName === 'mime-types');
  assert.ok(mimeTypesDep);
  assert.equal(mimeTypesDep.version, '2.1.35');
  assert.equal(mimeTypesDep.isDirect, false);
  assert.equal(mimeTypesDep.depth, 3);
  assert.equal(mimeTypesDep.parentPackage, 'accepts');

  // 6. Check unhoisted nested package
  const cookieDep = result.dependencies.find(d => d.packageName === 'cookie');
  assert.ok(cookieDep);
  assert.equal(cookieDep.version, '0.6.0');
  assert.equal(cookieDep.isDirect, false);
  assert.equal(cookieDep.depth, 2);
  assert.equal(cookieDep.parentPackage, 'express');
});

test('Lockfile: npm lockfileVersion 2 - packages format with dev and transitive dependencies', () => {
  const result = parsePackageLock('package-lock.json', sampleLockfileV2);

  assert.equal(result.success, true);
  assert.equal(result.lockfileVersion, 2);
  assert.equal(result.totalDependencies, 3);
  assert.equal(result.directCount, 2); // axios, eslint
  assert.equal(result.transitiveCount, 1); // follow-redirects

  const axiosDep = result.dependencies.find(d => d.packageName === 'axios');
  assert.equal(axiosDep.isDirect, true);
  assert.equal(axiosDep.dependencyType, 'direct');
  assert.equal(axiosDep.depth, 1);

  const eslintDep = result.dependencies.find(d => d.packageName === 'eslint');
  assert.equal(eslintDep.isDirect, true);
  assert.equal(eslintDep.dependencyType, 'development');

  const followDep = result.dependencies.find(d => d.packageName === 'follow-redirects');
  assert.equal(followDep.isDirect, false);
  assert.equal(followDep.depth, 2);
  assert.equal(followDep.parentPackage, 'axios');
});

test('Lockfile: npm legacy fallback format (dependencies-only)', () => {
  const packageJson = JSON.stringify({
    dependencies: { 'lodash': '^4.17.21' },
    devDependencies: { 'jest': '^27.5.1' }
  });

  const result = parsePackageLock('package-lock.json', sampleLockfileLegacyDepsOnly, { packageJson });

  assert.equal(result.success, true);
  assert.equal(result.totalDependencies, 3);
  assert.equal(result.directCount, 2); // lodash, jest
  assert.equal(result.transitiveCount, 1); // chalk

  const lodashDep = result.dependencies.find(d => d.packageName === 'lodash');
  assert.equal(lodashDep.isDirect, true);
  assert.equal(lodashDep.depth, 1);

  const chalkDep = result.dependencies.find(d => d.packageName === 'chalk');
  assert.equal(chalkDep.isDirect, false);
  assert.equal(chalkDep.depth, 2);
  assert.equal(chalkDep.parentPackage, 'jest');
});

test('Lockfile: Malformed, empty, and edge cases produce controlled results without crashing', () => {
  // Empty content
  const emptyRes = parsePackageLock('package-lock.json', '');
  assert.equal(emptyRes.success, true);
  assert.equal(emptyRes.totalDependencies, 0);

  // Whitespace content
  const wsRes = parsePackageLock('package-lock.json', '   \n  ');
  assert.equal(wsRes.success, true);
  assert.equal(wsRes.totalDependencies, 0);

  // Invalid JSON syntax
  const malformedRes = parsePackageLock('package-lock.json', '{ "lockfileVersion": 3, invalid-syntax');
  assert.equal(malformedRes.success, false);
  assert.equal(malformedRes.totalDependencies, 0);
  assert.ok(malformedRes.error.includes('Failed to parse package-lock.json'));

  // Empty JSON object
  const emptyObjRes = parsePackageLock('package-lock.json', '{}');
  assert.equal(emptyObjRes.success, true);
  assert.equal(emptyObjRes.totalDependencies, 0);

  // Missing packages and dependencies sections
  const noSectionsRes = parsePackageLock('package-lock.json', '{"name": "test", "lockfileVersion": 3}');
  assert.equal(noSectionsRes.success, true);
  assert.equal(noSectionsRes.totalDependencies, 0);
});

test('Snapshot: extractDependenciesFromSnapshotFiles extracts from multi-ecosystem repository files', () => {
  const files = [
    {
      path: 'package.json',
      content: JSON.stringify({
        dependencies: { 'express': '^4.19.2' }
      })
    },
    {
      path: 'package-lock.json',
      content: sampleLockfileV3
    },
    {
      path: 'requirements.txt',
      content: 'requests>=2.28.0\nflask==2.3.2\n'
    }
  ];

  const result = extractDependenciesFromSnapshotFiles(files, {
    snapshotId: 'snap-123',
    repositoryId: 'repo-123'
  });

  assert.ok(result.totalDependencies >= 11);
  assert.ok(result.dependencies.some(d => d.ecosystem === 'npm' && d.packageName === 'express'));
  assert.ok(result.dependencies.some(d => d.ecosystem === 'npm' && d.packageName === 'accepts'));
  assert.ok(result.dependencies.some(d => d.ecosystem === 'pypi' && d.packageName === 'requests'));
  assert.ok(result.dependencies.some(d => d.ecosystem === 'pypi' && d.packageName === 'flask'));

  // Ensure lockfile took precedence over root package.json (no duplicate express direct records)
  const expressDeps = result.dependencies.filter(d => d.packageName === 'express');
  assert.equal(expressDeps.length, 1);
});

test('Integration & Database: Persist dependencies, test idempotency and snapshot isolation', async () => {
  const client = await pool.connect();

  try {
    // 1. Create test user
    const { rows: userRows } = await client.query(`
      INSERT INTO users (github_id, login, name, email)
      VALUES ($1, $2, $3, $4)
      RETURNING id;
    `, [Date.now(), `test-user-${Date.now()}`, 'Lockfile Test User', `user-${Date.now()}@test.com`]);
    const userId = userRows[0].id;

    // 2. Create test repository
    const { rows: repoRows } = await client.query(`
      INSERT INTO repositories (user_id, provider, owner, name, full_name)
      VALUES ($1, 'github', 'test-org', $2, $3)
      RETURNING id;
    `, [userId, `repo-${Date.now()}`, `test-org/repo-${Date.now()}`]);
    const repoId = repoRows[0].id;

    // 3. Create Snapshot A
    const { rows: snapARows } = await client.query(`
      INSERT INTO repository_snapshots (repository_id, commit_sha, branch, status)
      VALUES ($1, '1111111111111111111111111111111111111111', 'main', 'completed')
      RETURNING id;
    `, [repoId]);
    const snapshotAId = snapARows[0].id;

    // 4. Create Snapshot B
    const { rows: snapBRows } = await client.query(`
      INSERT INTO repository_snapshots (repository_id, commit_sha, branch, status)
      VALUES ($1, '2222222222222222222222222222222222222222', 'feature', 'completed')
      RETURNING id;
    `, [repoId]);
    const snapshotBId = snapBRows[0].id;

    // 5. Extract dependencies from sampleLockfileV3 for Snapshot A
    const parsedA = parsePackageLock('package-lock.json', sampleLockfileV3, {
      snapshotId: snapshotAId,
      repositoryId: repoId
    });
    assert.equal(parsedA.dependencies.length, 9);

    // 6. Persist dependencies for Snapshot A
    const persistResA = await persistSnapshotDependencies(snapshotAId, repoId, parsedA.dependencies, client);
    assert.equal(persistResA.total, 9);

    // 7. Verify retrieval for Snapshot A
    const retrievedA = await getPersistedSnapshotDependencies(snapshotAId, { clientOrPool: client });
    assert.equal(retrievedA.length, 9);
    assert.equal(retrievedA[0].snapshotId, snapshotAId);
    assert.equal(retrievedA[0].repositoryId, repoId);

    const directA = await getPersistedSnapshotDependencies(snapshotAId, { isDirect: true, clientOrPool: client });
    assert.equal(directA.length, 4);

    const transitiveA = await getPersistedSnapshotDependencies(snapshotAId, { isDirect: false, clientOrPool: client });
    assert.equal(transitiveA.length, 5);

    // 8. Test Idempotency: Re-persist the exact same dependencies for Snapshot A
    const rePersistResA = await persistSnapshotDependencies(snapshotAId, repoId, parsedA.dependencies, client);
    assert.equal(rePersistResA.total, 9);

    const retrievedAfterRePersist = await getPersistedSnapshotDependencies(snapshotAId, { clientOrPool: client });
    assert.equal(retrievedAfterRePersist.length, 9, 'Re-persisting must not duplicate records');

    // 9. Test Snapshot Isolation: Persist distinct dependencies for Snapshot B
    const parsedB = parsePackageLock('package-lock.json', sampleLockfileV2, {
      snapshotId: snapshotBId,
      repositoryId: repoId
    });
    assert.equal(parsedB.dependencies.length, 3);

    await persistSnapshotDependencies(snapshotBId, repoId, parsedB.dependencies, client);

    const retrievedB = await getPersistedSnapshotDependencies(snapshotBId, { clientOrPool: client });
    assert.equal(retrievedB.length, 3, 'Snapshot B must contain exactly 3 dependencies');

    // Re-verify Snapshot A is still isolated and unchanged
    const recheckA = await getPersistedSnapshotDependencies(snapshotAId, { clientOrPool: client });
    assert.equal(recheckA.length, 9, 'Snapshot A must still contain exactly 9 dependencies (isolated from Snapshot B)');

    // 10. Clean up test records
    await client.query('DELETE FROM users WHERE id = $1', [userId]);
  } finally {
    client.release();
    await closePool();
  }
});
