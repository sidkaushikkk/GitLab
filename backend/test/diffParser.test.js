import test from 'node:test';
import assert from 'node:assert/strict';
import { parseUnifiedDiff } from '../src/services/intelligence/diffParser.js';

test('diffParser: empty diff returns zero counts and empty array', () => {
  const result = parseUnifiedDiff('');
  assert.equal(result.files.length, 0);
  assert.equal(result.totalAdditions, 0);
  assert.equal(result.totalDeletions, 0);
  assert.equal(result.changedFileCount, 0);
  assert.equal(result.warnings.length, 0);
});

test('diffParser: invalid input type throws TypeError', () => {
  assert.throws(() => parseUnifiedDiff(null), TypeError);
  assert.throws(() => parseUnifiedDiff(123), TypeError);
});

test('diffParser: normal modification with single hunk and changed line ranges', () => {
  const diff = `diff --git a/src/math.js b/src/math.js
index 1111111..2222222 100644
--- a/src/math.js
+++ b/src/math.js
@@ -10,5 +10,7 @@ function add(a, b) {
   const c = a + b;
-  return c;
+  const d = c * 2;
+  const e = d + 1;
+  return e;
 }
`;

  const result = parseUnifiedDiff(diff);
  assert.equal(result.files.length, 1);
  assert.equal(result.changedFileCount, 1);
  assert.equal(result.totalAdditions, 3);
  assert.equal(result.totalDeletions, 1);

  const f = result.files[0];
  assert.equal(f.filePath, 'src/math.js');
  assert.equal(f.oldPath, 'src/math.js');
  assert.equal(f.newPath, 'src/math.js');
  assert.equal(f.changeType, 'modified');
  assert.equal(f.isBinary, false);
  assert.equal(f.additions, 3);
  assert.equal(f.deletions, 1);

  // In new file: line 10 is 'function add', line 11 is 'const c',
  // line 12 is 'const d', line 13 is 'const e', line 14 is 'return e', line 15 is '}'
  // Lines 12, 13, 14 are added
  assert.deepEqual(f.changedLineRanges, [{ start: 11, end: 13 }]);
  // In old file: line 12 was 'return c;'
  assert.deepEqual(f.oldLineRanges, [{ start: 11, end: 11 }]);

  assert.equal(f.hunks.length, 1);
  const hunk = f.hunks[0];
  assert.equal(hunk.oldStart, 10);
  assert.equal(hunk.oldCount, 5);
  assert.equal(hunk.newStart, 10);
  assert.equal(hunk.newCount, 7);
  assert.equal(hunk.additions, 3);
  assert.equal(hunk.deletions, 1);
  assert.deepEqual(hunk.changedLineRanges, [{ start: 11, end: 13 }]);
});

test('diffParser: added new file from /dev/null', () => {
  const diff = `diff --git a/src/newUtil.js b/src/newUtil.js
new file mode 100644
index 0000000..abcdef1
--- /dev/null
+++ b/src/newUtil.js
@@ -0,0 +1,4 @@
+export function greet() {
+  return 'hello';
+}
+
`;

  const result = parseUnifiedDiff(diff);
  assert.equal(result.files.length, 1);
  const f = result.files[0];
  assert.equal(f.filePath, 'src/newUtil.js');
  assert.equal(f.oldPath, '/dev/null');
  assert.equal(f.newPath, 'src/newUtil.js');
  assert.equal(f.changeType, 'added');
  assert.equal(f.additions, 4);
  assert.equal(f.deletions, 0);
  assert.deepEqual(f.changedLineRanges, [{ start: 1, end: 4 }]);
});

test('diffParser: deleted file to /dev/null', () => {
  const diff = `diff --git a/src/deprecated.js b/src/deprecated.js
deleted file mode 100644
index abcdef1..0000000
--- a/src/deprecated.js
+++ /dev/null
@@ -1,3 +0,0 @@
-export function old() {
-  return 'old';
-}
`;

  const result = parseUnifiedDiff(diff);
  assert.equal(result.files.length, 1);
  const f = result.files[0];
  assert.equal(f.filePath, 'src/deprecated.js');
  assert.equal(f.oldPath, 'src/deprecated.js');
  assert.equal(f.newPath, '/dev/null');
  assert.equal(f.changeType, 'deleted');
  assert.equal(f.additions, 0);
  assert.equal(f.deletions, 3);
  assert.deepEqual(f.changedLineRanges, []);
  assert.deepEqual(f.oldLineRanges, [{ start: 1, end: 3 }]);
});

test('diffParser: renamed file with modification and similarity index', () => {
  const diff = `diff --git a/src/oldModule.js b/src/newModule.js
similarity index 90%
rename from src/oldModule.js
rename to src/newModule.js
index 1234567..89abcdef 100644
--- a/src/oldModule.js
+++ b/src/newModule.js
@@ -1,3 +1,3 @@
 const x = 1;
-const y = 2;
+const y = 20;
 const z = 3;
`;

  const result = parseUnifiedDiff(diff);
  assert.equal(result.files.length, 1);
  const f = result.files[0];
  assert.equal(f.filePath, 'src/newModule.js');
  assert.equal(f.oldPath, 'src/oldModule.js');
  assert.equal(f.newPath, 'src/newModule.js');
  assert.equal(f.changeType, 'renamed');
  assert.equal(f.additions, 1);
  assert.equal(f.deletions, 1);
  assert.deepEqual(f.changedLineRanges, [{ start: 2, end: 2 }]);
  assert.deepEqual(f.oldLineRanges, [{ start: 2, end: 2 }]);
});

test('diffParser: multiple hunks in a single file', () => {
  const diff = `diff --git a/src/service.js b/src/service.js
index 1111111..2222222 100644
--- a/src/service.js
+++ b/src/service.js
@@ -5,4 +5,5 @@ function first() {
   step1();
+  step1_extra();
   step2();
 }
@@ -20,4 +21,5 @@ function second() {
   calc1();
+  calc2();
   calc3();
 }
`;

  const result = parseUnifiedDiff(diff);
  assert.equal(result.files.length, 1);
  const f = result.files[0];
  assert.equal(f.hunks.length, 2);
  assert.equal(f.additions, 2);
  assert.equal(f.deletions, 0);
  assert.deepEqual(f.changedLineRanges, [
    { start: 6, end: 6 },
    { start: 22, end: 22 }
  ]);
});

test('diffParser: multiple files in a single diff patch', () => {
  const diff = `diff --git a/file1.js b/file1.js
--- a/file1.js
+++ b/file1.js
@@ -1,2 +1,3 @@
 line1
+line2
 line3
diff --git a/file2.py b/file2.py
--- a/file2.py
+++ b/file2.py
@@ -1,2 +1,2 @@
-print('old')
+print('new')
`;

  const result = parseUnifiedDiff(diff);
  assert.equal(result.files.length, 2);
  assert.equal(result.changedFileCount, 2);
  assert.equal(result.totalAdditions, 2);
  assert.equal(result.totalDeletions, 1);
  assert.equal(result.files[0].filePath, 'file1.js');
  assert.equal(result.files[1].filePath, 'file2.py');
});

test('diffParser: binary files handling', () => {
  const diff = `diff --git a/assets/icon.png b/assets/icon.png
index 1111111..2222222 100644
Binary files a/assets/icon.png and b/assets/icon.png differ
`;

  const result = parseUnifiedDiff(diff);
  assert.equal(result.files.length, 1);
  const f = result.files[0];
  assert.equal(f.filePath, 'assets/icon.png');
  assert.equal(f.isBinary, true);
  assert.equal(f.changeType, 'modified');
  assert.equal(f.hunks.length, 0);
});

test('diffParser: handles patch with malformed hunk gracefully with warnings', () => {
  const diff = `diff --git a/bad.js b/bad.js
--- a/bad.js
+++ b/bad.js
@@ invalid hunk header @@
+hello
`;

  const result = parseUnifiedDiff(diff);
  assert.equal(result.files.length, 1);
  assert.ok(result.warnings.length > 0);
});
