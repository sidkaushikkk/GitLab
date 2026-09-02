import path from 'node:path';

// Directories to completely exclude from repository ingestion
const EXCLUDED_DIRS = new Set([
  '.git',
  '.github',
  'node_modules',
  'vendor',
  'dist',
  'build',
  'coverage',
  '.next',
  '.nuxt',
  'target',
  '.turbo',
  'out',
  'bin',
  'obj',
  '.cache',
  'tmp',
  'temp',
  '.idea',
  '.vscode',
  'venv',
  '.venv',
  'env',
  '.env',
  '__pycache__',
  '.pytest_cache',
  '.mypy_cache',
  '.tox'
]);

// Binary, media, archive, and compiled artifact extensions to exclude
const EXCLUDED_EXTENSIONS = new Set([
  // Images & Icons
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.svg', '.bmp', '.tiff', '.tif', '.psd', '.ai',
  // Audio & Video
  '.mp4', '.mov', '.avi', '.mkv', '.webm', '.flv', '.wmv', '.mp3', '.wav', '.flac', '.ogg', '.aac', '.m4a',
  // Archives & Compressed
  '.zip', '.tar', '.gz', '.tgz', '.7z', '.rar', '.bz2', '.xz', '.zst',
  // Documents & Binaries
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
  '.exe', '.dmg', '.iso', '.bin', '.dll', '.so', '.dylib', '.class', '.jar', '.war', '.ear',
  '.pyc', '.pyo', '.pyd', '.wasm',
  // Fonts
  '.woff', '.woff2', '.ttf', '.eot', '.otf',
  // Bundles & Source Maps
  '.map'
]);

// Special filenames
const SPECIAL_FILES = {
  'dockerfile': { language: 'docker', type: 'config' },
  'docker-compose.yml': { language: 'yaml', type: 'config' },
  'docker-compose.yaml': { language: 'yaml', type: 'config' },
  'makefile': { language: 'makefile', type: 'config' },
  'cmakelists.txt': { language: 'cmake', type: 'config' },
  'package.json': { language: 'json', type: 'config' },
  'package-lock.json': { language: 'json', type: 'config' },
  'requirements.txt': { language: 'text', type: 'config' },
  'pyproject.toml': { language: 'toml', type: 'config' },
  'cargo.toml': { language: 'toml', type: 'config' },
  'cargo.lock': { language: 'toml', type: 'config' },
  'go.mod': { language: 'go-mod', type: 'config' },
  'go.sum': { language: 'go-sum', type: 'config' },
  'pom.xml': { language: 'xml', type: 'config' },
  'build.gradle': { language: 'groovy', type: 'config' },
  'gemfile': { language: 'ruby', type: 'config' },
  'composer.json': { language: 'json', type: 'config' },
  '.env.example': { language: 'text', type: 'config' },
  '.env.sample': { language: 'text', type: 'config' }
};

// Extension to language & type mapping
const EXTENSION_MAP = {
  // JavaScript / TypeScript
  '.js': { language: 'javascript', type: 'source' },
  '.jsx': { language: 'javascript', type: 'source' },
  '.mjs': { language: 'javascript', type: 'source' },
  '.cjs': { language: 'javascript', type: 'source' },
  '.ts': { language: 'typescript', type: 'source' },
  '.tsx': { language: 'typescript', type: 'source' },
  '.mts': { language: 'typescript', type: 'source' },
  '.cts': { language: 'typescript', type: 'source' },

  // Python
  '.py': { language: 'python', type: 'source' },
  '.pyw': { language: 'python', type: 'source' },

  // Java / JVM
  '.java': { language: 'java', type: 'source' },
  '.kt': { language: 'kotlin', type: 'source' },
  '.kts': { language: 'kotlin', type: 'source' },
  '.scala': { language: 'scala', type: 'source' },
  '.groovy': { language: 'groovy', type: 'source' },

  // Go & Rust
  '.go': { language: 'go', type: 'source' },
  '.rs': { language: 'rust', type: 'source' },

  // C / C++
  '.c': { language: 'c', type: 'source' },
  '.h': { language: 'c', type: 'source' },
  '.cc': { language: 'cpp', type: 'source' },
  '.cpp': { language: 'cpp', type: 'source' },
  '.cxx': { language: 'cpp', type: 'source' },
  '.hpp': { language: 'cpp', type: 'source' },
  '.hh': { language: 'cpp', type: 'source' },
  '.hxx': { language: 'cpp', type: 'source' },

  // PHP, Ruby, C#, Swift
  '.php': { language: 'php', type: 'source' },
  '.phtml': { language: 'php', type: 'source' },
  '.rb': { language: 'ruby', type: 'source' },
  '.erb': { language: 'ruby', type: 'source' },
  '.cs': { language: 'csharp', type: 'source' },
  '.swift': { language: 'swift', type: 'source' },

  // Shell scripts
  '.sh': { language: 'shell', type: 'script' },
  '.bash': { language: 'shell', type: 'script' },
  '.zsh': { language: 'shell', type: 'script' },

  // Web markup & styling
  '.html': { language: 'html', type: 'markup' },
  '.htm': { language: 'html', type: 'markup' },
  '.css': { language: 'css', type: 'style' },
  '.scss': { language: 'scss', type: 'style' },
  '.sass': { language: 'sass', type: 'style' },
  '.less': { language: 'less', type: 'style' },
  '.vue': { language: 'vue', type: 'source' },
  '.svelte': { language: 'svelte', type: 'source' },

  // Query & Data / Config
  '.sql': { language: 'sql', type: 'query' },
  '.graphql': { language: 'graphql', type: 'schema' },
  '.gql': { language: 'graphql', type: 'schema' },
  '.proto': { language: 'protobuf', type: 'schema' },
  '.json': { language: 'json', type: 'config' },
  '.yaml': { language: 'yaml', type: 'config' },
  '.yml': { language: 'yaml', type: 'config' },
  '.toml': { language: 'toml', type: 'config' },
  '.xml': { language: 'xml', type: 'config' },
  '.ini': { language: 'ini', type: 'config' },

  // Documentation
  '.md': { language: 'markdown', type: 'documentation' },
  '.markdown': { language: 'markdown', type: 'documentation' },
  '.rst': { language: 'rst', type: 'documentation' },
  '.txt': { language: 'text', type: 'documentation' }
};

/**
 * Determines whether a repository file should be included in the normalized snapshot
 * @param {string} filePath - Relative path of the file in the repository
 * @param {number} [fileSize=0] - File size in bytes
 * @param {number} [maxSizeBytes=1000000] - Maximum allowed file size in bytes
 * @returns {Object} Inspection result with include decision, reason, language, and type
 */
export function shouldIncludeFile(filePath, fileSize = 0, maxSizeBytes = 1000000) {
  if (!filePath || typeof filePath !== 'string') {
    return { include: false, reason: 'invalid_path' };
  }

  // Normalize path separators
  const normalizedPath = filePath.replace(/\\/g, '/');
  const pathParts = normalizedPath.split('/');
  const fileName = pathParts[pathParts.length - 1];
  const lowerFileName = fileName.toLowerCase();

  // 1. Check excluded directory components
  for (let i = 0; i < pathParts.length - 1; i++) {
    const dir = pathParts[i].toLowerCase();
    if (EXCLUDED_DIRS.has(dir) || dir.startsWith('.')) {
      return { include: false, reason: 'excluded_directory', path: normalizedPath };
    }
  }

  // Check hidden files or dotfiles (except recognized config files like .env.example)
  if (fileName.startsWith('.') && !SPECIAL_FILES[lowerFileName]) {
    return { include: false, reason: 'excluded_dotfile', path: normalizedPath };
  }

  // 2. Check minified bundles
  if (lowerFileName.endsWith('.min.js') || lowerFileName.endsWith('.min.css') || lowerFileName.endsWith('.bundle.js')) {
    return { include: false, reason: 'excluded_minified_bundle', path: normalizedPath };
  }

  // 3. Check excluded extensions (binaries, media, archives)
  const ext = path.extname(lowerFileName);
  if (EXCLUDED_EXTENSIONS.has(ext)) {
    return { include: false, reason: 'excluded_binary_or_media', path: normalizedPath };
  }

  // 4. Check file size limits
  if (fileSize > maxSizeBytes) {
    return {
      include: false,
      reason: 'file_too_large',
      path: normalizedPath,
      size: fileSize,
      maxSize: maxSizeBytes
    };
  }

  // 5. Check special files
  if (SPECIAL_FILES[lowerFileName]) {
    return {
      include: true,
      path: normalizedPath,
      language: SPECIAL_FILES[lowerFileName].language,
      type: SPECIAL_FILES[lowerFileName].type
    };
  }

  // 6. Check extension mapping
  if (EXTENSION_MAP[ext]) {
    return {
      include: true,
      path: normalizedPath,
      language: EXTENSION_MAP[ext].language,
      type: EXTENSION_MAP[ext].type
    };
  }

  // Default: unmapped or unknown file types are skipped
  return {
    include: false,
    reason: 'unsupported_extension',
    path: normalizedPath
  };
}
