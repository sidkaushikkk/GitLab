import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyVersionTransition,
  compareSnapshots
} from '../src/services/intelligence/trajectoryEngine.js';

test('Trajectory Engine logic tests', async (t) => {
  await t.test('classifyVersionTransition identifies semver changes', () => {
    assert.equal(classifyVersionTransition(null, '1.0.0'), 'ADDED');
    assert.equal(classifyVersionTransition('1.0.0', null), 'REMOVED');
    assert.equal(classifyVersionTransition('1.0.0', '1.0.0'), 'UNCHANGED');
    assert.equal(classifyVersionTransition('1.0.0', '1.1.0'), 'UPGRADED');
    assert.equal(classifyVersionTransition('2.0.0', '1.9.0'), 'DOWNGRADED');
  });

  await t.test('compareSnapshots partitions findings into NEW, PERSISTENT, and RESOLVED', async () => {
    // Mock dbPool
    const baseVulns = [
      { package_name: 'lodash', canonical_id: 'CVE-2020-8203', severity: 'HIGH' },
      { package_name: 'axios', canonical_id: 'CVE-2020-28168', severity: 'MEDIUM' }
    ];

    const targetVulns = [
      // lodash persists
      { package_name: 'lodash', canonical_id: 'CVE-2020-8203', severity: 'HIGH' },
      // express is new
      { package_name: 'express', canonical_id: 'CVE-2022-24999', severity: 'CRITICAL' }
      // axios was resolved!
    ];

    const baseDeps = [
      { package_name: 'lodash', ecosystem: 'npm', version: '4.17.15', is_direct: true },
      { package_name: 'axios', ecosystem: 'npm', version: '0.19.0', is_direct: true }
    ];

    const targetDeps = [
      { package_name: 'lodash', ecosystem: 'npm', version: '4.17.15', is_direct: true },
      { package_name: 'axios', ecosystem: 'npm', version: '0.21.1', is_direct: true }, // upgraded!
      { package_name: 'express', ecosystem: 'npm', version: '4.16.0', is_direct: true } // added!
    ];

    const mockPool = {
      async query(sql, params) {
        if (sql.includes('FROM snapshot_vulnerabilities') && params[0] === 'snap-base') {
          return { rows: baseVulns };
        }
        if (sql.includes('FROM snapshot_vulnerabilities') && params[0] === 'snap-target') {
          return { rows: targetVulns };
        }
        if (sql.includes('FROM snapshot_dependencies') && params[0] === 'snap-base') {
          return { rows: baseDeps };
        }
        if (sql.includes('FROM snapshot_dependencies') && params[0] === 'snap-target') {
          return { rows: targetDeps };
        }
        return { rows: [] };
      }
    };

    const diff = await compareSnapshots('snap-base', 'snap-target', mockPool);

    assert.equal(diff.metrics.newCount, 1);
    assert.equal(diff.newFindings[0].canonical_id, 'CVE-2022-24999');

    assert.equal(diff.metrics.persistentCount, 1);
    assert.equal(diff.persistentFindings[0].canonical_id, 'CVE-2020-8203');

    assert.equal(diff.metrics.resolvedCount, 1);
    assert.equal(diff.resolvedFindings[0].canonical_id, 'CVE-2020-28168');

    // Check dependency transitions
    const axiosTransition = diff.dependencyTransitions.find(d => d.packageName === 'axios');
    assert.equal(axiosTransition?.transition, 'UPGRADED');

    const expressTransition = diff.dependencyTransitions.find(d => d.packageName === 'express');
    assert.equal(expressTransition?.transition, 'ADDED');
  });
});
