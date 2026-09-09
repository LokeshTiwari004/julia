#!/usr/bin/env node
/**
 * Architecture analysis script for Julia project.
 * Computes structural patterns from import graph and file paths.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, basename, extname } from 'node:path';

const [,, inputPath, outputPath] = process.argv;

if (!inputPath || !outputPath) {
  console.error('Usage: node ua-arch-analyze.js <input.json> <output.json>');
  process.exit(1);
}

const input = JSON.parse(readFileSync(inputPath, 'utf-8'));
const { fileNodes, importEdges, allEdges } = input;

// A. Directory Grouping
const commonPrefix = findCommonPrefix(fileNodes.map(n => n.filePath));
const directoryGroups = {};
for (const node of fileNodes) {
  const relPath = node.filePath.replace(commonPrefix, '');
  const firstDir = relPath.split('/')[0] || 'root';
  if (!directoryGroups[firstDir]) directoryGroups[firstDir] = [];
  directoryGroups[firstDir].push(node.id);
}

// B. Node Type Grouping
const nodeTypeGroups = {};
for (const node of fileNodes) {
  if (!nodeTypeGroups[node.type]) nodeTypeGroups[node.type] = [];
  nodeTypeGroups[node.type].push(node.id);
}

// C. Import Adjacency
const adjacency = {};
const fanIn = {};
const fanOut = {};
for (const edge of importEdges) {
  if (!adjacency[edge.source]) adjacency[edge.source] = [];
  adjacency[edge.source].push({ target: edge.target, type: edge.type });
  fanOut[edge.source] = (fanOut[edge.source] || 0) + 1;
  fanIn[edge.target] = (fanIn[edge.target] || 0) + 1;
}

// Group-level imports
const groupImports = {};
for (const edge of importEdges) {
  const sourceGroup = getGroupForNode(edge.source, directoryGroups);
  const targetGroup = getGroupForNode(edge.target, directoryGroups);
  if (sourceGroup !== targetGroup) {
    const key = `${sourceGroup}->${targetGroup}`;
    groupImports[key] = (groupImports[key] || 0) + 1;
  }
}

// D. Cross-Category Edges
const crossCategory = {};
for (const edge of allEdges) {
  const sourceNode = fileNodes.find(n => n.id === edge.source);
  const targetNode = fileNodes.find(n => n.id === edge.target);
  if (sourceNode && targetNode && sourceNode.type !== targetNode.type) {
    const key = `${sourceNode.type}->${targetNode.type}:${edge.type}`;
    crossCategory[key] = (crossCategory[key] || 0) + 1;
  }
}

// E. Inter-Group Import Frequency (already computed as groupImports)

// F. Intra-Group Import Density
const intraGroupDensity = {};
for (const [group, nodeIds] of Object.entries(directoryGroups)) {
  let internalEdges = 0;
  let totalEdges = 0;
  for (const edge of importEdges) {
    const sourceInGroup = nodeIds.includes(edge.source);
    const targetInGroup = nodeIds.includes(edge.target);
    if (sourceInGroup && targetInGroup) internalEdges++;
    if (sourceInGroup || targetInGroup) totalEdges++;
  }
  intraGroupDensity[group] = {
    internalEdges,
    totalEdges,
    density: totalEdges > 0 ? internalEdges / totalEdges : 0
  };
}

// G. Directory Pattern Matching
const patternMatches = {};
const patterns = {
  api: ['routes', 'api', 'controllers', 'endpoints', 'handlers', 'serializers', 'routers', 'blueprints', 'dto', 'request', 'response'],
  service: ['services', 'core', 'lib', 'domain', 'logic', 'internal', 'signals', 'composables', 'mailers', 'jobs', 'channels', 'hooks', 'store', 'state', 'reducers', 'actions', 'slices'],
  data: ['models', 'db', 'data', 'persistence', 'repository', 'entities', 'migrations', 'entity', 'sql', 'database', 'schema', 'migrations'],
  ui: ['components', 'views', 'pages', 'ui', 'layouts', 'screens', 'assets', 'static', 'public'],
  middleware: ['middleware', 'plugins', 'interceptors', 'guards'],
  utility: ['utils', 'helpers', 'common', 'shared', 'tools', 'pkg', 'templatetags', 'composables'],
  config: ['config', 'constants', 'env', 'settings', 'management', 'commands', 'wsgi', 'asgi', 'config.ru'],
  test: ['__tests__', 'test', 'tests', 'spec', 'specs'],
  types: ['types', 'interfaces', 'schemas', 'contracts', 'dtos', 'serializers'],
  entry: ['cmd', 'bin', 'main', 'manage.py', 'wsgi.py', 'asgi.py', 'Application.java', 'Main.java', 'Program.cs', 'Cargo.toml', 'go.mod', 'Gemfile', 'pom.xml', 'build.gradle', 'composer.json'],
  documentation: ['docs', 'documentation', 'wiki'],
  infrastructure: ['deploy', 'deployment', 'infra', 'infrastructure', 'k8s', 'kubernetes', 'helm', 'charts', 'terraform', 'tf', 'docker'],
  'ci-cd': ['.github', '.gitlab', '.circleci', 'jenkinsfile']
};

for (const [group] of Object.entries(directoryGroups)) {
  let matched = false;
  const lowerGroup = group.toLowerCase();
  for (const [pattern, keywords] of Object.entries(patterns)) {
    if (keywords.some(k => lowerGroup === k || lowerGroup.startsWith(k) || lowerGroup.includes(k))) {
      patternMatches[group] = pattern;
      matched = true;
      break;
    }
  }
  if (!matched) {
    // Check file extensions in group
    const files = fileNodes.filter(n => getGroupForNode(n.id, directoryGroups) === group);
    const extCount = {};
    for (const f of files) {
      const ext = extname(f.filePath).toLowerCase();
      if (ext) extCount[ext] = (extCount[ext] || 0) + 1;
    }
    if (extCount['.md'] || extCount['.rst']) patternMatches[group] = 'documentation';
    else if (extCount['.tf'] || extCount['.tfvars']) patternMatches[group] = 'infrastructure';
    else if (extCount['.sql']) patternMatches[group] = 'data';
    else if (extCount['.yml'] || extCount['.yaml']) {
      const hasCI = files.some(f => f.filePath.includes('.github/workflows') || f.filePath.includes('.gitlab-ci') || f.filePath.includes('Jenkinsfile'));
      if (hasCI) patternMatches[group] = 'ci-cd';
    }
    else if (extCount['.toml'] || extCount['.json'] || extCount['.xml'] || extCount['.cfg'] || extCount['.ini']) patternMatches[group] = 'config';
    else patternMatches[group] = 'utility';
  }
}

// H. Deployment Topology
const infraFiles = fileNodes.filter(n => 
  n.filePath.includes('Dockerfile') || 
  n.filePath.includes('docker-compose') ||
  n.filePath.includes('.github/workflows') ||
  n.filePath.includes('.gitlab-ci') ||
  n.filePath.includes('Jenkinsfile') ||
  n.filePath.includes('.tf') ||
  n.filePath.includes('.tfvars')
).map(n => n.filePath);

const deploymentTopology = {
  hasDockerfile: fileNodes.some(n => n.filePath.includes('Dockerfile')),
  hasCompose: fileNodes.some(n => n.filePath.includes('docker-compose')),
  hasK8s: fileNodes.some(n => n.filePath.includes('k8s') || n.filePath.includes('kubernetes')),
  hasTerraform: fileNodes.some(n => n.filePath.endsWith('.tf') || n.filePath.endsWith('.tfvars')),
  hasCI: fileNodes.some(n => n.filePath.includes('.github/workflows') || n.filePath.includes('.gitlab-ci') || n.filePath.includes('Jenkinsfile')),
  infraFiles
};

// I. Data Pipeline Detection
const dataPipeline = {
  schemaFiles: fileNodes.filter(n => n.filePath.endsWith('.sql') || n.filePath.endsWith('.graphql') || n.filePath.endsWith('.proto') || n.filePath.endsWith('.prisma')).map(n => n.filePath),
  migrationFiles: fileNodes.filter(n => n.filePath.includes('migration') && n.filePath.endsWith('.sql')).map(n => n.filePath),
  dataModelFiles: fileNodes.filter(n => n.filePath.includes('/models/') || n.filePath.includes('/db/') || n.filePath.includes('/data/')).map(n => n.filePath),
  apiHandlerFiles: fileNodes.filter(n => n.filePath.includes('/routes/') || n.filePath.includes('/api/') || n.filePath.includes('/controllers/') || n.filePath.includes('/handlers/') || n.filePath.includes('/endpoints/')).map(n => n.filePath)
};

// J. Documentation Coverage
const docGroups = new Set();
for (const node of fileNodes) {
  if (node.type === 'document' || node.filePath.endsWith('.md') || node.filePath.endsWith('.rst')) {
    const group = getGroupForNode(node.id, directoryGroups);
    docGroups.add(group);
  }
}
const docCoverage = {
  groupsWithDocs: docGroups.size,
  totalGroups: Object.keys(directoryGroups).length,
  coverageRatio: Object.keys(directoryGroups).length > 0 ? docGroups.size / Object.keys(directoryGroups).length : 0,
  undocumentedGroups: Object.keys(directoryGroups).filter(g => !docGroups.has(g))
};

// K. Dependency Direction
const dependencyDirection = [];
const groupPairCounts = {};
for (const [key, count] of Object.entries(groupImports)) {
  const [from, to] = key.split('->');
  if (!groupPairCounts[from]) groupPairCounts[from] = {};
  if (!groupPairCounts[to]) groupPairCounts[to] = {};
  groupPairCounts[from][to] = (groupPairCounts[from][to] || 0) + count;
  groupPairCounts[to][from] = (groupPairCounts[to][from] || 0);
}
for (const [from, targets] of Object.entries(groupPairCounts)) {
  for (const [to, count] of Object.entries(targets)) {
    const reverseCount = groupPairCounts[to]?.[from] || 0;
    if (count > reverseCount) {
      dependencyDirection.push({ dependent: from, dependsOn: to });
    }
  }
}

// File stats
const fileStats = {
  totalFileNodes: fileNodes.length,
  filesPerGroup: {},
  nodeTypeCounts: {}
};
for (const [group, ids] of Object.entries(directoryGroups)) {
  fileStats.filesPerGroup[group] = ids.length;
}
for (const [type, ids] of Object.entries(nodeTypeGroups)) {
  fileStats.nodeTypeCounts[type] = ids.length;
}

// File fan-in/out
const fileFanIn = {};
const fileFanOut = {};
for (const [id, count] of Object.entries(fanIn)) fileFanIn[id] = count;
for (const [id, count] of Object.entries(fanOut)) fileFanOut[id] = count;

const output = {
  scriptCompleted: true,
  directoryGroups,
  nodeTypeGroups,
  crossCategoryEdges: Object.entries(crossCategory).map(([key, count]) => {
    const [types, edgeType] = key.split(':');
    const [fromType, toType] = types.split('->');
    return { fromType, toType, edgeType, count };
  }),
  interGroupImports: Object.entries(groupImports).map(([key, count]) => {
    const [from, to] = key.split('->');
    return { from, to, count };
  }),
  intraGroupDensity,
  patternMatches,
  deploymentTopology,
  dataPipeline,
  docCoverage,
  dependencyDirection,
  fileStats,
  fileFanIn,
  fileFanOut
};

writeFileSync(outputPath, JSON.stringify(output, null, 2));

function findCommonPrefix(paths) {
  if (paths.length === 0) return '';
  const sorted = [...paths].sort();
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  let i = 0;
  while (i < first.length && i < last.length && first[i] === last[i]) i++;
  const lastSlash = first.lastIndexOf('/', i - 1);
  return lastSlash >= 0 ? first.substring(0, lastSlash + 1) : '';
}

function getGroupForNode(nodeId, directoryGroups) {
  for (const [group, ids] of Object.entries(directoryGroups)) {
    if (ids.includes(nodeId)) return group;
  }
  return 'root';
}