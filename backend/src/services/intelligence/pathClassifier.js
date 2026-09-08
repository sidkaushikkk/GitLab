import path from 'node:path';

const SUPPORTED_SOURCE_EXTENSIONS = new Set([
  '.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs',
  '.py',
  '.java'
]);

const TEST_DIR_NAMES = new Set([
  'test',
  'tests',
  '__tests__',
  'spec',
  'specs',
  'testing',
  'fixtures',
  '__fixtures__'
]);

const AUXILIARY_DIR_NAMES = new Set([
  'docs',
  'doc',
  'documentation',
  'examples',
  'example',
  'demo',
  'demos',
  'dist',
  'build',
  'out',
  'vendor',
  'node_modules',
  'coverage',
  '.github',
  '.claude',
  '.gemini',
  '.configs'
]);

const CONFIG_FILE_PATTERNS = [
  /rollup\.config\.[a-z]+$/i,
  /vite\.config\.[a-z]+$/i,
  /webpack\.config\.[a-z]+$/i,
  /babel\.config\.[a-z]+$/i,
  /jest\.config\.[a-z]+$/i,
  /eslint\.config\.[a-z]+$/i,
  /\.eslintrc/i,
  /build-browser\.js$/i
];

/**
 * Normalizes file path to standard forward-slash format without leading ./
 * @param {string} rawPath
 * @returns {string}
 */
export function normalizePath(rawPath) {
  if (!rawPath) return '';
  return rawPath.replace(/\\/g, '/').replace(/^\.\//, '').trim();
}

/**
 * Determines whether a file path represents a test or specification file
 * @param {string} rawPath
 * @returns {boolean}
 */
export function isTestFile(rawPath) {
  const norm = normalizePath(rawPath);
  if (!norm) return false;

  const segments = norm.toLowerCase().split('/');
  const fileName = segments[segments.length - 1];
  const dirSegments = segments.slice(0, -1);

  // 1. Directory-level checks: exact match or test prefix on directory
  for (const seg of dirSegments) {
    if (TEST_DIR_NAMES.has(seg)) return true;
    if (seg.startsWith('test-') || seg.startsWith('test_') || seg.startsWith('spec-')) return true;
  }

  // 2. File-level naming checks
  if (
    fileName.startsWith('test_') ||
    fileName.startsWith('test.') ||
    fileName.startsWith('spec.') ||
    fileName.endsWith('_test.py') ||
    fileName.endsWith('-test.js') ||
    fileName.endsWith('.test.js') ||
    fileName.endsWith('.test.jsx') ||
    fileName.endsWith('.test.ts') ||
    fileName.endsWith('.test.tsx') ||
    fileName.endsWith('.test.mjs') ||
    fileName.endsWith('.test.cjs') ||
    fileName.endsWith('.spec.js') ||
    fileName.endsWith('.spec.jsx') ||
    fileName.endsWith('.spec.ts') ||
    fileName.endsWith('.spec.tsx') ||
    fileName.endsWith('.spec.mjs') ||
    fileName.endsWith('.spec.cjs') ||
    fileName.endsWith('test.java') ||
    fileName.endsWith('testcase.java') ||
    fileName.endsWith('tests.java')
  ) {
    return true;
  }

  // Regex check for embedded .test. or .spec. or .test-d. before extension
  if (/\.(test|spec|test-[a-z0-9]+)\.[^.]+$/i.test(fileName)) {
    return true;
  }

  // Java convention: CamelCase ending with Test.java (e.g. GsonTest.java)
  const rawFileName = norm.split('/').pop();
  if (/^[A-Z][a-zA-Z0-9]*Test\.java$/.test(rawFileName)) {
    return true;
  }

  return false;
}

/**
 * Determines whether a file path is a genuine production source code file.
 * Excludes tests, documentation, examples, build outputs, minified bundles, and ambient type definitions.
 * @param {string} rawPath
 * @returns {boolean}
 */
export function isProductionSourceFile(rawPath) {
  const norm = normalizePath(rawPath);
  if (!norm) return false;

  const ext = path.extname(norm).toLowerCase();
  if (!SUPPORTED_SOURCE_EXTENSIONS.has(ext)) {
    return false;
  }

  // Exclude ambient TypeScript declaration files (.d.ts)
  if (norm.toLowerCase().endsWith('.d.ts')) {
    return false;
  }

  // Exclude minified bundles
  if (norm.toLowerCase().endsWith('.min.js') || norm.toLowerCase().endsWith('.min.css')) {
    return false;
  }

  // Exclude tests
  if (isTestFile(norm)) {
    return false;
  }

  // Exclude auxiliary and build directories
  const segments = norm.toLowerCase().split('/');
  const dirSegments = segments.slice(0, -1);
  for (const seg of dirSegments) {
    if (AUXILIARY_DIR_NAMES.has(seg)) {
      return false;
    }
  }

  // Exclude known build & tool configuration scripts
  const fileName = segments[segments.length - 1];
  for (const pattern of CONFIG_FILE_PATTERNS) {
    if (pattern.test(fileName)) {
      return false;
    }
  }

  return true;
}

/**
 * Detects programming language from file extension
 * @param {string} rawPath
 * @returns {string} 'javascript' | 'typescript' | 'python' | 'java' | 'unknown'
 */
export function detectLanguage(rawPath) {
  const norm = normalizePath(rawPath);
  const ext = path.extname(norm).toLowerCase();

  if (ext === '.py') return 'python';
  if (ext === '.java') return 'java';
  if (ext === '.ts' || ext === '.tsx') return 'typescript';
  if (['.js', '.jsx', '.mjs', '.cjs'].includes(ext)) return 'javascript';

  return 'unknown';
}
