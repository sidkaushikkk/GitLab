/**
 * Deterministic parser for package manifests across ecosystems (npm, pypi, maven)
 */

/**
 * Parses package.json content
 * @param {string} filePath - Path of the file
 * @param {string} content - JSON string content
 * @returns {Object} Extracted dependency list and metadata
 */
export function parsePackageJson(filePath, content) {
  try {
    const pkg = JSON.parse(content || '{}');
    const dependencies = [];

    if (pkg.dependencies && typeof pkg.dependencies === 'object') {
      for (const [name, version] of Object.entries(pkg.dependencies)) {
        dependencies.push({
          name,
          version: String(version),
          type: 'direct',
          ecosystem: 'npm',
          manifestPath: filePath
        });
      }
    }

    if (pkg.devDependencies && typeof pkg.devDependencies === 'object') {
      for (const [name, version] of Object.entries(pkg.devDependencies)) {
        dependencies.push({
          name,
          version: String(version),
          type: 'development',
          ecosystem: 'npm',
          manifestPath: filePath
        });
      }
    }

    if (pkg.peerDependencies && typeof pkg.peerDependencies === 'object') {
      for (const [name, version] of Object.entries(pkg.peerDependencies)) {
        dependencies.push({
          name,
          version: String(version),
          type: 'peer',
          ecosystem: 'npm',
          manifestPath: filePath
        });
      }
    }

    return {
      manifestPath: filePath,
      ecosystem: 'npm',
      packageName: pkg.name || null,
      version: pkg.version || null,
      license: pkg.license || null,
      dependenciesCount: dependencies.length,
      dependencies
    };
  } catch (err) {
    return {
      manifestPath: filePath,
      ecosystem: 'npm',
      error: `Failed to parse package.json: ${err.message}`,
      dependenciesCount: 0,
      dependencies: []
    };
  }
}

/**
 * Parses requirements.txt content
 * @param {string} filePath - Path of requirements.txt
 * @param {string} content - File content
 * @returns {Object} Extracted dependency list
 */
export function parseRequirementsTxt(filePath, content) {
  const lines = (content || '').split('\n');
  const dependencies = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('-r') || trimmed.startsWith('-i')) {
      continue;
    }

    // Match package name and version specifier (e.g. requests>=2.25.1 or flask==2.0.1)
    const match = trimmed.match(/^([a-zA-Z0-9_\-\.]+)\s*([><=!~^].*)?$/);
    if (match) {
      dependencies.push({
        name: match[1],
        version: match[2] ? match[2].trim() : '*',
        type: 'direct',
        ecosystem: 'pypi',
        manifestPath: filePath
      });
    }
  }

  return {
    manifestPath: filePath,
    ecosystem: 'pypi',
    dependenciesCount: dependencies.length,
    dependencies
  };
}

/**
 * Parses pom.xml or build.gradle content for Java dependencies
 * @param {string} filePath - Path of pom.xml / build.gradle
 * @param {string} content - File content
 * @returns {Object} Extracted dependency list
 */
export function parseJavaManifest(filePath, content) {
  const dependencies = [];
  const text = content || '';

  if (filePath.endsWith('pom.xml')) {
    // Regex-based extraction of <dependency> blocks without heavy XML parser
    const depRegex = /<dependency>[\s\S]*?<groupId>(.*?)<\/groupId>[\s\S]*?<artifactId>(.*?)<\/artifactId>(?:[\s\S]*?<version>(.*?)<\/version>)?(?:[\s\S]*?<scope>(.*?)<\/scope>)?[\s\S]*?<\/dependency>/g;
    let match;
    while ((match = depRegex.exec(text)) !== null) {
      const groupId = match[1]?.trim();
      const artifactId = match[2]?.trim();
      const version = match[3]?.trim() || '*';
      const scope = match[4]?.trim() || 'compile';

      if (groupId && artifactId) {
        dependencies.push({
          name: `${groupId}:${artifactId}`,
          version,
          type: scope === 'test' ? 'test' : 'direct',
          ecosystem: 'maven',
          manifestPath: filePath
        });
      }
    }
  } else if (filePath.endsWith('.gradle') || filePath.endsWith('.gradle.kts')) {
    // Gradle implementation 'com.google.code.gson:gson:2.8.9'
    const gradleRegex = /(?:implementation|api|testImplementation)\s+['"]([^'"]+):([^'"]+):([^'"]+)['"]/g;
    let match;
    while ((match = gradleRegex.exec(text)) !== null) {
      dependencies.push({
        name: `${match[1]}:${match[2]}`,
        version: match[3],
        type: 'direct',
        ecosystem: 'gradle',
        manifestPath: filePath
      });
    }
  }

  return {
    manifestPath: filePath,
    ecosystem: filePath.endsWith('pom.xml') ? 'maven' : 'gradle',
    dependenciesCount: dependencies.length,
    dependencies
  };
}

/**
 * Dispatches manifest files to their respective parser
 * @param {Object} file - File object { path, content }
 * @returns {Object|null} Parsed manifest result or null if not a manifest
 */
export function parseManifestFile(file) {
  const { path: filePath, content } = file;
  const lowerPath = (filePath || '').toLowerCase();

  if (lowerPath.endsWith('package.json') && !lowerPath.includes('node_modules')) {
    return parsePackageJson(filePath, content);
  }

  if ((lowerPath.endsWith('requirements.txt') || lowerPath.endsWith('requirements-dev.txt')) && !lowerPath.includes('site-packages')) {
    return parseRequirementsTxt(filePath, content);
  }

  if (lowerPath.endsWith('pom.xml') || lowerPath.endsWith('build.gradle') || lowerPath.endsWith('build.gradle.kts')) {
    return parseJavaManifest(filePath, content);
  }

  return null;
}
