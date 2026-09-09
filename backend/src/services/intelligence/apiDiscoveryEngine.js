import path from 'node:path';
import * as babelParser from '@babel/parser';
import _traverse from '@babel/traverse';
import { pool } from '../../db/pool.js';
import { logger } from '../../utils/logger.js';

// ESM compatibility for @babel/traverse
const traverse = _traverse.default || _traverse;

/**
 * Known authentication middleware names across modern Node.js and Express frameworks
 */
const AUTH_MIDDLEWARE_NAMES = new Set([
  'requireauth',
  'verifytoken',
  'authenticate',
  'isauthenticated',
  'auth',
  'checkauth',
  'protect',
  'jwtauth',
  'ensureauthenticated',
  'requirelogin',
  'tokenauth',
  'verifyjwt',
  'validatetoken'
]);

/**
 * Known authorization / role checking middleware names
 */
const AUTHZ_MIDDLEWARE_NAMES = new Set([
  'requireadmin',
  'requirerole',
  'authorize',
  'haspermission',
  'verifyownership',
  'checkownership',
  'adminonly',
  'checkrole',
  'checkpermissions'
]);

/**
 * Public routes that do not require authentication by design
 */
const PUBLIC_ROUTE_PATTERNS = [
  /^\/health(?:\/.*)?$/,
  /^\/api\/health(?:\/.*)?$/,
  /^\/api\/auth\/(?:login|google|register|signup|callback|csrf|token)$/,
  /^\/api\/webhooks(?:\/.*)?$/,
  /^\/api\/docs(?:\/.*)?$/,
  /^\/favicon\.ico$/,
  /^\/public(?:\/.*)?$/
];

/**
 * Parse JavaScript/TypeScript content with Babel
 * @param {string} content
 * @returns {Object|null} AST or null on parse failure
 */
function safeParseBabel(content) {
  try {
    return babelParser.parse(content || '', {
      sourceType: 'unambiguous',
      plugins: [
        'jsx',
        'typescript',
        'asyncGenerators',
        'classProperties',
        'classPrivateProperties',
        'classPrivateMethods',
        'decorators-legacy',
        'dynamicImport',
        'exportDefaultFrom',
        'exportNamespaceFrom',
        'nullishCoalescingOperator',
        'optionalChaining',
        'topLevelAwait'
      ],
      tokens: true,
      errorRecovery: true
    });
  } catch {
    return null;
  }
}

/**
 * Normalizes route path by prepending slash, removing duplicate slashes,
 * and stripping trailing slash (unless root).
 * @param {string} prefix
 * @param {string} routePath
 * @returns {string} Normalized path
 */
export function normalizeRoutePath(prefix = '', routePath = '') {
  let combined = (prefix || '') + '/' + (routePath || '');
  // Clean double slashes
  combined = combined.replace(/\/+/g, '/');
  // Strip trailing slash if longer than 1 char
  if (combined.length > 1 && combined.endsWith('/')) {
    combined = combined.slice(0, -1);
  }
  if (!combined.startsWith('/')) {
    combined = '/' + combined;
  }
  return combined;
}

/**
 * Checks if a route path is intended to be public
 * @param {string} routePath
 * @returns {boolean}
 */
export function isPublicRoute(routePath) {
  return PUBLIC_ROUTE_PATTERNS.some(pattern => pattern.test(routePath));
}

/**
 * Extracts literal string value from an AST node if possible
 * @param {Object} node
 * @returns {string|null}
 */
function extractStringValue(node) {
  if (!node) return null;
  if (node.type === 'StringLiteral') return node.value;
  if (node.type === 'TemplateLiteral' && node.quasis?.length === 1 && node.expressions?.length === 0) {
    return node.quasis[0].value.raw;
  }
  if (node.type === 'BinaryExpression' && node.operator === '+') {
    const left = extractStringValue(node.left);
    const right = extractStringValue(node.right);
    if (left !== null && right !== null) return left + right;
  }
  return null;
}

/**
 * Resolves a module specifier against current file path
 * @param {string} currentFilePath
 * @param {string} importSpecifier
 * @param {Set<string>} existingFilePaths
 * @returns {string|null}
 */
function resolveModulePath(currentFilePath, importSpecifier, existingFilePaths) {
  if (!importSpecifier.startsWith('.')) {
    return null;
  }
  const currentDir = path.dirname(currentFilePath);
  const candidate = path.normalize(path.join(currentDir, importSpecifier)).replace(/\\/g, '/');
  if (existingFilePaths.has(candidate)) return candidate;

  for (const ext of ['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '/index.js', '/index.ts']) {
    const withExt = candidate + ext;
    if (existingFilePaths.has(withExt)) return withExt;
  }
  return candidate;
}

/**
 * Performs comprehensive AST scanning across all snapshot files to discover HTTP endpoints
 * @param {Array<Object>} files - Array of { path, content, language }
 * @returns {Array<Object>} Discovered raw endpoints
 */
export function discoverEndpointsFromFiles(files = []) {
  const existingFilePaths = new Set(files.map(f => f.path));
  const fileAstMap = new Map();

  // 1. Parse all JS/TS files
  for (const file of files) {
    const ext = path.extname(file.path).toLowerCase();
    if (['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs'].includes(ext) || file.language === 'javascript' || file.language === 'typescript') {
      const ast = safeParseBabel(file.content);
      if (ast) {
        fileAstMap.set(file.path, { ast, file });
      }
    }
  }

  // 2. Map router imports and mounts across files
  // mountPrefixes: targetFilePath -> Set of mountPrefix strings
  const mountPrefixes = new Map();
  // routerImports: sourceFilePath -> Map(localIdentifier -> targetFilePath)
  const routerImports = new Map();

  for (const [filePath, { ast }] of fileAstMap.entries()) {
    const importMap = new Map();

    traverse(ast, {
      ImportDeclaration(p) {
        const specifier = p.node.source?.value;
        if (!specifier) return;
        const resolved = resolveModulePath(filePath, specifier, existingFilePaths);
        if (!resolved) return;

        for (const s of p.node.specifiers) {
          importMap.set(s.local.name, resolved);
        }
      },
      VariableDeclarator(p) {
        // CommonJS require: const authRoutes = require('./routes/auth.js')
        if (p.node.init?.type === 'CallExpression' && p.node.init.callee?.name === 'require') {
          const arg = p.node.init.arguments?.[0];
          const specifier = extractStringValue(arg);
          if (specifier) {
            const resolved = resolveModulePath(filePath, specifier, existingFilePaths);
            if (resolved && p.node.id?.name) {
              importMap.set(p.node.id.name, resolved);
            }
          }
        }
      }
    });

    routerImports.set(filePath, importMap);
  }

  // 3. Discover app.use('/prefix', routerInstance) mount calls
  for (const [filePath, { ast }] of fileAstMap.entries()) {
    const importMap = routerImports.get(filePath) || new Map();

    traverse(ast, {
      CallExpression(p) {
        const callee = p.node.callee;
        if (callee?.type === 'MemberExpression' && callee.property?.name === 'use') {
          const args = p.node.arguments;
          if (args.length >= 2) {
            const prefixVal = extractStringValue(args[0]);
            const targetArg = args[1];
            const targetName = targetArg?.name;

            if (prefixVal !== null && targetName && importMap.has(targetName)) {
              const targetFile = importMap.get(targetName);
              if (!mountPrefixes.has(targetFile)) {
                mountPrefixes.set(targetFile, new Set());
              }
              mountPrefixes.get(targetFile).add(prefixVal);
            }
          } else if (args.length === 1) {
            // e.g. app.use(healthRouter)
            const targetArg = args[0];
            const targetName = targetArg?.name;
            if (targetName && importMap.has(targetName)) {
              const targetFile = importMap.get(targetName);
              if (!mountPrefixes.has(targetFile)) {
                mountPrefixes.set(targetFile, new Set());
              }
              mountPrefixes.get(targetFile).add('');
            }
          }
        }
      }
    });
  }

  // 4. Extract routes from each file
  const HTTP_METHODS = new Set(['get', 'post', 'put', 'delete', 'patch', 'options', 'head', 'all']);
  const discoveredEndpoints = [];
  const endpointKeysSeen = new Set();

  for (const [filePath, { ast }] of fileAstMap.entries()) {
    // Router-level middleware in this file: e.g. router.use(verifyToken)
    const fileRouterMiddleware = [];

    // Find router-level middleware calls first
    traverse(ast, {
      CallExpression(p) {
        const callee = p.node.callee;
        if (callee?.type === 'MemberExpression' && callee.property?.name === 'use') {
          // If first argument is NOT a string literal or route path, it is router-level middleware
          const firstArg = p.node.arguments[0];
          const isPath = extractStringValue(firstArg) !== null;
          if (!isPath && p.node.arguments.length > 0) {
            for (const arg of p.node.arguments) {
              const mwName = arg?.name || arg?.property?.name || (arg?.callee?.name ? `${arg.callee.name}()` : null);
              if (mwName) {
                fileRouterMiddleware.push(mwName);
              }
            }
          }
        }
      }
    });

    // Check mount prefixes assigned to this file; if none, default to empty prefix
    const prefixes = mountPrefixes.has(filePath) ? Array.from(mountPrefixes.get(filePath)) : [''];

    traverse(ast, {
      CallExpression(p) {
        const callee = p.node.callee;
        if (callee?.type !== 'MemberExpression') return;

        const methodName = (callee.property?.name || '').toLowerCase();
        if (!HTTP_METHODS.has(methodName)) return;

        const routerVarName = callee.object?.name || 'app';
        const args = p.node.arguments;
        if (args.length === 0) return;

        // First argument is usually the route path
        const rawPath = extractStringValue(args[0]);
        if (rawPath === null) return; // Non-static route or dynamic expression

        // Subsequent arguments are middleware + handler
        const handlerArgs = args.slice(1);
        const routeMiddleware = [];
        let handlerNode = null;
        let handlerName = 'anonymous';

        if (handlerArgs.length > 0) {
          const lastArg = handlerArgs[handlerArgs.length - 1];
          if (['ArrowFunctionExpression', 'FunctionExpression'].includes(lastArg?.type)) {
            handlerNode = lastArg;
            handlerName = lastArg.id?.name || 'anonymousHandler';
          } else if (lastArg?.type === 'Identifier') {
            handlerName = lastArg.name;
          } else if (lastArg?.type === 'MemberExpression') {
            handlerName = `${lastArg.object?.name || 'obj'}.${lastArg.property?.name || 'method'}`;
          }

          // Middleware are arguments preceding the handler
          for (let i = 0; i < handlerArgs.length - 1; i++) {
            const mwArg = handlerArgs[i];
            const mwName = mwArg?.name || mwArg?.property?.name || (mwArg?.callee?.name ? `${mwArg.callee.name}()` : 'middleware');
            routeMiddleware.push(mwName);
          }
        }

        const sourceLine = p.node.loc?.start?.line || 1;
        const upperMethod = methodName === 'all' ? 'ALL' : methodName.toUpperCase();

        // Register route under all active mount prefixes
        for (const prefix of prefixes) {
          const normalizedPath = normalizeRoutePath(prefix, rawPath);
          const canonicalKey = `${upperMethod} ${normalizedPath}`;

          if (endpointKeysSeen.has(canonicalKey)) {
            continue; // Prevent duplicate counting of duplicate registrations
          }
          endpointKeysSeen.add(canonicalKey);

          // Full middleware chain: router-level middleware + route-level middleware
          const fullMiddleware = [...fileRouterMiddleware, ...routeMiddleware];

          // Determine authentication and authorization coverage
          const authMiddleware = [];
          let hasAuth = false;
          let hasAuthz = false;

          for (const mw of fullMiddleware) {
            const lowerMw = mw.toLowerCase().replace(/\(\)$/, '');
            if (AUTH_MIDDLEWARE_NAMES.has(lowerMw)) {
              hasAuth = true;
              authMiddleware.push(mw);
            }
            if (AUTHZ_MIDDLEWARE_NAMES.has(lowerMw)) {
              hasAuthz = true;
            }
          }

          // Extract contract details from handler AST if available
          const contract = extractContractFromHandler(handlerNode, normalizedPath, filePath, fileAstMap, handlerName);

          discoveredEndpoints.push({
            method: upperMethod,
            routePath: normalizedPath,
            sourceFile: filePath,
            sourceLine,
            routerName: routerVarName,
            handlerName,
            isAuthenticated: hasAuth,
            hasAuthorization: hasAuthz,
            authMiddleware,
            middlewareChain: fullMiddleware,
            handlerNode,
            contract
          });
        }
      }
    });
  }

  return discoveredEndpoints;
}

/**
 * Extracts request/response contract details from handler AST node or resolved controller
 * @param {Object|null} handlerNode
 * @param {string} routePath
 * @param {string} sourceFile
 * @param {Map} fileAstMap
 * @param {string} handlerName
 * @returns {Object} Contract details
 */
export function extractContractFromHandler(handlerNode, routePath, sourceFile, fileAstMap, handlerName) {
  const parameters = [];
  const requestBody = { fields: [], contentType: 'application/json' };
  const responseStatusCodes = new Set();
  const responseShapes = [];
  const downstreamCalls = [];
  let isAsync = false;
  let hasTryCatch = false;
  let hasDatabaseCalls = false;
  let hasExternalCalls = false;
  let unvalidatedParams = [];

  // 1. Path parameters from route path syntax (/repositories/:id)
  const pathParamMatches = routePath.match(/:([a-zA-Z0-9_]+)/g) || [];
  for (const m of pathParamMatches) {
    const paramName = m.slice(1);
    parameters.push({
      name: paramName,
      in: 'path',
      required: true,
      type: 'string'
    });
  }

  // If handler is an imported function, try to locate its definition in controller files
  let targetAstNode = handlerNode;
  if (!targetAstNode && handlerName && handlerName !== 'anonymous') {
    for (const [, { ast }] of fileAstMap.entries()) {
      traverse(ast, {
        FunctionDeclaration(p) {
          if (p.node.id?.name === handlerName) {
            targetAstNode = p.node;
          }
        },
        VariableDeclarator(p) {
          if (p.node.id?.name === handlerName && ['ArrowFunctionExpression', 'FunctionExpression'].includes(p.node.init?.type)) {
            targetAstNode = p.node.init;
          }
        }
      });
      if (targetAstNode) break;
    }
  }

  if (targetAstNode) {
    isAsync = !!targetAstNode.async;

    // Traverse the handler body to detect params, query, body, responses, and calls
    traverse(targetAstNode, {
      noScope: true,

      TryStatement() {
        hasTryCatch = true;
      },

      MemberExpression(p) {
        const objName = p.node.object?.name;
        const propName = p.node.property?.name;

        // Query params: req.query.page
        if (objName === 'req' && propName === 'query' && p.parent?.type === 'MemberExpression') {
          const qName = p.parent.property?.name;
          if (qName && !parameters.some(param => param.name === qName && param.in === 'query')) {
            parameters.push({ name: qName, in: 'query', required: false, type: 'string' });
          }
        }

        // Body fields: req.body.title
        if (objName === 'req' && propName === 'body' && p.parent?.type === 'MemberExpression') {
          const bName = p.parent.property?.name;
          if (bName && !requestBody.fields.includes(bName)) {
            requestBody.fields.push(bName);
          }
        }
      },

      VariableDeclarator(p) {
        // Destructuring req.params: const { id } = req.params
        if (p.node.init?.type === 'MemberExpression' && p.node.init.object?.name === 'req') {
          const prop = p.node.init.property?.name;
          if (prop === 'params' && p.node.id?.type === 'ObjectPattern') {
            for (const propNode of p.node.id.properties) {
              const pName = propNode.key?.name;
              if (pName && !parameters.some(param => param.name === pName && param.in === 'path')) {
                parameters.push({ name: pName, in: 'path', required: true, type: 'string' });
              }
            }
          }
          // Destructuring req.query: const { page, perPage } = req.query
          if (prop === 'query' && p.node.id?.type === 'ObjectPattern') {
            for (const propNode of p.node.id.properties) {
              const qName = propNode.key?.name;
              if (qName && !parameters.some(param => param.name === qName && param.in === 'query')) {
                parameters.push({ name: qName, in: 'query', required: false, type: 'string' });
              }
            }
          }
          // Destructuring req.body: const { credential, email } = req.body
          if (prop === 'body' && p.node.id?.type === 'ObjectPattern') {
            for (const propNode of p.node.id.properties) {
              const bName = propNode.key?.name;
              if (bName && !requestBody.fields.includes(bName)) {
                requestBody.fields.push(bName);
              }
            }
          }
        }
      },

      CallExpression(p) {
        const callee = p.node.callee;
        const calleeName = callee?.name || callee?.property?.name || '';

        // Response status codes: res.status(200), res.sendStatus(403)
        if (callee?.type === 'MemberExpression' && ['status', 'sendStatus'].includes(callee.property?.name)) {
          const firstArg = p.node.arguments[0];
          if (firstArg?.type === 'NumericLiteral') {
            responseStatusCodes.add(firstArg.value);
          }
        }

        // res.json({ ... }), res.send(...)
        if (callee?.type === 'MemberExpression' && ['json', 'send'].includes(callee.property?.name)) {
          // If no preceding status code was called, default Express status is 200
          if (responseStatusCodes.size === 0) {
            responseStatusCodes.add(200);
          }

          // Extract response shape keys if object literal passed
          const arg = p.node.arguments[0];
          if (arg?.type === 'ObjectExpression') {
            const keys = arg.properties.map(prop => prop.key?.name).filter(Boolean);
            if (keys.length > 0 && !responseShapes.some(s => JSON.stringify(s) === JSON.stringify(keys))) {
              responseShapes.push(keys);
            }
          }
        }

        // Database operations detection
        const dbKeywords = ['query', 'find', 'findone', 'findbyid', 'create', 'update', 'delete', 'save', 'insert'];
        if (dbKeywords.includes(calleeName.toLowerCase()) || ['pool', 'client', 'db', 'mongoose'].includes(callee?.object?.name?.toLowerCase())) {
          hasDatabaseCalls = true;
          downstreamCalls.push(`db.${calleeName}`);
        }

        // External operations detection
        if (['fetch', 'axios', 'request', 'verifyidtoken'].includes(calleeName.toLowerCase()) || callee?.object?.name === 'client') {
          hasExternalCalls = true;
          downstreamCalls.push(`external.${calleeName}`);
        }
      }
    });
  }

  // Default response status code to 200 if not identified
  if (responseStatusCodes.size === 0) {
    responseStatusCodes.add(200);
  }

  // Determine contract completeness
  let contractCompleteness = 'PARTIAL';
  if (parameters.length > 0 && responseStatusCodes.size > 0 && (requestBody.fields.length > 0 || routePath.length > 0)) {
    contractCompleteness = 'COMPLETE';
  } else if (!targetAstNode) {
    contractCompleteness = 'UNKNOWN';
  }

  // Determine error handling coverage
  let errorHandlingCoverage = 'UNIDENTIFIED';
  if (hasTryCatch) {
    errorHandlingCoverage = 'IDENTIFIED';
  } else if (!isAsync) {
    errorHandlingCoverage = 'PARTIAL';
  }

  return {
    parameters,
    requestBody,
    responseStatusCodes: Array.from(responseStatusCodes).sort((a, b) => a - b),
    responseShapes,
    contractCompleteness,
    errorHandlingCoverage,
    isAsync,
    hasTryCatch,
    hasDatabaseCalls,
    hasExternalCalls,
    downstreamCalls,
    dependencyDepth: Math.min(5, 1 + (hasDatabaseCalls ? 1 : 0) + (hasExternalCalls ? 1 : 0) + (downstreamCalls.length > 0 ? 1 : 0))
  };
}

/**
 * Evaluates deterministic static reliability rules for a discovered endpoint
 * @param {Object} endpoint
 * @returns {Array<Object>} Discovered reliability findings
 */
export function evaluateEndpointReliability(endpoint) {
  const findings = [];
  const {
    method,
    routePath,
    sourceFile,
    sourceLine,
    isAuthenticated,
    hasAuthorization,
    contract
  } = endpoint;

  const isPublic = isPublicRoute(routePath);

  // 1. Missing Authentication (API_MISSING_AUTH)
  if (!isPublic && !isAuthenticated) {
    const isMutation = ['POST', 'PUT', 'DELETE', 'PATCH'].includes(method);
    findings.push({
      ruleId: 'API_MISSING_AUTH',
      severity: isMutation ? 'HIGH' : 'MEDIUM',
      category: 'SECURITY',
      method,
      routePath,
      sourceFile,
      sourceLine,
      evidence: `Route ${method} ${routePath} declared without authentication middleware in ${sourceFile}:${sourceLine}`,
      explanation: 'Endpoint appears externally reachable without authentication middleware.',
      remediation: 'Attach standard authentication middleware (e.g. requireAuth, verifyToken) to the router or route registration.'
    });
  }

  // 2. Missing Authorization Guard (API_MISSING_AUTHORIZATION)
  if (isAuthenticated && !hasAuthorization) {
    // If route accesses resource by ID (:id) or performs mutation, it should have tenant/role verification
    const hasParamId = routePath.includes(':id') || routePath.includes(':pullNumber');
    const isMutation = ['POST', 'PUT', 'DELETE', 'PATCH'].includes(method);
    if (hasParamId || isMutation) {
      findings.push({
        ruleId: 'API_MISSING_AUTHORIZATION',
        severity: 'MEDIUM',
        category: 'SECURITY',
        method,
        routePath,
        sourceFile,
        sourceLine,
        evidence: `Route ${method} ${routePath} accesses resource parameters or performs mutation without explicit authorization middleware`,
        explanation: 'Endpoint accesses repository/resource data but lacks an identifiable authorization or tenant guard.',
        remediation: 'Verify resource ownership or require explicit permission checks before executing mutations or returning entity data.'
      });
    }
  }

  // 3. Unhandled Async Failure (API_UNHANDLED_ASYNC)
  if (contract.isAsync && !contract.hasTryCatch) {
    findings.push({
      ruleId: 'API_UNHANDLED_ASYNC',
      severity: 'HIGH',
      category: 'RELIABILITY',
      method,
      routePath,
      sourceFile,
      sourceLine,
      evidence: `Async route handler lacks try/catch block or error handling wrapper in ${sourceFile}:${sourceLine}`,
      explanation: 'Async route handler performs await operations without an identifiable error path or error middleware pattern.',
      remediation: 'Wrap async operations in a try/catch block and pass errors to next(err), or wrap the handler with an async error wrapper.'
    });
  }

  // 4. Inconsistent Response Status Handling (API_INCONSISTENT_STATUS)
  if (contract.responseStatusCodes.includes(200) && contract.responseStatusCodes.some(code => code >= 400 && code < 500) && contract.hasTryCatch === false) {
    findings.push({
      ruleId: 'API_INCONSISTENT_STATUS',
      severity: 'LOW',
      category: 'RELIABILITY',
      method,
      routePath,
      sourceFile,
      sourceLine,
      evidence: `Endpoint defines multiple status branches without structured exception boundary`,
      explanation: 'Similar failure paths may return inconsistent status codes across handler executions.',
      remediation: 'Standardize error response structure and HTTP status code mappings across all code branches.'
    });
  }

  // 5. Database Call Without Error Handling (API_DATABASE_NO_ERROR_HANDLING)
  if (contract.hasDatabaseCalls && !contract.hasTryCatch) {
    findings.push({
      ruleId: 'API_DATABASE_NO_ERROR_HANDLING',
      severity: 'HIGH',
      category: 'RELIABILITY',
      method,
      routePath,
      sourceFile,
      sourceLine,
      evidence: `Database operations detected outside try/catch boundary in ${sourceFile}:${sourceLine}`,
      explanation: 'Endpoint performs database calls but has no identifiable localized error handling.',
      remediation: 'Enclose database queries in try/catch blocks to gracefully handle connection timeouts or query errors.'
    });
  }

  // 6. External Dependency Exposure (API_EXTERNAL_DEPENDENCY_EXPOSURE)
  if (contract.hasExternalCalls && !contract.hasTryCatch) {
    findings.push({
      ruleId: 'API_EXTERNAL_DEPENDENCY_EXPOSURE',
      severity: 'MEDIUM',
      category: 'RELIABILITY',
      method,
      routePath,
      sourceFile,
      sourceLine,
      evidence: `External network/SDK call performed without isolated timeout or error recovery in ${sourceFile}`,
      explanation: 'Endpoint depends on an external API/service and lacks an identifiable timeout or error-handling mechanism.',
      remediation: 'Implement an explicit request timeout, retry budget, and fallback response for external service dependencies.'
    });
  }

  // 7. Contract Incompleteness (API_CONTRACT_INCOMPLETE)
  if (contract.contractCompleteness === 'UNKNOWN') {
    findings.push({
      ruleId: 'API_CONTRACT_INCOMPLETE',
      severity: 'LOW',
      category: 'CONTRACT',
      method,
      routePath,
      sourceFile,
      sourceLine,
      evidence: `Handler implementation in ${sourceFile} is opaque to static contract inference`,
      explanation: 'Request and response contract behavior cannot be determined statically from the implementation.',
      remediation: 'Declare explicit response schemas or inline parameter handling to enable deterministic contract verification.'
    });
  }

  // 8. Excessive Dependency Depth (API_EXCESSIVE_DEPENDENCY_DEPTH)
  if (contract.dependencyDepth >= 4) {
    findings.push({
      ruleId: 'API_EXCESSIVE_DEPENDENCY_DEPTH',
      severity: 'LOW',
      category: 'PERFORMANCE',
      method,
      routePath,
      sourceFile,
      sourceLine,
      evidence: `Endpoint downstream dependency depth is ${contract.dependencyDepth} (threshold: 4)`,
      explanation: 'Route-to-service-to-database call chain exceeds recommended architectural depth threshold.',
      remediation: 'Refactor handler to decouple deep downstream dependencies and reduce call chain complexity.'
    });
  }

  return findings;
}

/**
 * Calculates deterministic API reliability score and explicit penalty breakdown
 * @param {Array<Object>} endpoints
 * @param {Array<Object>} findings
 * @returns {Object} { score: number, breakdown: Object }
 */
export function calculateApiReliabilityScore(endpoints = [], findings = []) {
  if (endpoints.length === 0) {
    return {
      score: 100.0,
      breakdown: {
        baseScore: 100.0,
        highSeverityDeduction: 0,
        mediumSeverityDeduction: 0,
        lowSeverityDeduction: 0,
        unauthenticatedPenalty: 0,
        incompleteContractPenalty: 0,
        finalScore: 100.0,
        note: 'Clean baseline: No API endpoints discovered in this snapshot.'
      }
    };
  }

  let baseScore = 100.0;

  const highCount = findings.filter(f => f.severity === 'HIGH').length;
  const mediumCount = findings.filter(f => f.severity === 'MEDIUM').length;
  const lowCount = findings.filter(f => f.severity === 'LOW').length;

  // Penalties per finding
  const highSeverityDeduction = highCount * 12.0;
  const mediumSeverityDeduction = mediumCount * 6.0;
  const lowSeverityDeduction = lowCount * 2.0;

  // Unauthenticated ratio penalty (excluding public routes)
  const nonPublicEndpoints = endpoints.filter(e => !isPublicRoute(e.routePath));
  const unauthCount = nonPublicEndpoints.filter(e => !e.isAuthenticated).length;
  const unauthenticatedPenalty = nonPublicEndpoints.length > 0
    ? Number(((unauthCount / nonPublicEndpoints.length) * 15.0).toFixed(2))
    : 0;

  // Contract incompleteness penalty
  const incompleteCount = endpoints.filter(e => e.contract?.contractCompleteness === 'UNKNOWN').length;
  const incompleteContractPenalty = Number(((incompleteCount / endpoints.length) * 10.0).toFixed(2));

  const totalDeductions = highSeverityDeduction + mediumSeverityDeduction + lowSeverityDeduction + unauthenticatedPenalty + incompleteContractPenalty;
  const finalScore = Math.max(0.0, Math.min(100.0, Number((baseScore - totalDeductions).toFixed(2))));

  return {
    score: finalScore,
    breakdown: {
      baseScore: 100.0,
      highSeverityDeduction,
      mediumSeverityDeduction,
      lowSeverityDeduction,
      unauthenticatedPenalty,
      incompleteContractPenalty,
      finalScore
    }
  };
}

/**
 * Analyzes and persists API reliability intelligence for a snapshot
 * @param {string} snapshotId
 * @param {string} repositoryId
 * @param {Array<Object>} files - Raw snapshot files
 * @param {Object} [context={}]
 * @param {Object} [dbPool=pool]
 * @returns {Promise<Object>} Summary and endpoints count
 */
export function analyzeAndPersistApiReliabilitySync(snapshotId, repositoryId, files = []) {
  const discovered = discoverEndpointsFromFiles(files);
  const allFindings = [];

  for (const ep of discovered) {
    const epFindings = evaluateEndpointReliability(ep);
    ep.findings = epFindings;
    allFindings.push(...epFindings);
  }

  const { score, breakdown } = calculateApiReliabilityScore(discovered, allFindings);

  const methodDist = {};
  let authenticatedCount = 0;
  let completeContractCount = 0;
  let partialContractCount = 0;
  let unknownContractCount = 0;

  for (const ep of discovered) {
    methodDist[ep.method] = (methodDist[ep.method] || 0) + 1;
    if (ep.isAuthenticated) authenticatedCount++;
    if (ep.contract.contractCompleteness === 'COMPLETE') completeContractCount++;
    else if (ep.contract.contractCompleteness === 'PARTIAL') partialContractCount++;
    else unknownContractCount++;
  }

  const findingsBySeverity = {
    HIGH: allFindings.filter(f => f.severity === 'HIGH').length,
    MEDIUM: allFindings.filter(f => f.severity === 'MEDIUM').length,
    LOW: allFindings.filter(f => f.severity === 'LOW').length
  };

  const summary = {
    snapshotId,
    repositoryId,
    totalEndpoints: discovered.length,
    methodDistribution: methodDist,
    authenticatedCount,
    unauthenticatedCount: discovered.length - authenticatedCount,
    completeContractCount,
    partialContractCount,
    unknownContractCount,
    totalFindings: allFindings.length,
    findingsBySeverity,
    reliabilityScore: score,
    scoreBreakdown: breakdown
  };

  return { summary, endpoints: discovered, findings: allFindings };
}

/**
 * Persists discovered endpoints, contracts, findings, and summary to PostgreSQL
 */
export async function analyzeAndPersistApiReliability(snapshotId, repositoryId, files = [], context = {}, dbPool = pool) {
  const { summary, endpoints, findings } = analyzeAndPersistApiReliabilitySync(snapshotId, repositoryId, files);

  const client = await dbPool.connect();
  try {
    await client.query('BEGIN');

    // 1. Upsert summary
    await client.query(`
      INSERT INTO snapshot_api_summaries (
        snapshot_id, repository_id, total_endpoints, method_distribution,
        authenticated_count, unauthenticated_count, complete_contract_count,
        partial_contract_count, unknown_contract_count, total_findings,
        findings_by_severity, reliability_score, score_breakdown
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      ON CONFLICT (snapshot_id) DO UPDATE SET
        total_endpoints = EXCLUDED.total_endpoints,
        method_distribution = EXCLUDED.method_distribution,
        authenticated_count = EXCLUDED.authenticated_count,
        unauthenticated_count = EXCLUDED.unauthenticated_count,
        complete_contract_count = EXCLUDED.complete_contract_count,
        partial_contract_count = EXCLUDED.partial_contract_count,
        unknown_contract_count = EXCLUDED.unknown_contract_count,
        total_findings = EXCLUDED.total_findings,
        findings_by_severity = EXCLUDED.findings_by_severity,
        reliability_score = EXCLUDED.reliability_score,
        score_breakdown = EXCLUDED.score_breakdown
    `, [
      snapshotId,
      repositoryId,
      summary.totalEndpoints,
      JSON.stringify(summary.methodDistribution),
      summary.authenticatedCount,
      summary.unauthenticatedCount,
      summary.completeContractCount,
      summary.partialContractCount,
      summary.unknownContractCount,
      summary.totalFindings,
      JSON.stringify(summary.findingsBySeverity),
      summary.reliabilityScore,
      JSON.stringify(summary.scoreBreakdown)
    ]);

    // 2. Clear old endpoints & findings for this snapshot to ensure full idempotency
    await client.query('DELETE FROM snapshot_api_findings WHERE snapshot_id = $1', [snapshotId]);
    await client.query('DELETE FROM snapshot_api_endpoints WHERE snapshot_id = $1', [snapshotId]);

    // 3. Insert endpoints and collect generated IDs
    const endpointIdMap = new Map();

    for (const ep of endpoints) {
      const { rows } = await client.query(`
        INSERT INTO snapshot_api_endpoints (
          snapshot_id, repository_id, method, route_path, source_file, source_line,
          router_name, handler_name, is_authenticated, has_authorization,
          auth_middleware, middleware_chain, parameters, request_body,
          response_status_codes, response_shapes, contract_completeness,
          error_handling_coverage, dependency_depth, database_dependent,
          external_dependent, downstream_calls, reliability_score
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
          $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23
        )
        ON CONFLICT (snapshot_id, method, route_path) DO UPDATE SET
          source_file = EXCLUDED.source_file,
          source_line = EXCLUDED.source_line,
          is_authenticated = EXCLUDED.is_authenticated,
          has_authorization = EXCLUDED.has_authorization,
          parameters = EXCLUDED.parameters,
          request_body = EXCLUDED.request_body,
          response_status_codes = EXCLUDED.response_status_codes,
          response_shapes = EXCLUDED.response_shapes,
          contract_completeness = EXCLUDED.contract_completeness,
          error_handling_coverage = EXCLUDED.error_handling_coverage,
          dependency_depth = EXCLUDED.dependency_depth,
          database_dependent = EXCLUDED.database_dependent,
          external_dependent = EXCLUDED.external_dependent,
          downstream_calls = EXCLUDED.downstream_calls
        RETURNING id
      `, [
        snapshotId,
        repositoryId,
        ep.method,
        ep.routePath,
        ep.sourceFile,
        ep.sourceLine,
        ep.routerName || null,
        ep.handlerName || null,
        ep.isAuthenticated,
        ep.hasAuthorization,
        JSON.stringify(ep.authMiddleware),
        JSON.stringify(ep.middlewareChain),
        JSON.stringify(ep.contract.parameters),
        JSON.stringify(ep.contract.requestBody),
        JSON.stringify(ep.contract.responseStatusCodes),
        JSON.stringify(ep.contract.responseShapes),
        ep.contract.contractCompleteness,
        ep.contract.errorHandlingCoverage,
        ep.contract.dependencyDepth,
        ep.contract.hasDatabaseCalls,
        ep.contract.hasExternalCalls,
        JSON.stringify(ep.contract.downstreamCalls),
        summary.reliabilityScore
      ]);

      endpointIdMap.set(`${ep.method} ${ep.routePath}`, rows[0].id);
    }

    // 4. Insert findings
    for (const f of findings) {
      const epId = endpointIdMap.get(`${f.method} ${f.routePath}`) || null;
      await client.query(`
        INSERT INTO snapshot_api_findings (
          snapshot_id, repository_id, endpoint_id, rule_id, severity, category,
          method, route_path, source_file, source_line, evidence, explanation, remediation
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
        ON CONFLICT (snapshot_id, rule_id, method, route_path) DO UPDATE SET
          severity = EXCLUDED.severity,
          evidence = EXCLUDED.evidence,
          explanation = EXCLUDED.explanation,
          remediation = EXCLUDED.remediation
      `, [
        snapshotId,
        repositoryId,
        epId,
        f.ruleId,
        f.severity,
        f.category,
        f.method,
        f.routePath,
        f.sourceFile,
        f.sourceLine,
        f.evidence,
        f.explanation,
        f.remediation
      ]);
    }

    await client.query('COMMIT');
    logger.info({ snapshotId, endpointsCount: endpoints.length, findingsCount: findings.length }, 'Persisted API reliability intelligence to PostgreSQL');
    return summary;
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error({ snapshotId, err: err.message }, 'Failed to persist API reliability data');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Longitudinal differential comparison of API endpoint inventories between two snapshots
 * @param {string} baseSnapshotId
 * @param {string} targetSnapshotId
 * @param {string} repositoryId
 * @param {Object} [dbPool=pool]
 * @returns {Promise<Object>}
 */
export async function compareSnapshotApis(baseSnapshotId, targetSnapshotId, repositoryId, dbPool = pool) {
  if (baseSnapshotId && baseSnapshotId === targetSnapshotId) {
    const err = new Error('Base and target snapshots must be distinct snapshots.');
    err.status = 400;
    throw err;
  }

  // Fetch base endpoints & findings
  let baseEndpoints = [];
  let baseFindings = [];
  let baseSummary = null;

  if (baseSnapshotId && baseSnapshotId !== 'none') {
    const { rows: bEpRows } = await dbPool.query(
      'SELECT * FROM snapshot_api_endpoints WHERE snapshot_id = $1 AND repository_id = $2',
      [baseSnapshotId, repositoryId]
    );
    baseEndpoints = bEpRows;

    const { rows: bFindingsRows } = await dbPool.query(
      'SELECT * FROM snapshot_api_findings WHERE snapshot_id = $1 AND repository_id = $2',
      [baseSnapshotId, repositoryId]
    );
    baseFindings = bFindingsRows;

    const { rows: bSumRows } = await dbPool.query(
      'SELECT * FROM snapshot_api_summaries WHERE snapshot_id = $1 AND repository_id = $2',
      [baseSnapshotId, repositoryId]
    );
    baseSummary = bSumRows[0] || null;
  }

  // Fetch target endpoints & findings
  const { rows: tEpRows } = await dbPool.query(
    'SELECT * FROM snapshot_api_endpoints WHERE snapshot_id = $1 AND repository_id = $2',
    [targetSnapshotId, repositoryId]
  );
  const targetEndpoints = tEpRows;

  const { rows: tFindingsRows } = await dbPool.query(
    'SELECT * FROM snapshot_api_findings WHERE snapshot_id = $1 AND repository_id = $2',
    [targetSnapshotId, repositoryId]
  );
  const targetFindings = tFindingsRows;

  const { rows: tSumRows } = await dbPool.query(
    'SELECT * FROM snapshot_api_summaries WHERE snapshot_id = $1 AND repository_id = $2',
    [targetSnapshotId, repositoryId]
  );
  const targetSummary = tSumRows[0] || null;

  if (!baseSnapshotId || baseSnapshotId === 'none') {
    return {
      repositoryId,
      isBaseline: true,
      base: null,
      target: {
        snapshotId: targetSnapshotId,
        summary: targetSummary,
        endpoints: targetEndpoints,
        findings: targetFindings
      },
      deltas: null
    };
  }

  // Compare endpoints by canonical key: `${method} ${route_path}`
  const baseMap = new Map(baseEndpoints.map(e => [`${e.method} ${e.route_path}`, e]));
  const targetMap = new Map(targetEndpoints.map(e => [`${e.method} ${e.route_path}`, e]));

  const added = [];
  const removed = [];
  const modified = [];
  const unchanged = [];

  for (const [key, targetEp] of targetMap.entries()) {
    if (!baseMap.has(key)) {
      added.push({
        method: targetEp.method,
        routePath: targetEp.route_path,
        sourceFile: targetEp.source_file,
        sourceLine: targetEp.source_line,
        isAuthenticated: targetEp.is_authenticated,
        contractCompleteness: targetEp.contract_completeness,
        status: 'ADDED'
      });
    } else {
      const baseEp = baseMap.get(key);
      const changes = [];

      if (baseEp.is_authenticated !== targetEp.is_authenticated) {
        changes.push(`Authentication status changed: ${baseEp.is_authenticated} -> ${targetEp.is_authenticated}`);
      }
      if (baseEp.contract_completeness !== targetEp.contract_completeness) {
        changes.push(`Contract completeness changed: ${baseEp.contract_completeness} -> ${targetEp.contract_completeness}`);
      }
      if (JSON.stringify(baseEp.parameters) !== JSON.stringify(targetEp.parameters)) {
        changes.push('Parameters changed');
      }
      if (JSON.stringify(baseEp.response_status_codes) !== JSON.stringify(targetEp.response_status_codes)) {
        changes.push('Response status codes changed');
      }

      if (changes.length > 0) {
        modified.push({
          method: targetEp.method,
          routePath: targetEp.route_path,
          sourceFile: targetEp.source_file,
          sourceLine: targetEp.source_line,
          changes,
          status: 'MODIFIED'
        });
      } else {
        unchanged.push({
          method: targetEp.method,
          routePath: targetEp.route_path,
          status: 'UNCHANGED'
        });
      }
    }
  }

  for (const [key, baseEp] of baseMap.entries()) {
    if (!targetMap.has(key)) {
      removed.push({
        method: baseEp.method,
        routePath: baseEp.route_path,
        sourceFile: baseEp.source_file,
        sourceLine: baseEp.source_line,
        status: 'REMOVED'
      });
    }
  }

  // Findings trajectory
  const baseFindingKeys = new Set(baseFindings.map(f => `${f.rule_id}:${f.method} ${f.route_path}`));
  const targetFindingKeys = new Set(targetFindings.map(f => `${f.rule_id}:${f.method} ${f.route_path}`));

  const newFindings = targetFindings.filter(f => !baseFindingKeys.has(`${f.rule_id}:${f.method} ${f.route_path}`));
  const resolvedFindings = baseFindings.filter(f => !targetFindingKeys.has(`${f.rule_id}:${f.method} ${f.route_path}`));

  const baseScore = baseSummary ? Number(baseSummary.reliability_score) : 100.0;
  const targetScore = targetSummary ? Number(targetSummary.reliability_score) : 100.0;

  return {
    repositoryId,
    isBaseline: false,
    base: {
      snapshotId: baseSnapshotId,
      summary: baseSummary
    },
    target: {
      snapshotId: targetSnapshotId,
      summary: targetSummary
    },
    deltas: {
      endpoints: {
        previousCount: baseEndpoints.length,
        currentCount: targetEndpoints.length,
        delta: targetEndpoints.length - baseEndpoints.length,
        addedCount: added.length,
        removedCount: removed.length,
        modifiedCount: modified.length,
        unchangedCount: unchanged.length,
        added,
        removed,
        modified
      },
      findings: {
        previousCount: baseFindings.length,
        currentCount: targetFindings.length,
        delta: targetFindings.length - baseFindings.length,
        newFindingsCount: newFindings.length,
        resolvedFindingsCount: resolvedFindings.length,
        newFindings,
        resolvedFindings
      },
      score: {
        previous: baseScore,
        current: targetScore,
        delta: Number((targetScore - baseScore).toFixed(2))
      }
    }
  };
}
