import test from 'node:test';
import assert from 'node:assert/strict';
import { mapDiffToAstImpact } from '../src/services/intelligence/astImpact.js';
import { parseUnifiedDiff } from '../src/services/intelligence/diffParser.js';

test('astImpact: modified function and unchanged function within a file', () => {
  const baseCode = `
function calculateTotal(items) {
  let sum = 0;
  for (const item of items) {
    sum += item.price;
  }
  return sum;
}

function formatCurrency(val) {
  return '$' + val.toFixed(2);
}
`;

  const headCode = `
function calculateTotal(items) {
  let sum = 0;
  for (const item of items) {
    sum += item.price * (1 + item.tax);
  }
  return sum;
}

function formatCurrency(val) {
  return '$' + val.toFixed(2);
}
`;

  const diffText = `diff --git a/src/billing.js b/src/billing.js
--- a/src/billing.js
+++ b/src/billing.js
@@ -4,3 +4,3 @@ function calculateTotal(items) {
   for (const item of items) {
-    sum += item.price;
+    sum += item.price * (1 + item.tax);
   }
`;

  const parsedDiff = parseUnifiedDiff(diffText);
  const baseFiles = [{ filePath: 'src/billing.js', content: baseCode, language: 'javascript' }];
  const headFiles = [{ filePath: 'src/billing.js', content: headCode, language: 'javascript' }];

  const result = mapDiffToAstImpact({ parsedDiff, baseFiles, headFiles });

  assert.equal(result.files.length, 1);
  const fileImpact = result.files[0];
  assert.equal(fileImpact.filePath, 'src/billing.js');

  const fnTotal = fileImpact.entities.find(e => e.name === 'calculateTotal');
  assert.ok(fnTotal, 'calculateTotal should be found');
  assert.equal(fnTotal.entityType, 'FUNCTION');
  assert.equal(fnTotal.changeClassification, 'MODIFIED');
  assert.ok(fnTotal.overlappingLineRanges.length > 0);

  const fnCurrency = fileImpact.entities.find(e => e.name === 'formatCurrency');
  assert.ok(fnCurrency, 'formatCurrency should be found');
  assert.equal(fnCurrency.entityType, 'FUNCTION');
  assert.equal(fnCurrency.changeClassification, 'UNCHANGED');
  assert.equal(fnCurrency.overlappingLineRanges.length, 0);

  const fileEntity = fileImpact.entities.find(e => e.entityType === 'FILE');
  assert.ok(fileEntity);
  assert.equal(fileEntity.changeClassification, 'MODIFIED');
});

test('astImpact: added entity (new function) in head snapshot', () => {
  const baseCode = `
function oldFunc() {
  return 1;
}
`;

  const headCode = `
function oldFunc() {
  return 1;
}

function newAddedFunc() {
  return 2;
}
`;

  const diffText = `diff --git a/src/helpers.js b/src/helpers.js
--- a/src/helpers.js
+++ b/src/helpers.js
@@ -4,0 +5,4 @@ function oldFunc() {
+function newAddedFunc() {
+  return 2;
+}
`;

  const parsedDiff = parseUnifiedDiff(diffText);
  const baseFiles = [{ filePath: 'src/helpers.js', content: baseCode, language: 'javascript' }];
  const headFiles = [{ filePath: 'src/helpers.js', content: headCode, language: 'javascript' }];

  const result = mapDiffToAstImpact({ parsedDiff, baseFiles, headFiles });
  const fileImpact = result.files[0];

  const addedEntity = fileImpact.entities.find(e => e.name === 'newAddedFunc');
  assert.ok(addedEntity, 'newAddedFunc should exist');
  assert.equal(addedEntity.changeClassification, 'ADDED');

  const oldEntity = fileImpact.entities.find(e => e.name === 'oldFunc');
  assert.ok(oldEntity, 'oldFunc should exist');
  assert.equal(oldEntity.changeClassification, 'UNCHANGED');
});

test('astImpact: deleted entity in base snapshot removed in head', () => {
  const baseCode = `
function toDelete() {
  return 'gone';
}

function toKeep() {
  return 'stay';
}
`;

  const headCode = `
function toKeep() {
  return 'stay';
}
`;

  const diffText = `diff --git a/src/legacy.js b/src/legacy.js
--- a/src/legacy.js
+++ b/src/legacy.js
@@ -1,5 +0,0 @@
-function toDelete() {
-  return 'gone';
-}
-
`;

  const parsedDiff = parseUnifiedDiff(diffText);
  const baseFiles = [{ filePath: 'src/legacy.js', content: baseCode, language: 'javascript' }];
  const headFiles = [{ filePath: 'src/legacy.js', content: headCode, language: 'javascript' }];

  const result = mapDiffToAstImpact({ parsedDiff, baseFiles, headFiles });
  const fileImpact = result.files[0];

  const deletedEntity = fileImpact.entities.find(e => e.name === 'toDelete');
  assert.ok(deletedEntity, 'toDelete should be found as deleted');
  assert.equal(deletedEntity.changeClassification, 'DELETED');

  const keptEntity = fileImpact.entities.find(e => e.name === 'toKeep');
  assert.ok(keptEntity, 'toKeep should be unchanged');
  assert.equal(keptEntity.changeClassification, 'UNCHANGED');
});

test('astImpact: modified class method and class container', () => {
  const baseCode = `
class PaymentService {
  process(amount) {
    return amount > 0;
  }
}
`;

  const headCode = `
class PaymentService {
  process(amount) {
    if (amount <= 0) throw new Error('Invalid');
    return true;
  }
}
`;

  const diffText = `diff --git a/src/service.js b/src/service.js
--- a/src/service.js
+++ b/src/service.js
@@ -3,2 +3,3 @@ class PaymentService {
   process(amount) {
-    return amount > 0;
+    if (amount <= 0) throw new Error('Invalid');
+    return true;
   }
`;

  const parsedDiff = parseUnifiedDiff(diffText);
  const baseFiles = [{ filePath: 'src/service.js', content: baseCode, language: 'javascript' }];
  const headFiles = [{ filePath: 'src/service.js', content: headCode, language: 'javascript' }];

  const result = mapDiffToAstImpact({ parsedDiff, baseFiles, headFiles });
  const fileImpact = result.files[0];

  const classEntity = fileImpact.entities.find(e => e.name === 'PaymentService');
  assert.ok(classEntity);
  assert.equal(classEntity.entityType, 'CLASS');
  assert.equal(classEntity.changeClassification, 'MODIFIED');

  const methodEntity = fileImpact.entities.find(e => e.name === 'process');
  assert.ok(methodEntity);
  assert.equal(methodEntity.changeClassification, 'MODIFIED');
});

test('astImpact: entirely new file added', () => {
  const headCode = `
export class Logger {
  log(msg) {
    console.log(msg);
  }
}
`;

  const diffText = `diff --git a/src/logger.js b/src/logger.js
new file mode 100644
--- /dev/null
+++ b/src/logger.js
@@ -0,0 +1,7 @@
+export class Logger {
+  log(msg) {
+    console.log(msg);
+  }
+}
`;

  const parsedDiff = parseUnifiedDiff(diffText);
  const headFiles = [{ filePath: 'src/logger.js', content: headCode, language: 'javascript' }];

  const result = mapDiffToAstImpact({ parsedDiff, baseFiles: [], headFiles });
  assert.equal(result.files.length, 1);
  assert.equal(result.files[0].status, 'added');
  assert.ok(result.summary.added > 0);
  assert.equal(result.summary.modified, 0);
  assert.equal(result.summary.deleted, 0);

  for (const ent of result.files[0].entities) {
    assert.equal(ent.changeClassification, 'ADDED');
  }
});
