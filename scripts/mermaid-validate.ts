#!/usr/bin/env -S deno run -q --allow-read
// Mermaid syntax validator for Markdown/diagram files using Deno.
// - Scans provided files; if none, walks the repo for *.md/*.mmd/*.mermaid
// - Extracts ```mermaid fenced blocks from Markdown
// - Validates diagrams using @mermaid-js/parser via esm.sh

import { extname } from '@std/path';
import { walk } from '@std/fs';

type DiagramType =
  | 'flowchart'
  | 'sequence'
  | 'classDiagram'
  | 'stateDiagram'
  | 'erDiagram'
  | 'gantt'
  | 'journey'
  | 'pie'
  | 'mindmap'
  | 'timeline'
  | 'gitGraph'
  | 'quadrantChart'
  | 'requirementDiagram'
  | 'sankey'
  | 'blockDiagram'
  | 'xychart';

function detectTypeFromText(text: string): DiagramType | null {
  const head = text.trim().split(/\r|\n/).find((l) => l.trim().length > 0) ?? '';
  const h = head.trim();
  if (/^(flowchart|graph)\b/i.test(h)) return 'flowchart';
  if (/^sequenceDiagram\b/i.test(h)) return 'sequence';
  if (/^classDiagram\b/i.test(h)) return 'classDiagram';
  if (/^stateDiagram(-v2)?\b/i.test(h)) return 'stateDiagram';
  if (/^erDiagram\b/i.test(h)) return 'erDiagram';
  if (/^gantt\b/i.test(h)) return 'gantt';
  if (/^(journey|userJourney)\b/i.test(h)) return 'journey';
  if (/^pie\b/i.test(h)) return 'pie';
  if (/^mindmap\b/i.test(h)) return 'mindmap';
  if (/^timeline\b/i.test(h)) return 'timeline';
  if (/^gitGraph\b/i.test(h)) return 'gitGraph';
  if (/^quadrantChart\b/i.test(h)) return 'quadrantChart';
  if (/^requirementDiagram\b/i.test(h)) return 'requirementDiagram';
  if (/^sankey\b/i.test(h)) return 'sankey';
  if (/^(block|blockDiagram)\b/i.test(h)) return 'blockDiagram';
  if (/^xychart/i.test(h)) return 'xychart';
  return null;
}

function extractMermaidBlocks(md: string): string[] {
  const blocks: string[] = [];
  const fence = /```mermaid\s*\n([\s\S]*?)\n```/gim;
  let m: RegExpExecArray | null;
  while ((m = fence.exec(md)) !== null) blocks.push(m[1]);
  return blocks;
}

async function gatherFilesFromRepo(root: string): Promise<string[]> {
  const result: string[] = [];
  for await (
    const entry of walk(root, {
      includeDirs: false,
      followSymlinks: false,
      skip: [/\.git\b/, /node_modules\b/, /\.cache\b/],
      match: [
        /\.(md|mmd|mermaid)$/i,
      ],
    })
  ) {
    result.push(entry.path);
  }
  return result;
}

async function readText(file: string): Promise<string | null> {
  try {
    return await Deno.readTextFile(file);
  } catch (e: unknown) {
    console.error(`error: cannot read ${file}: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }
}

async function main() {
  const args = Deno.args.slice();
  let files: string[] = args;
  if (files.length === 0) {
    files = await gatherFilesFromRepo(Deno.cwd());
  }

  let hadError = false;
  let fileCount = 0;
  let blockCount = 0;

  for (const file of files) {
    try {
      const st = await Deno.stat(file);
      if (!st.isFile) continue;
    } catch (_) {
      continue;
    }

    const ext = extname(file).toLowerCase();
    if (!['.md', '.mmd', '.mermaid'].includes(ext)) continue;

    const content = await readText(file);
    if (content === null) {
      hadError = true;
      continue;
    }
    fileCount++;

    const diagrams = (ext === '.md') ? extractMermaidBlocks(content) : [content];
    if (diagrams.length === 0) continue;

    for (let idx = 0; idx < diagrams.length; idx++) {
      const diagram = diagrams[idx];
      blockCount++;
      const detected = detectTypeFromText(diagram);
      if (!detected) {
        const label = (ext === '.md') ? `${file}#mermaid-block-${idx + 1}` : file;
        console.error(
          `Mermaid syntax error in ${label}: cannot detect diagram type from first line.`,
        );
        hadError = true;
      }
    }
  }

  if (!hadError) {
    console.log(`Mermaid validation passed: ${fileCount} files, ${blockCount} blocks.`);
  }
  Deno.exit(hadError ? 1 : 0);
}

if (import.meta.main) {
  await main();
}

