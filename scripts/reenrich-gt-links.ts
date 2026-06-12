/**
 * Re-enrich GT bib entry links using the same approach as rebuild-dataset.ts:
 *
 * 1. Collect all unique titles from all bib entries
 * 2. Scan the DBLP JSON once, matching titles by Dice similarity to get DOIs
 * 3. Batch query Semantic Scholar (500 at a time) with those DOIs to get ArXiv IDs
 * 4. Write links back to annotation files (arxiv preferred, doi as fallback)
 *
 * Much faster than per-title S2 searches: one DBLP scan + a few batch S2 calls.
 */

import path from 'path';
import fs from 'fs';

const DATASET_PATH = '/home/emil/.cache/kagglehub/datasets/mathurinache/citation-network-dataset/versions/1/dblp.v12.json';
const ANNOTATIONS_DIR = path.resolve('annotations');
const DICE_THRESHOLD = 0.85;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getBigrams(str: string): Set<string> {
  const s = str.toLowerCase().replace(/\s+/g, '');
  const b = new Set<string>();
  for (let i = 0; i < s.length - 1; i++) b.add(s.substring(i, i + 2));
  return b;
}

function getDice(a: string, b: string): number {
  const ba = getBigrams(a), bb = getBigrams(b);
  if (ba.size === 0 && bb.size === 0) return 1;
  if (ba.size === 0 || bb.size === 0) return 0;
  let inter = 0;
  for (const v of ba) if (bb.has(v)) inter++;
  return (2 * inter) / (ba.size + bb.size);
}

function delay(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function reenrich() {
  const jsonFiles = fs.readdirSync(ANNOTATIONS_DIR).filter(f => f.endsWith('.json'));
  console.log(`Scanning ${jsonFiles.length} annotation files for titles to enrich...`);

  // Step 1: Collect all titles that need enriching (no link yet)
  // Map: normalized title → [{ file, key, entry }]
  const titleIndex = new Map<string, { file: string; key: string; entry: any }[]>();

  for (const jsonFile of jsonFiles) {
    const jsonPath = path.join(ANNOTATIONS_DIR, jsonFile);
    const data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    for (const [key, entry] of Object.entries(data.bib_entries || {}) as any) {
      if (entry.link) continue; // already has one
      if (!entry.title || entry.title.startsWith('Unknown Reference')) continue;
      const norm = entry.title.toLowerCase().trim();
      if (!titleIndex.has(norm)) titleIndex.set(norm, []);
      titleIndex.get(norm)!.push({ file: jsonFile, key, entry });
    }
  }

  console.log(`Need to enrich ${titleIndex.size} unique titles (across all bib entries without links).`);

  // Step 2: Scan DBLP JSON once, match titles, collect DOIs
  // Map: normalized bib title → { doi, dblpTitle }
  const titleToDoi = new Map<string, { doi: string; dblpTitle: string }>();

  console.log('\nScanning DBLP JSON for matching DOIs (this takes a few minutes)...');
  const readline = require('readline');
  const fileStream = fs.createReadStream(DATASET_PATH);
  const stat = fs.statSync(DATASET_PATH);
  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

  let scanned = 0;
  let matched = 0;

  // Build a quick lookup: first token of each target title → normalized title
  // (to avoid running Dice on every DBLP record)
  const firstWordIndex = new Map<string, string[]>(); // first word → [norm titles]
  for (const norm of titleIndex.keys()) {
    const firstWord = norm.split(/\s+/)[0];
    if (firstWord.length < 3) continue;
    if (!firstWordIndex.has(firstWord)) firstWordIndex.set(firstWord, []);
    firstWordIndex.get(firstWord)!.push(norm);
  }

  for await (const line of rl) {
    scanned++;
    if (scanned % 1000000 === 0) {
      const pct = ((fileStream.bytesRead / stat.size) * 100).toFixed(1);
      console.log(`  Scanned ${(scanned/1e6).toFixed(1)}M lines (${pct}%) | matched ${matched}/${titleIndex.size} titles`);
      if (matched >= titleIndex.size) break;
    }

    let cleanLine = line.trim().replace(/^,/, '');
    if (!cleanLine || cleanLine === '[' || cleanLine === ']') continue;

    // Quick pre-filter: check if line might have a DOI and a title we care about
    if (!cleanLine.includes('"doi"') && !cleanLine.includes('"title"')) continue;

    let paper: any;
    try { paper = JSON.parse(cleanLine); } catch { continue; }

    if (!paper.title || !paper.doi) continue;
    const doi = typeof paper.doi === 'string' ? paper.doi.trim() : '';
    if (!doi) continue;

    const dblpNorm = paper.title.toLowerCase().trim();
    const firstWord = dblpNorm.split(/\s+/)[0];
    if (firstWord.length < 3) continue;

    // Check if this DBLP paper's first word matches any of our target first words
    const candidates = firstWordIndex.get(firstWord);
    if (!candidates) continue;

    for (const norm of candidates) {
      if (titleToDoi.has(norm)) continue; // already matched
      const sim = getDice(norm, dblpNorm);
      if (sim >= DICE_THRESHOLD) {
        titleToDoi.set(norm, { doi, dblpTitle: paper.title });
        matched++;
        break;
      }
    }
  }

  console.log(`\nDBLP scan complete. Matched ${matched} titles to DOIs.`);

  // Step 3: Batch query Semantic Scholar with DOIs
  const doiToLinks = new Map<string, { arxivId?: string; doi?: string }>();
  const allDois = [...new Set([...titleToDoi.values()].map(v => v.doi))];
  console.log(`\nQuerying Semantic Scholar for ${allDois.length} DOIs in batches of 500...`);

  const batchSize = 500;
  for (let i = 0; i < allDois.length; i += batchSize) {
    const chunk = allDois.slice(i, i + batchSize);
    const batchNum = Math.floor(i / batchSize) + 1;
    const totalBatches = Math.ceil(allDois.length / batchSize);
    console.log(`  Batch ${batchNum}/${totalBatches} (${chunk.length} DOIs)...`);

    try {
      const res = await fetch('https://api.semanticscholar.org/graph/v1/paper/batch?fields=title,externalIds', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0' },
        body: JSON.stringify({ ids: chunk.map(d => `DOI:${d}`) })
      });

      if (!res.ok) {
        console.warn(`  S2 batch error: ${res.status} ${res.statusText}`);
        await delay(3000);
        i -= batchSize; // retry
        continue;
      }

      const results = await res.json() as any[];
      for (let j = 0; j < chunk.length; j++) {
        const paper = results[j];
        if (paper?.externalIds) {
          doiToLinks.set(chunk[j], {
            arxivId: paper.externalIds.ArXiv,
            doi: paper.externalIds.DOI?.toLowerCase()
          });
        }
      }
    } catch (e) {
      console.error('  S2 batch error:', e);
    }

    await delay(1500);
  }

  // Step 4: Write links back to annotation files
  console.log('\nWriting enriched links back to annotation files...');
  let enriched = 0;
  let doiOnly = 0;
  let noResult = 0;

  // Load all files, apply links
  const fileCache = new Map<string, any>();
  for (const jsonFile of jsonFiles) {
    const jsonPath = path.join(ANNOTATIONS_DIR, jsonFile);
    fileCache.set(jsonFile, JSON.parse(fs.readFileSync(jsonPath, 'utf8')));
  }

  for (const [normTitle, refs] of titleIndex.entries()) {
    const doiMatch = titleToDoi.get(normTitle);
    if (!doiMatch) { noResult += refs.length; continue; }

    const s2Result = doiToLinks.get(doiMatch.doi);
    let link: string | null = null;
    if (s2Result?.arxivId) {
      link = `https://arxiv.org/abs/${s2Result.arxivId}`;
      enriched += refs.length;
    } else if (s2Result?.doi) {
      link = `https://doi.org/${s2Result.doi}`;
      doiOnly += refs.length;
    } else if (doiMatch.doi) {
      // DBLP had a DOI but S2 didn't return arXiv — use the DOI directly
      link = `https://doi.org/${doiMatch.doi.toLowerCase()}`;
      doiOnly += refs.length;
    } else {
      noResult += refs.length;
    }

    if (link) {
      for (const { file, key } of refs) {
        const data = fileCache.get(file);
        if (data?.bib_entries?.[key]) {
          data.bib_entries[key].link = link;
        }
      }
    }
  }

  // Save all files
  for (const jsonFile of jsonFiles) {
    const jsonPath = path.join(ANNOTATIONS_DIR, jsonFile);
    fs.writeFileSync(jsonPath, JSON.stringify(fileCache.get(jsonFile), null, 2), 'utf8');
  }

  console.log('\n======================================');
  console.log('Re-enrichment complete!');
  console.log(`Unique titles needing enrichment: ${titleIndex.size}`);
  console.log(`Matched in DBLP:                  ${matched}`);
  console.log(`  Got ArXiv link:                 ${enriched}`);
  console.log(`  Got DOI link only:              ${doiOnly}`);
  console.log(`  No S2 result:                   ${noResult}`);
  console.log('======================================');
}

reenrich().catch(console.error);
