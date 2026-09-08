import assert from 'node:assert/strict';
import { isTestFile, isProductionSourceFile, detectLanguage, normalizePath } from '../src/services/intelligence/pathClassifier.js';

console.log('--- Starting Path Classifier & File Filtering Test Suite ---');

// 1. Normalization
assert.equal(normalizePath('./src/foo.js'), 'src/foo.js');
assert.equal(normalizePath('src\\lib\\bar.js'), 'src/lib/bar.js');

// 2. Test File Detection - Root and Nested Paths
const testCasesShouldBeTest = [
  'test/validators.js',
  'test/sanitizers.js',
  'test/app.router.js',
  'test/res.send.js',
  'tests/test_cli.py',
  'tests/test_termui.py',
  'spec/helper.js',
  'specs/core.spec.js',
  'src/test/foo.js',
  'src/tests/bar.js',
  'packages/core/__tests__/index.ts',
  'src/components/Button.test.jsx',
  'src/utils/math.spec.ts',
  'test_parser.py',
  'client_test.py',
  'GsonTest.java',
  'UserTestCase.java',
  'src/test-helpers/mock.js',
  'source/index.test-d.ts'
];

for (const p of testCasesShouldBeTest) {
  assert.equal(isTestFile(p), true, `Expected isTestFile("${p}") to be true`);
  assert.equal(isProductionSourceFile(p), false, `Expected isProductionSourceFile("${p}") to be false (must reject test files)`);
}
console.log(`✓ Passed: ${testCasesShouldBeTest.length} test/spec paths correctly identified and excluded.`);

// 3. Legitimate Production Paths Containing "test" as Substring
// MUST NOT BE FALSE-POSITIVELY EXCLUDED
const legitimateNonTestPaths = [
  'src/contest/leaderboard.js',
  'src/attestation/verifier.py',
  'src/testimony/quote.js',
  'src/speedtest/bandwidth.ts',
  'src/latest/release.java',
  'src/detest/filter.js',
  'lib/protest/handler.js'
];

for (const p of legitimateNonTestPaths) {
  assert.equal(isTestFile(p), false, `Expected isTestFile("${p}") to be false (must not false-positive on substring 'test')`);
  assert.equal(isProductionSourceFile(p), true, `Expected isProductionSourceFile("${p}") to be true for genuine source code`);
}
console.log(`✓ Passed: ${legitimateNonTestPaths.length} legitimate paths containing 'test' substring preserved as source files.`);

// 4. Production Source Code Files
const legitimateSourceFiles = [
  'lib/router/index.js',
  'lib/response.js',
  'src/lib/isMobilePhone.js',
  'src/lib/isEmail.js',
  'packages/zod/src/types.ts',
  'axios/lib/adapters/xhr.js',
  'bottle.py',
  'requests/models.py',
  'src/main/java/com/google/gson/Gson.java'
];

for (const p of legitimateSourceFiles) {
  assert.equal(isProductionSourceFile(p), true, `Expected isProductionSourceFile("${p}") to be true`);
}
console.log(`✓ Passed: ${legitimateSourceFiles.length} standard production source files verified.`);

// 5. Auxiliary & Build Artifacts (Must be excluded from dataset)
const auxiliaryFiles = [
  'docs/conf.py',
  'docs/api/index.ts',
  'examples/auth/index.js',
  'build-browser.js',
  '.configs/rollup.config.js',
  'vite.config.ts',
  'webpack.config.js',
  'dist/axios.min.js',
  '.claude/skills/triage/scripts/reindex.mjs'
];

for (const p of auxiliaryFiles) {
  assert.equal(isProductionSourceFile(p), false, `Expected isProductionSourceFile("${p}") to be false for auxiliary/build files`);
}
console.log(`✓ Passed: ${auxiliaryFiles.length} auxiliary/build/config files correctly excluded.`);

// 6. Language Detection
assert.equal(detectLanguage('foo.js'), 'javascript');
assert.equal(detectLanguage('foo.ts'), 'typescript');
assert.equal(detectLanguage('foo.tsx'), 'typescript');
assert.equal(detectLanguage('foo.py'), 'python');
assert.equal(detectLanguage('foo.java'), 'java');
assert.equal(detectLanguage('README.md'), 'unknown');

console.log('✓ Passed: Language detection verified across all target ecosystems.');
console.log('\n======================================================');
console.log('ALL PATH CLASSIFIER & FILTERING TESTS PASSED (100%)');
console.log('======================================================\n');
