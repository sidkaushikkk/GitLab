import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { dispatchAndParseFile } from '../../backend/src/services/intelligence/dispatcher.js';
import { extractRelationships } from '../../backend/src/services/intelligence/relationshipExtractor.js';
import { detectCodeSmells } from '../../backend/src/services/intelligence/codeSmells.js';
import { extractFeatures } from '../../backend/src/services/intelligence/featureExtractor.js';
import { isProductionSourceFile, isTestFile, detectLanguage } from '../../backend/src/services/intelligence/pathClassifier.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = resolve(__filename, '..');
const ROOT_DIR = resolve(__dirname, '../..');
const CACHE_DIR = resolve(ROOT_DIR, 'ml/repos_cache');
const DATA_DIR = resolve(ROOT_DIR, 'ml/data');

mkdirSync(CACHE_DIR, { recursive: true });
mkdirSync(DATA_DIR, { recursive: true });

const RANDOM_SEED = 42;
const MAX_NEGATIVE_SAMPLES_PER_PATH = 2;

// Seeded PRNG: Mulberry32
function mulberry32(a) {
  return function() {
    let t = a += 0x6D2B79F5;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function seededShuffle(array, prng) {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(prng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

const FEATURE_COLUMNS = [
  'lines',
  'function_count',
  'class_count',
  'import_count',
  'export_count',
  'avg_complexity',
  'max_complexity',
  'fan_in',
  'fan_out',
  'code_smell_count',
  'has_test'
];

const BUG_FIX_REGEX = /\b(fix(?:es|ed)?|bug(?:s)?|defect(?:s)?|patch(?:ed)?|resolve(?:s|d)?|issue)\s*#?\d+/i;
const CONVENTIONAL_FIX_REGEX = /^fix(\([^)]*\))?:/i;

export async function mineRepository(repoName, repoUrl, maxCommits = 400, rng) {
  const repoDir = join(CACHE_DIR, repoName);

  if (!existsSync(repoDir)) {
    console.log(`\n[Clone] Cloning ${repoName} from ${repoUrl} (depth: ${maxCommits})...`);
    execSync(`HOME=/tmp git clone --depth ${maxCommits} ${repoUrl} ${repoDir}`, {
      stdio: 'inherit',
      timeout: 180000
    });
  } else {
    console.log(`\n[Cache] Using existing cache for ${repoName} at ${repoDir}`);
  }

  // Get commit logs
  const logOutput = execSync(`HOME=/tmp git -C ${repoDir} log --pretty=format:"%H|%P|%s" -n ${maxCommits}`, {
    encoding: 'utf-8',
    maxBuffer: 50 * 1024 * 1024
  });

  const lines = logOutput.split('\n').filter(Boolean);
  console.log(`  Parsed ${lines.length} commits for ${repoName}`);

  const records = [];
  let bugFixCount = 0;
  let excludedTestCount = 0;

  // Track observed (file_path:blob_sha) to prevent exact duplicate file snapshot reuse
  const observedPositiveBlobs = new Set();
  const observedNegativeBlobs = new Set();
  const negativePathObservationCounts = new Map();

  // AST parsed cache indexed by blobSha to optimize full-snapshot parsing
  const astCache = new Map();

  for (const line of lines) {
    const parts = line.split('|');
    if (parts.length < 3) continue;
    const commitHash = parts[0].trim();
    const parents = parts[1].trim().split(/\s+/).filter(Boolean);
    const message = parts.slice(2).join('|').trim();

    // Only linear non-merge commits
    if (parents.length !== 1) continue;
    const parentHash = parents[0];

    const isBugFix = BUG_FIX_REGEX.test(message) || CONVENTIONAL_FIX_REGEX.test(message);
    if (!isBugFix) continue;

    // Diff between parent and fixing commit
    let diffOutput = '';
    try {
      diffOutput = execSync(`HOME=/tmp git -C ${repoDir} diff-tree --no-commit-id --name-status -r ${parentHash} ${commitHash}`, {
        encoding: 'utf-8'
      });
    } catch {
      continue;
    }

    const modifiedProductionFiles = [];
    for (const diffLine of diffOutput.split('\n').filter(Boolean)) {
      const [status, ...pathParts] = diffLine.split(/\s+/);
      const filePath = pathParts.join(' ');

      if (isTestFile(filePath)) {
        excludedTestCount++;
        continue;
      }

      if (status === 'M' && isProductionSourceFile(filePath)) {
        modifiedProductionFiles.push(filePath);
      }
    }

    // Skip commits with no source file modifications or large bulk refactors (>10 files)
    if (modifiedProductionFiles.length === 0 || modifiedProductionFiles.length > 10) {
      continue;
    }

    bugFixCount++;

    // Fetch full repository tree at parentHash (snapshot state immediately preceding the fix)
    let treeEntries = [];
    try {
      const treeOutput = execSync(`HOME=/tmp git -C ${repoDir} ls-tree -r ${parentHash}`, {
        encoding: 'utf-8',
        maxBuffer: 20 * 1024 * 1024
      });

      for (const tLine of treeOutput.split('\n').filter(Boolean)) {
        // Format: <mode> <type> <blobSha>\t<filePath>
        const tabParts = tLine.split('\t');
        if (tabParts.length < 2) continue;
        const metaParts = tabParts[0].split(/\s+/);
        if (metaParts.length < 3) continue;
        const [mode, type, blobSha] = metaParts;
        const filePath = tabParts.slice(1).join('\t');

        if (type === 'blob') {
          if (isTestFile(filePath)) {
            excludedTestCount++;
          } else if (isProductionSourceFile(filePath)) {
            treeEntries.push({ mode, blobSha, path: filePath });
          }
        }
      }
    } catch {
      continue;
    }

    if (treeEntries.length === 0) continue;

    const treePathSet = new Set(treeEntries.map(e => e.path));

    // Determine candidate clean files in this snapshot
    const cleanCandidates = treeEntries.filter(
      e => !modifiedProductionFiles.includes(e.path) &&
           (negativePathObservationCounts.get(e.path) || 0) < MAX_NEGATIVE_SAMPLES_PER_PATH &&
           !observedNegativeBlobs.has(`${e.path}:${e.blobSha}`)
    );

    // Shuffle clean candidates using seeded PRNG
    const shuffledClean = seededShuffle(cleanCandidates, rng);
    // Sample clean files up to number of modified files (max 2 per commit)
    const selectedCleanEntries = shuffledClean.slice(0, Math.min(modifiedProductionFiles.length, 2));

    // Target files for this commit observation:
    // Positives: modified production files present at parentHash
    const targetPositiveEntries = treeEntries.filter(e => modifiedProductionFiles.includes(e.path));
    const targetFilesToExtract = [];

    for (const posEntry of targetPositiveEntries) {
      const key = `${posEntry.path}:${posEntry.blobSha}`;
      if (!observedPositiveBlobs.has(key)) {
        observedPositiveBlobs.add(key);
        targetFilesToExtract.push({ entry: posEntry, label: 1 });
      }
    }

    for (const cleanEntry of selectedCleanEntries) {
      const key = `${cleanEntry.path}:${cleanEntry.blobSha}`;
      observedNegativeBlobs.add(key);
      const curCount = negativePathObservationCounts.get(cleanEntry.path) || 0;
      negativePathObservationCounts.set(cleanEntry.path, curCount + 1);
      targetFilesToExtract.push({ entry: cleanEntry, label: 0 });
    }

    if (targetFilesToExtract.length === 0) continue;

    // Build FULL REPOSITORY SNAPSHOT CONTEXT for graph & feature extraction
    const allParsedFiles = [];
    for (const entry of treeEntries) {
      if (astCache.has(entry.blobSha)) {
        const cached = astCache.get(entry.blobSha);
        allParsedFiles.push({ ...cached, filePath: entry.path });
      } else {
        let content = '';
        try {
          content = execSync(`HOME=/tmp git -C ${repoDir} cat-file -p ${entry.blobSha}`, {
            encoding: 'utf-8',
            maxBuffer: 10 * 1024 * 1024
          });
        } catch {
          continue;
        }

        const lang = detectLanguage(entry.path);
        const parsed = dispatchAndParseFile({ path: entry.path, content, language: lang });
        astCache.set(entry.blobSha, parsed);
        allParsedFiles.push({ ...parsed, filePath: entry.path });
      }
    }

    const allSymbols = [];
    for (const f of allParsedFiles) {
      for (const s of f.symbols) {
        allSymbols.push({ ...s });
      }
    }

    // Full snapshot relationship extraction (whole-snapshot fan-in and fan-out)
    const { relationships, graphMetrics } = extractRelationships(allParsedFiles, allSymbols);
    const codeSmells = detectCodeSmells(allParsedFiles, graphMetrics);
    const extractedFeatures = extractFeatures(allParsedFiles, allSymbols, graphMetrics, codeSmells);

    // Index extracted features by file path
    const featureMapByPath = new Map();
    for (const feat of extractedFeatures) {
      if (feat.entityType === 'file') {
        if (!featureMapByPath.has(feat.entityId)) {
          featureMapByPath.set(feat.entityId, {});
        }
        featureMapByPath.get(feat.entityId)[feat.featureName] = feat.featureValue;
      }
    }

    // Record verified observations
    for (const target of targetFilesToExtract) {
      const fMap = featureMapByPath.get(target.entry.path);
      if (fMap && Object.keys(fMap).length > 0) {
        records.push({
          repo: repoName,
          commit: parentHash,
          file_path: target.entry.path,
          language: detectLanguage(target.entry.path),
          has_defect: target.label,
          blob_sha: target.entry.blobSha,
          ...fMap
        });
      }
    }
  }

  const defects = records.filter(r => r.has_defect === 1).length;
  const nonDefects = records.filter(r => r.has_defect === 0).length;
  const uniqueFiles = new Set(records.map(r => r.file_path)).size;
  console.log(`  ✓ ${repoName}: Extracted ${records.length} observations (${defects} positive, ${nonDefects} negative, ${uniqueFiles} unique files). Excluded ${excludedTestCount} test/spec instances.`);

  return { records, excludedTestCount };
}

function saveToCsv(records, filePath) {
  const header = ['repo', 'commit', 'file_path', 'language', 'has_defect', ...FEATURE_COLUMNS].join(',');
  const rows = records.map(r => {
    const meta = [
      `"${r.repo}"`,
      `"${r.commit}"`,
      `"${r.file_path}"`,
      `"${r.language}"`,
      r.has_defect
    ];
    const feats = FEATURE_COLUMNS.map(col => r[col] !== undefined ? r[col] : 0);
    return [...meta, ...feats].join(',');
  });

  writeFileSync(filePath, [header, ...rows].join('\n'), 'utf-8');
  console.log(`  ✓ Saved ${records.length} records to ${filePath}`);
}

async function main() {
  console.log('='.repeat(75));
  console.log('  CHECKPOINT 7: SCIENTIFIC SZZ REBUILD — P0/P1 DATASET GENERATION');
  console.log('='.repeat(75));

  const prng = mulberry32(RANDOM_SEED);

  const TARGET_REPOS = [
    // JavaScript (Training)
    { name: 'express', url: 'https://github.com/expressjs/express.git', split: 'train' },
    { name: 'async', url: 'https://github.com/caolan/async.git', split: 'train' },
    { name: 'lodash', url: 'https://github.com/lodash/lodash.git', split: 'train' },

    // TypeScript (Training)
    { name: 'zod', url: 'https://github.com/colinhacks/zod.git', split: 'train' },
    { name: 'axios', url: 'https://github.com/axios/axios.git', split: 'train' },

    // Python (Training)
    { name: 'requests', url: 'https://github.com/psf/requests.git', split: 'train' },
    { name: 'flask', url: 'https://github.com/pallets/flask.git', split: 'train' },
    { name: 'bottle', url: 'https://github.com/bottlepy/bottle.git', split: 'train' },

    // Java (Training)
    { name: 'gson', url: 'https://github.com/google/gson.git', split: 'train' },

    // Validation Split (Project-Disjoint)
    { name: 'chalk', url: 'https://github.com/chalk/chalk.git', split: 'val' },
    { name: 'click', url: 'https://github.com/pallets/click.git', split: 'val' },

    // Holdout Test Split (Project-Disjoint)
    { name: 'validator', url: 'https://github.com/validatorjs/validator.js.git', split: 'test' }
  ];

  const allRecords = [];
  const splits = { train: [], val: [], test: [] };
  let totalExcludedTests = 0;
  const perProjectStats = {};

  for (const repo of TARGET_REPOS) {
    try {
      const { records, excludedTestCount } = await mineRepository(repo.name, repo.url, 400, prng);
      totalExcludedTests += excludedTestCount;
      allRecords.push(...records);
      splits[repo.split].push(...records);

      const pos = records.filter(r => r.has_defect === 1).length;
      const neg = records.filter(r => r.has_defect === 0).length;
      perProjectStats[repo.name] = {
        split: repo.split,
        total: records.length,
        positive: pos,
        negative: neg,
        positive_rate: records.length > 0 ? Number((pos / records.length * 100).toFixed(2)) : 0,
        unique_files: new Set(records.map(r => r.file_path)).size,
        unique_file_commit_triples: new Set(records.map(r => `${r.repo}::${r.file_path}::${r.commit}`)).size
      };
    } catch (err) {
      console.error(`  ✗ Error mining ${repo.name}:`, err.message);
    }
  }

  // Calculate unique identity statistics
  const uniqueFileSet = new Set(allRecords.map(r => `${r.repo}::${r.file_path}`));
  const uniqueFileCommitSet = new Set(allRecords.map(r => `${r.repo}::${r.file_path}::${r.commit}`));

  console.log('\n' + '='.repeat(75));
  console.log('  DATASET GENERATION SUMMARY:');
  console.log('='.repeat(75));
  console.log(`  Total Observations:                 ${allRecords.length}`);
  console.log(`  Unique (Repo + File) Identities:    ${uniqueFileSet.size}`);
  console.log(`  Unique (Repo+File+Commit) Triples:  ${uniqueFileCommitSet.size}`);
  console.log(`  Total Excluded Test/Spec Files:     ${totalExcludedTests}`);
  console.log(`  Overall Positive Rate:              ${(allRecords.filter(r => r.has_defect === 1).length / allRecords.length * 100).toFixed(2)}%`);
  console.log(`  Train Set:                          ${splits.train.length} observations`);
  console.log(`  Validation Set:                     ${splits.val.length} observations`);
  console.log(`  Holdout Test Set:                   ${splits.test.length} observations`);

  // Save CSV partitions
  saveToCsv(allRecords, join(DATA_DIR, 'cp7_file_defects_raw.csv'));
  saveToCsv(splits.train, join(DATA_DIR, 'cp7_train.csv'));
  saveToCsv(splits.val, join(DATA_DIR, 'cp7_val.csv'));
  saveToCsv(splits.test, join(DATA_DIR, 'cp7_test.csv'));

  // Save Dataset Manifest
  const manifest = {
    dataset_version: 'cp7_file_v2.0',
    generation_timestamp: new Date().toISOString(),
    random_seed: RANDOM_SEED,
    szz_methodology: 'Pre-Fix Snapshot Target Labeling (C_fix^)',
    negative_sampling_policy: 'Randomized seeded reservoir without replacement; max 2 snapshots per file path',
    total_observations: allRecords.length,
    unique_file_identities: uniqueFileSet.size,
    unique_file_commit_triples: uniqueFileCommitSet.size,
    total_excluded_tests: totalExcludedTests,
    class_distribution: {
      total: allRecords.length,
      positive: allRecords.filter(r => r.has_defect === 1).length,
      negative: allRecords.filter(r => r.has_defect === 0).length,
      positive_rate_percent: Number((allRecords.filter(r => r.has_defect === 1).length / allRecords.length * 100).toFixed(2))
    },
    split_definitions: {
      train_projects: TARGET_REPOS.filter(r => r.split === 'train').map(r => r.name),
      val_projects: TARGET_REPOS.filter(r => r.split === 'val').map(r => r.name),
      holdout_test_projects: TARGET_REPOS.filter(r => r.split === 'test').map(r => r.name)
    },
    per_project_statistics: perProjectStats,
    feature_schema_version: '1.0',
    features: FEATURE_COLUMNS
  };

  const manifestPath = join(DATA_DIR, 'dataset_manifest.json');
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');
  console.log(`  ✓ Saved dataset manifest: ${manifestPath}`);

  console.log('\n' + '='.repeat(75));
  console.log('>>> REBUILT CP7 DATASET READY FOR CALIBRATED RETRAINING <<<');
  console.log('='.repeat(75));
}

main().catch(err => {
  console.error('Fatal error in mining pipeline:', err);
  process.exit(1);
});
