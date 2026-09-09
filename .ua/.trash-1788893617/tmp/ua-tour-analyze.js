#!/usr/bin/env node
/**
 * Tour builder analysis script for Julia project.
 * Computes structural signals for guided tour design.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { basename, extname } from 'node:path';

const [,, inputPath, outputPath] = process.argv;

if (!inputPath || !outputPath) {
  console.error('Usage: node ua-tour-analyze.js <input.json> <output.json>');
  process.exit(1);
}

const input = JSON.parse(readFileSync(inputPath, 'utf-8'));
const { nodes, edges, layers } = input;

// Build adjacency
const adjacency = {};
const reverseAdjacency = {};
for (const edge of edges) {
  if (!adjacency[edge.source]) adjacency[edge.source] = [];
  adjacency[edge.source].push({ target: edge.target, type: edge.type });
  if (!reverseAdjacency[edge.target]) reverseAdjacency[edge.target] = [];
  reverseAdjacency[edge.target].push({ source: edge.source, type: edge.type });
}

// A. Fan-In Ranking
const fanIn = {};
for (const edge of edges) {
  fanIn[edge.target] = (fanIn[edge.target] || 0) + 1;
}
const fanInRanking = Object.entries(fanIn)
  .map(([id, fanIn]) => ({ id, fanIn, name: nodes.find(n => n.id === id)?.name || '', summary: nodes.find(n => n.id === id)?.summary || '' }))
  .sort((a, b) => b.fanIn - a.fanIn)
  .slice(0, 20);

// B. Fan-Out Ranking
const fanOut = {};
for (const edge of edges) {
  fanOut[edge.source] = (fanOut[edge.source] || 0) + 1;
}
const fanOutRanking = Object.entries(fanOut)
  .map(([id, fanOut]) => ({ id, fanOut, name: nodes.find(n => n.id === id)?.name || '', summary: nodes.find(n => n.id === id)?.summary || '' }))
  .sort((a, b) => b.fanOut - a.fanOut)
  .slice(0, 20);

// C. Entry Point Candidates
const entryCandidates = [];
for (const node of nodes) {
  if (node.type !== 'file' && node.type !== 'document') continue;
  
  let score = 0;
  const name = basename(node.filePath || node.id);
  
  // Documentation at root
  if (node.type === 'document') {
    if (name === 'README.md' && !node.filePath.includes('/')) score += 5;
    else if (name.endsWith('.md') && !node.filePath.includes('/')) score += 2;
  }
  
  // Code entry points
  const entryPatterns = ['index.ts', 'index.js', 'main.ts', 'main.js', 'app.ts', 'app.js', 'server.ts', 'server.js', 'mod.rs', 'main.go', 'main.py', 'main.rs', 'manage.py', 'app.py', 'wsgi.py', 'asgi.py', 'run.py', '__main__.py', 'Application.java', 'Main.java', 'Program.cs', 'config.ru', 'index.php', 'App.swift', 'Application.kt', 'main.cpp', 'main.c', 'loader_exe.c', 'loader_lib.c', 'julia.expmap.in'];
  
  if (entryPatterns.some(p => name === p || name.startsWith(p.replace('.', '')))) score += 3;
  
  // At root or one level deep
  const pathDepth = (node.filePath || '').split('/').filter(Boolean).length;
  if (pathDepth <= 1) score += 1;
  
  // High fan-out
  const fo = fanOut[node.id] || 0;
  const foThreshold = fanOutRanking[0]?.fanOut || 0;
  if (fo > foThreshold * 0.1) score += 1;
  
  // Low fan-in
  const fi = fanIn[node.id] || 0;
  const fiValues = Object.values(fanIn).sort((a, b) => a - b);
  const fiThreshold = fiValues[Math.floor(fiValues.length * 0.25)];
  if (fi < fiThreshold) score += 1;
  
  if (score > 0) {
    entryCandidates.push({ id: node.id, score, name: node.name, summary: node.summary });
  }
}
entryCandidates.sort((a, b) => b.score - a.score);

// D. BFS from top code entry point
const codeEntry = entryCandidates.find(c => c.id.startsWith('file:')) || entryCandidates[0];
const bfsTraversal = { startNode: codeEntry?.id || '', order: [], depthMap: {}, byDepth: {} };
if (codeEntry) {
  const visited = new Set();
  const queue = [{ node: codeEntry.id, depth: 0 }];
  visited.add(codeEntry.id);
  
  while (queue.length > 0) {
    const { node, depth } = queue.shift();
    bfsTraversal.order.push(node);
    bfsTraversal.depthMap[node] = depth;
    if (!bfsTraversal.byDepth[depth]) bfsTraversal.byDepth[depth] = [];
    bfsTraversal.byDepth[depth].push(node);
    
    const neighbors = adjacency[node] || [];
    for (const { target, type } of neighbors) {
      if (!visited.has(target) && (type === 'imports' || type === 'calls')) {
        visited.add(target);
        queue.push({ node: target, depth: depth + 1 });
      }
    }
  }
}

// E. Non-Code File Inventory
const nonCodeFiles = { documentation: [], infrastructure: [], data: [], config: [] };
for (const node of nodes) {
  const info = { id: node.id, name: node.name, type: node.type, summary: node.summary };
  if (node.type === 'document') nonCodeFiles.documentation.push(info);
  else if (['service', 'pipeline', 'resource'].includes(node.type)) nonCodeFiles.infrastructure.push(info);
  else if (['table', 'schema', 'endpoint'].includes(node.type)) nonCodeFiles.data.push(info);
  else if (node.type === 'config') nonCodeFiles.config.push(info);
}

// F. Tightly Coupled Clusters
const clusters = [];
const edgeSet = new Set(edges.map(e => `${e.source}->${e.target}:${e.type}`));
for (const edge of edges) {
  if (edge.type === 'imports' || edge.type === 'calls') {
    const reverseKey = `${edge.target}->${edge.source}:${edge.type}`;
    if (edgeSet.has(reverseKey)) {
      const cluster = [edge.source, edge.target];
      for (const n of nodes) {
        if (cluster.includes(n.id)) continue;
        const connectsToBoth = 
          edgeSet.has(`${n.id}->${edge.source}:${edge.type}`) && edgeSet.has(`${edge.source}->${n.id}:${edge.type}`) ||
          edgeSet.has(`${n.id}->${edge.target}:${edge.type}`) && edgeSet.has(`${edge.target}->${n.id}:${edge.type}`);
        if (connectsToBoth) cluster.push(n.id);
      }
      if (cluster.length >= 2 && cluster.length <= 5) {
        clusters.push({ nodes: cluster, edgeCount: edges.filter(e => cluster.includes(e.source) && cluster.includes(e.target)).length });
      }
    }
  }
}
const uniqueClusters = [];
for (const c of clusters) {
  const sorted = c.nodes.sort().join(',');
  if (!uniqueClusters.find(uc => uc.nodes.sort().join(',') === sorted)) {
    uniqueClusters.push(c);
  }
}
uniqueClusters.sort((a, b) => b.edgeCount - a.edgeCount);

// G. Layer List
const layerList = layers.map(l => ({ id: l.id, name: l.name, description: l.description }));

// H. Node Summary Index
const nodeSummaryIndex = {};
for (const node of nodes) {
  nodeSummaryIndex[node.id] = { name: node.name, type: node.type, summary: node.summary };
}

const output = {
  scriptCompleted: true,
  entryPointCandidates: entryCandidates.slice(0, 5),
  fanInRanking: fanInRanking,
  fanOutRanking: fanOutRanking,
  bfsTraversal: bfsTraversal,
  nonCodeFiles: nonCodeFiles,
  clusters: uniqueClusters.slice(0, 10),
  layers: { count: layers.length, list: layerList },
  nodeSummaryIndex: nodeSummaryIndex,
  totalNodes: nodes.length,
  totalEdges: edges.length
};

writeFileSync(outputPath, JSON.stringify(output, null, 2));