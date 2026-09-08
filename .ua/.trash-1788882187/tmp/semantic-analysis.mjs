#!/usr/bin/env node
/**
 * Semantic analysis for all batches - processes structural extraction results
 * and produces GraphNode and GraphEdge objects.
 */

import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve, basename } from 'node:path';

const UA_DIR = '/home/maruti/julia/.ua';
const TMP_DIR = '/home/maruti/julia/.ua/tmp';
const OUTPUT_DIR = '/home/maruti/julia/.ua/intermediate';

const LANGUAGE_DIRECTIVE = 'en';

function categorizeComplexity(nonEmptyLines, functionCount, classCount) {
  if (nonEmptyLines < 50 && functionCount <= 2 && classCount === 0) return 'simple';
  if (nonEmptyLines > 200 || functionCount > 10 || classCount > 3) return 'complex';
  return 'moderate';
}

function generateSummary(file, extraction) {
  const { path, language, fileCategory, totalLines, nonEmptyLines, functions, classes, metrics = {} } = file;
  const name = basename(path);
  
  if (fileCategory === 'docs') {
    const sections = extraction.sections || [];
    if (sections.length > 0) {
      const topics = sections.slice(0, 3).map(s => s.heading).join(', ');
      return `Documentation covering ${topics}${sections.length > 3 ? ' and more' : ''}.`;
    }
    return `Documentation file: ${name}.`;
  }
  
  if (fileCategory === 'config') {
    return `Configuration file: ${name}.`;
  }
  
  if (fileCategory === 'infra') {
    if (path.includes('.github/workflows') || path.includes('.gitlab-ci') || path.includes('Jenkinsfile')) {
      return `CI/CD pipeline configuration: ${name}.`;
    }
    if (path.endsWith('Dockerfile') || path.includes('docker-compose')) {
      return `Container build configuration: ${name}.`;
    }
    if (path.endsWith('.tf') || path.endsWith('.tfvars')) {
      return `Infrastructure as code: ${name}.`;
    }
    return `Infrastructure file: ${name}.`;
  }
  
  if (fileCategory === 'script') {
    return `Script file: ${name}.`;
  }
  
  // Code files
  const funcCount = functions?.length || 0;
  const classCount = classes?.length || 0;
  
  if (path.includes('/src/') && path.endsWith('.c')) {
    if (funcCount > 10) return `Core C runtime implementation with ${funcCount} functions.`;
    if (funcCount > 0) return `C runtime module with ${funcCount} functions.`;
    return `C runtime header/implementation: ${name}.`;
  }
  
  if (path.includes('/src/') && (path.endsWith('.cpp') || path.endsWith('.cc'))) {
    if (funcCount > 10) return `C++ compiler/runtime component with ${funcCount} functions.`;
    if (funcCount > 0) return `C++ module with ${funcCount} functions.`;
    return `C++ header/implementation: ${name}.`;
  }
  
  if (path.includes('/src/') && path.endsWith('.h')) {
    return `C/C++ header file declaring ${funcCount} functions and ${classCount} types.`;
  }
  
  if (path.includes('/base/') && path.endsWith('.jl')) {
    if (funcCount > 20) return `Base library core module with ${funcCount} functions.`;
    if (funcCount > 5) return `Base library module with ${funcCount} functions.`;
    return `Base library file: ${name}.`;
  }
  
  if (path.includes('/stdlib/') && path.endsWith('.jl')) {
    if (funcCount > 20) return `Standard library module with ${funcCount} functions.`;
    if (funcCount > 5) return `Standard library component with ${funcCount} functions.`;
    return `Standard library file: ${name}.`;
  }
  
  if (path.includes('/Compiler/') && path.endsWith('.jl')) {
    if (funcCount > 20) return `Compiler module with ${funcCount} functions.`;
    if (funcCount > 5) return `Compiler component with ${funcCount} functions.`;
    return `Compiler file: ${name}.`;
  }
  
  if (path.includes('/JuliaSyntax/') && path.endsWith('.jl')) {
    return `JuliaSyntax parser component with ${funcCount} functions.`;
  }
  
  if (path.includes('/JuliaLowering/') && path.endsWith('.jl')) {
    return `JuliaLowering AST lowering component with ${funcCount} functions.`;
  }
  
  if (path.includes('/cli/') && (path.endsWith('.c') || path.endsWith('.h'))) {
    return `CLI loader component: ${name}.`;
  }
  
  if (path.includes('/contrib/')) {
    return `Contribution script/tool: ${name}.`;
  }
  
  if (path.includes('/doc/') && path.endsWith('.md')) {
    return `Documentation: ${name}.`;
  }
  
  if (funcCount > 20) return `Module with ${funcCount} functions and ${classCount} types.`;
  if (funcCount > 5) return `Module with ${funcCount} functions.`;
  if (classCount > 0) return `Module defining ${classCount} types.`;
  
  return `Source file: ${name}.`;
}

function generateTags(file, extraction) {
  const { path, fileCategory, functions, classes } = file;
  const tags = [];
  const name = basename(path);
  
  if (fileCategory === 'docs') tags.push('documentation');
  if (fileCategory === 'config') tags.push('configuration');
  if (fileCategory === 'infra') tags.push('infrastructure');
  if (fileCategory === 'script') tags.push('script');
  
  if (path.includes('/src/')) tags.push('runtime');
  if (path.includes('/base/')) tags.push('base-library');
  if (path.includes('/stdlib/')) tags.push('stdlib');
  if (path.includes('/Compiler/')) tags.push('compiler');
  if (path.includes('/JuliaSyntax/')) tags.push('parser');
  if (path.includes('/JuliaLowering/')) tags.push('lowering');
  if (path.includes('/cli/')) tags.push('cli');
  if (path.includes('/doc/')) tags.push('documentation');
  if (path.includes('/contrib/')) tags.push('contrib');
  
  const funcCount = functions?.length || 0;
  const classCount = classes?.length || 0;
  
  if (funcCount > 20) tags.push('high-function-count');
  if (classCount > 5) tags.push('type-heavy');
  if (path.includes('gc') || path.includes('memory')) tags.push('gc');
  if (path.includes('jit') || path.includes('llvm') || path.includes('codegen')) tags.push('codegen');
  if (path.includes('parser') || path.includes('parse')) tags.push('parser');
  if (path.includes('type') || path.includes('infer')) tags.push('type-inference');
  if (path.includes('test') || path.includes('Test')) tags.push('testing');
  
  if (tags.length === 0) tags.push('source');
  
  return tags;
}

function determineNodeType(file) {
  const { path, fileCategory } = file;
  
  if (fileCategory === 'config') return 'config';
  if (fileCategory === 'docs') return 'document';
  if (fileCategory === 'infra') {
    if (path.includes('.github/workflows') || path.includes('.gitlab-ci') || path.includes('Jenkinsfile')) return 'pipeline';
    if (path.endsWith('Dockerfile') || path.includes('docker-compose')) return 'service';
    if (path.endsWith('.tf') || path.endsWith('.tfvars')) return 'resource';
    return 'service';
  }
  if (fileCategory === 'data') {
    if (path.endsWith('.sql')) return 'table';
    if (path.endsWith('.graphql') || path.endsWith('.proto') || path.endsWith('.prisma')) return 'schema';
    return 'endpoint';
  }
  return 'file';
}

function generateNodesAndEdges(extraction, batchImportData, neighborMap) {
  const { path, language, fileCategory, totalLines, nonEmptyLines, functions, classes, exports, callGraph, metrics = {} } = extraction;
  
  const nodeId = `${determineNodeType(extraction)}:${path}`;
  const summary = generateSummary(extraction, extraction);
  const tags = generateTags(extraction, extraction);
  const complexity = categorizeComplexity(nonEmptyLines, functions?.length || 0, classes?.length || 0);
  
  const node = {
    id: nodeId,
    type: determineNodeType(extraction),
    name: basename(path),
    filePath: path,
    summary,
    tags,
    complexity,
    language: language
  };
  
  const nodes = [node];
  const edges = [];
  
  // Add function nodes
  if (functions && functions.length > 0) {
    for (const fn of functions) {
      if (fn.name && !fn.name.startsWith('_')) {
        const fnId = `function:${path}:${fn.name}`;
        nodes.push({
          id: fnId,
          type: 'function',
          name: fn.name,
          filePath: path,
          summary: `Function ${fn.name} with ${fn.params?.length || 0} parameters.`,
          tags: ['function'],
          complexity: 'simple'
        });
        edges.push({
          source: nodeId,
          target: fnId,
          type: 'contains',
          weight: 1.0
        });
      }
    }
  }
  
  // Add class nodes
  if (classes && classes.length > 0) {
    for (const cls of classes) {
      const clsId = `class:${path}:${cls.name}`;
      nodes.push({
        id: clsId,
        type: 'class',
        name: cls.name,
        filePath: path,
        summary: `Class/struct ${cls.name} with ${cls.methods?.length || 0} methods.`,
        tags: ['class', 'type'],
        complexity: 'moderate'
      });
      edges.push({
        source: nodeId,
        target: clsId,
        type: 'contains',
        weight: 1.0
      });
    }
  }
  
  // Import edges from batchImportData
  const imports = batchImportData[path] || [];
  for (const imp of imports) {
    const targetId = `file:${imp}`;
    edges.push({
      source: nodeId,
      target: targetId,
      type: 'imports',
      weight: 0.7
    });
  }
  
  // Call graph edges
  if (callGraph && callGraph.length > 0) {
    for (const call of callGraph) {
      const callerId = `function:${path}:${call.caller}`;
      const calleeId = `function:${path}:${call.callee}`;
      // Only add if both functions exist in our nodes
      if (nodes.some(n => n.id === callerId) && nodes.some(n => n.id === calleeId)) {
        edges.push({
          source: callerId,
          target: calleeId,
          type: 'calls',
          weight: 0.8
        });
      }
    }
  }
  
  // Cross-batch edges via neighborMap
  if (neighborMap && neighborMap[path]) {
    for (const neighbor of neighborMap[path]) {
      const targetId = `file:${neighbor.path}`;
      edges.push({
        source: nodeId,
        target: targetId,
        type: 'imports',
        weight: 0.7
      });
    }
  }
  
  return { nodes, edges, batchFiles: extraction };
}

function processBatch(batchIndex) {
  const extractPath = `${TMP_DIR}/ua-file-extract-results-${batchIndex}.json`;
  const batchPath = `${OUTPUT_DIR}/batches.json`;
  
  if (!existsSync(extractPath)) {
    console.log(`Batch ${batchIndex}: No extraction results found`);
    return null;
  }
  
  const extraction = JSON.parse(readFileSync(extractPath, 'utf-8'));
  const batches = JSON.parse(readFileSync(batchPath, 'utf-8'));
  const batch = batches.batches.find(b => b.batchIndex === batchIndex);
  
  if (!batch) {
    console.log(`Batch ${batchIndex}: Not found in batches.json`);
    return null;
  }
  
  const batchImportData = batch.batchImportData || {};
  const neighborMap = batch.neighborMap || {};
  
  const allNodes = [];
  const allEdges = [];
  const batchFiles = [];
  
  for (const result of extraction.results) {
    const { nodes, edges, batchFiles: bf } = generateNodesAndEdges(result, batchImportData, neighborMap);
    allNodes.push(...nodes);
    allEdges.push(...edges);
    batchFiles.push(bf);
  }
  
  const output = {
    batchIndex,
    nodes: allNodes,
    edges: allEdges,
    batchFiles
  };
  
  const outputPath = `${OUTPUT_DIR}/batch-${batchIndex}.json`;
  writeFileSync(outputPath, JSON.stringify(output, null, 2));
  console.log(`Batch ${batchIndex}: ${allNodes.length} nodes, ${allEdges.length} edges, ${batchFiles.length} files`);
  
  return output;
}

// Main
async function main() {
  console.log('Starting semantic analysis for all batches...');
  
  for (let i = 1; i <= 59; i++) {
    processBatch(i);
  }
  
  console.log('Semantic analysis complete.');
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});