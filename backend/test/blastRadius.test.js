import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateBlastRadius } from '../src/services/intelligence/blastRadius.js';

test('blastRadius: direct dependency (A imports B; B modified -> A directly affected at depth 1)', () => {
  const relationships = [
    {
      sourceFilePath: 'src/services/userService.js',
      targetFilePath: 'src/db/connection.js',
      relationshipType: 'IMPORTS',
      symbolsImported: ['query']
    }
  ];

  const result = calculateBlastRadius({
    changedFiles: ['src/db/connection.js'],
    relationships,
    maxDepth: 3
  });

  assert.equal(result.totalAffectedNodes, 1);
  assert.equal(result.maxDepthReached, 1);
  assert.deepEqual(result.affectedFiles, ['src/services/userService.js']);
  assert.equal(result.directlyAffected.length, 1);
  assert.equal(result.transitivelyAffected.length, 0);

  const direct = result.directlyAffected[0];
  assert.equal(direct.filePath, 'src/services/userService.js');
  assert.equal(direct.depth, 1);
  assert.equal(direct.relationshipType, 'IMPORTS');
  assert.equal(direct.dependedOn, 'src/db/connection.js');
});

test('blastRadius: multi-level dependency (C imports B, B imports A; A modified -> B at depth 1, C at depth 2)', () => {
  const relationships = [
    {
      sourceFilePath: 'src/b.js',
      targetFilePath: 'src/a.js',
      relationshipType: 'IMPORTS'
    },
    {
      sourceFilePath: 'src/c.js',
      targetFilePath: 'src/b.js',
      relationshipType: 'IMPORTS'
    }
  ];

  const result = calculateBlastRadius({
    changedFiles: ['src/a.js'],
    relationships,
    maxDepth: 3
  });

  assert.equal(result.totalAffectedNodes, 2);
  assert.equal(result.maxDepthReached, 2);
  assert.deepEqual(result.affectedFiles, ['src/b.js', 'src/c.js']);

  assert.equal(result.directlyAffected.length, 1);
  assert.equal(result.directlyAffected[0].filePath, 'src/b.js');
  assert.equal(result.directlyAffected[0].depth, 1);

  assert.equal(result.transitivelyAffected.length, 1);
  assert.equal(result.transitivelyAffected[0].filePath, 'src/c.js');
  assert.equal(result.transitivelyAffected[0].depth, 2);
  assert.equal(result.transitivelyAffected[0].dependedOn, 'src/b.js');
});

test('blastRadius: cycles (A imports B, B imports A; cycle terminates cleanly with visited set)', () => {
  const relationships = [
    {
      sourceFilePath: 'src/a.js',
      targetFilePath: 'src/b.js',
      relationshipType: 'IMPORTS'
    },
    {
      sourceFilePath: 'src/b.js',
      targetFilePath: 'src/a.js',
      relationshipType: 'IMPORTS'
    }
  ];

  // Modify B. A imports B -> A is affected. Since B was the seed, B is not re-visited as affected node.
  const result = calculateBlastRadius({
    changedFiles: ['src/b.js'],
    relationships,
    maxDepth: 5
  });

  assert.equal(result.totalAffectedNodes, 1);
  assert.equal(result.directlyAffected.length, 1);
  assert.equal(result.directlyAffected[0].filePath, 'src/a.js');
  assert.equal(result.transitivelyAffected.length, 0);
  assert.deepEqual(result.affectedFiles, ['src/a.js']);
});

test('blastRadius: duplicate path / diamond dependency (D imports B and C; B and C import A; D visited once at depth 2)', () => {
  const relationships = [
    {
      sourceFilePath: 'src/b.js',
      targetFilePath: 'src/a.js',
      relationshipType: 'IMPORTS'
    },
    {
      sourceFilePath: 'src/c.js',
      targetFilePath: 'src/a.js',
      relationshipType: 'IMPORTS'
    },
    {
      sourceFilePath: 'src/d.js',
      targetFilePath: 'src/b.js',
      relationshipType: 'IMPORTS'
    },
    {
      sourceFilePath: 'src/d.js',
      targetFilePath: 'src/c.js',
      relationshipType: 'IMPORTS'
    }
  ];

  const result = calculateBlastRadius({
    changedFiles: ['src/a.js'],
    relationships,
    maxDepth: 3
  });

  // B and C at depth 1, D at depth 2 (visited exactly once)
  assert.equal(result.totalAffectedNodes, 3);
  assert.equal(result.directlyAffected.length, 2);
  const directPaths = result.directlyAffected.map(n => n.filePath).sort();
  assert.deepEqual(directPaths, ['src/b.js', 'src/c.js']);

  assert.equal(result.transitivelyAffected.length, 1);
  assert.equal(result.transitivelyAffected[0].filePath, 'src/d.js');
  assert.equal(result.transitivelyAffected[0].depth, 2);
  assert.deepEqual(result.affectedFiles, ['src/b.js', 'src/c.js', 'src/d.js']);
});

test('blastRadius: isolated node with 0 dependents returns empty affected list', () => {
  const relationships = [
    {
      sourceFilePath: 'src/app.js',
      targetFilePath: 'src/other.js',
      relationshipType: 'IMPORTS'
    }
  ];

  const result = calculateBlastRadius({
    changedFiles: ['src/isolated.js'],
    relationships,
    maxDepth: 3
  });

  assert.equal(result.totalAffectedNodes, 0);
  assert.equal(result.maxDepthReached, 0);
  assert.deepEqual(result.affectedFiles, []);
  assert.equal(result.directlyAffected.length, 0);
  assert.equal(result.transitivelyAffected.length, 0);
});

test('blastRadius: empty inputs return empty result safely', () => {
  const result = calculateBlastRadius();
  assert.equal(result.totalAffectedNodes, 0);
  assert.deepEqual(result.seedNodes, []);
});
