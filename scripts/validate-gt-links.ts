/**
 * Validate GT links against PDF text content.
 *
 * For each bib entry with a link:
 *   1. Canonicalize the GT link to an arxiv:<id> or doi:<id> key
 *   2. Scan ALL raw PDF text for that canonical key as a text string
 *   3. If found → keep the link
 *   4. If not found → set link to null (prune)
 *
 * No PDF block segmentation or parsing is involved — just raw text search.
 * Entries without a GT link are left untouched.
 */

import { loadPdfDocument, extractPageTextAndLinks } from '../src/extractor/pdfParser';
import path from 'path';
import fs from 'fs';

// ---------------------------------------------------------------------------
// Canonical key extraction
// ---------------------------------------------------------------------------

function canonicalizeUrl(url: string): string | null {
  const u = url.trim().toLowerCase();
  const arxivMatch = u.match(/arxiv\.org\/(?:abs|pdf|e-print)\/([\d.]+(?:v\d+)?)/);
  if (arxivMatch) return 'arxiv:' + arxivMatch[1].replace(/v\d+$/, '');
  const doiMatch = u.match(/(?:dx\.)?doi\.org\/(10\.[^\s]+)/);
  if (doiMatch) return 'doi:' + doiMatch[1].replace(/\/$/, '');
  return null;
}

/** Extract all canonical keys found as text anywhere in a string */
function extractKeysFromText(text: string): Set<string> {
  const keys = new Set<string>();
  const lower = text.toLowerCase();

  // arXiv:1806.00656, arXiv: 1806.00656v2, arxiv.org/abs/1806.00656, etc.
  const arxivRe = /arxiv[:\s\/]+(\d{4}\.\d{4,5}(?:v\d+)?)/gi;
  let m: RegExpExecArray | null;
  while ((m = arxivRe.exec(lower)) !== null) {
    keys.add('arxiv:' + m[1].replace(/v\d+$/, ''));
  }
  const arxivUrlRe = /arxiv\.org\/(?:abs|pdf)\/(\d{4}\.\d{4,5}(?:v\d+)?)/gi;
  while ((m = arxivUrlRe.exec(lower)) !== null) {
    keys.add('arxiv:' + m[1].replace(/v\d+$/, ''));
  }

  // DOI: 10.XXXX/... (standalone or after "doi:")
  const doiRe = /\b(10\.\d{4,}\/[^\s,;\])\}>"]{4,})/g;
  while ((m = doiRe.exec(lower)) !== null) {
    const doi = m[1].replace(/[.,;)\]}>'"]+$/, '');
    if (doi.length > 8) keys.add('doi:' + doi);
  }

  return keys;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function validateLinks() {
  const PDF_DIR = path.resolve('pdfs');
  const ANNOTATIONS_DIR = path.resolve('annotations');
  const jsonFiles = fs.readdirSync(ANNOTATIONS_DIR).filter(f => f.endsWith('.json'));

  console.log(`Validating links in ${jsonFiles.length} annotation files...`);

  let totalEntries = 0;
  let hadLink = 0;
  let kept = 0;
  let pruned = 0;
  let noCanonical = 0; // GT link present but couldn't canonicalize (e.g. random URL)

  for (let idx = 0; idx < jsonFiles.length; idx++) {
    const jsonFile = jsonFiles[idx];
    const jsonPath = path.join(ANNOTATIONS_DIR, jsonFile);
    const pdfPath = path.join(PDF_DIR, jsonFile.replace('.json', '.pdf'));
    if (!fs.existsSync(pdfPath)) continue;

    const data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    const bibEntries = data.bib_entries || {};

    // Quick check: any entries have links?
    const anyHasLink = Object.values(bibEntries).some((e: any) => e.link);
    if (!anyHasLink) {
      totalEntries += Object.keys(bibEntries).length;
      continue;
    }

    // Load PDF and get all raw text from every page
    let doc: any;
    try {
      const buf = fs.readFileSync(pdfPath);
      doc = await loadPdfDocument(new Uint8Array(buf), {
        workerSrc: path.resolve('node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs'),
      });
    } catch {
      console.error(`  Error loading ${jsonFile}`);
      continue;
    }

    let fullPdfText = '';
    for (let p = 1; p <= doc.numPages; p++) {
      const { textItems } = await extractPageTextAndLinks(doc, p);
      fullPdfText += textItems.map((t: any) => t.text).join(' ') + '\n';
    }

    // Extract all canonical keys present anywhere in the PDF text
    const pdfKeys = extractKeysFromText(fullPdfText);

    let changed = false;
    for (const [, entry] of Object.entries(bibEntries) as any) {
      totalEntries++;
      if (!entry.link) continue;
      hadLink++;

      // GT may have multiple links joined by ' || '
      const gtLinks: string[] = entry.link.split(/\s*\|\|\s*/);
      let confirmed = false;

      for (const gtLink of gtLinks) {
        const key = canonicalizeUrl(gtLink);
        if (!key) {
          // Can't canonicalize this URL type — leave it in place
          noCanonical++;
          confirmed = true;
          break;
        }
        if (pdfKeys.has(key)) {
          confirmed = true;
          // Normalize to single canonical URL
          entry.link = key.startsWith('arxiv:')
            ? `https://arxiv.org/abs/${key.slice(6)}`
            : `https://doi.org/${key.slice(4)}`;
          break;
        }
      }

      if (confirmed) {
        kept++;
      } else {
        entry.link = null;
        pruned++;
        changed = true;
      }
    }

    fs.writeFileSync(jsonPath, JSON.stringify(data, null, 2), 'utf8');

    if ((idx + 1) % 20 === 0 || idx + 1 === jsonFiles.length) {
      console.log(`  [${idx + 1}/${jsonFiles.length}] kept=${kept} pruned=${pruned}`);
    }
  }

  console.log('\n======================================');
  console.log('Link validation complete!');
  console.log(`Total bib entries:             ${totalEntries}`);
  console.log(`Had GT link:                   ${hadLink}`);
  console.log(`  Kept (found in PDF text):    ${kept}`);
  console.log(`  Pruned (absent from PDF):    ${pruned}`);
  console.log(`  Non-canonical URL (kept):    ${noCanonical}`);
  console.log(`Final entries with link:       ${kept}`);
  console.log('======================================');
}

validateLinks().catch(console.error);
