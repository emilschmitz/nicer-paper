/**
 * Prune GT links that are not found in the corresponding PDF.
 *
 * Logic per GT entry with a link:
 *   1. Extract all embedded hyperlink URLs from the PDF.
 *   2. For each GT link, compute a canonical key (arxiv:<id> or doi:<id>).
 *   3. For each PDF link, compute the same canonical key.
 *   4. If any PDF link matches the GT canonical key → replace GT link with the PDF link.
 *   5. If no match found → set link to null (prune).
 *
 * Entries with no GT link are left untouched.
 */

import { loadPdfDocument, extractPageTextAndLinks } from '../src/extractor/pdfParser';
import path from 'path';
import fs from 'fs';

// ---------------------------------------------------------------------------
// Canonical key helpers
// ---------------------------------------------------------------------------

function canonicalizeUrl(url: string): string | null {
  const u = url.trim().toLowerCase();

  // ArXiv
  const arxivMatch = u.match(/arxiv\.org\/(?:abs|pdf|e-print)\/(\d{4}\.\d{4,5}(?:v\d+)?)/);
  if (arxivMatch) {
    // Strip version suffix so 2103.01234v2 == 2103.01234
    return 'arxiv:' + arxivMatch[1].replace(/v\d+$/, '');
  }

  // DOI
  const doiMatch = u.match(/(?:dx\.)?doi\.org\/(10\.\S+)/);
  if (doiMatch) {
    return 'doi:' + doiMatch[1].replace(/\/$/, '');
  }

  return null;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function pruneLinks() {
  const PDF_DIR = path.resolve('pdfs');
  const ANNOTATIONS_DIR = path.resolve('annotations');
  const jsonFiles = fs.readdirSync(ANNOTATIONS_DIR).filter(f => f.endsWith('.json'));

  console.log(`Processing ${jsonFiles.length} annotation files...`);

  let totalWithLink = 0;
  let totalKept = 0;
  let totalReplaced = 0;
  let totalPruned = 0;
  let totalNoLinkEntry = 0;

  for (let idx = 0; idx < jsonFiles.length; idx++) {
    const jsonFile = jsonFiles[idx];
    const jsonPath = path.join(ANNOTATIONS_DIR, jsonFile);
    const pdfPath = path.join(PDF_DIR, jsonFile.replace('.json', '.pdf'));

    if (!fs.existsSync(pdfPath)) continue;

    const data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    const bibEntries = data.bib_entries || {};

    // Check if any entry has a link before loading the PDF
    const anyHasLink = Object.values(bibEntries).some((e: any) => e.link);
    if (!anyHasLink) {
      totalNoLinkEntry += Object.keys(bibEntries).length;
      continue;
    }

    // Load PDF and collect all embedded hyperlinks
    let doc: any;
    try {
      const buf = fs.readFileSync(pdfPath);
      doc = await loadPdfDocument(new Uint8Array(buf), {
        workerSrc: path.resolve('node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs'),
      });
    } catch (e) {
      console.error(`  Error loading PDF ${jsonFile}:`, e);
      continue;
    }

    const pdfLinks: string[] = [];
    for (let p = 1; p <= doc.numPages; p++) {
      const { externalLinks } = await extractPageTextAndLinks(doc, p);
      for (const link of externalLinks) {
        if (link.url) pdfLinks.push(link.url);
      }
    }

    // Build a map: canonical key → first PDF URL with that key
    const pdfCanonicalMap = new Map<string, string>();
    for (const url of pdfLinks) {
      const key = canonicalizeUrl(url);
      if (key && !pdfCanonicalMap.has(key)) {
        pdfCanonicalMap.set(key, url);
      }
    }

    let changed = false;
    for (const [key, entry] of Object.entries(bibEntries) as any) {
      if (!entry.link) {
        totalNoLinkEntry++;
        continue;
      }

      // GT may have multiple links joined by ' || '
      const gtLinks: string[] = entry.link.split(/\s*\|\|\s*/);
      totalWithLink++;

      let matchedPdfUrl: string | null = null;

      for (const gtLink of gtLinks) {
        const gtKey = canonicalizeUrl(gtLink);
        if (gtKey && pdfCanonicalMap.has(gtKey)) {
          matchedPdfUrl = pdfCanonicalMap.get(gtKey)!;
          break;
        }
      }

      if (matchedPdfUrl) {
        if (matchedPdfUrl !== entry.link) {
          // Replace with the PDF's version of the link
          entry.link = matchedPdfUrl;
          totalReplaced++;
        } else {
          totalKept++;
        }
      } else {
        // No match in PDF → prune
        entry.link = null;
        totalPruned++;
        changed = true;
      }

      if (matchedPdfUrl !== null && matchedPdfUrl !== (entry.link ?? null)) {
        changed = true;
      }
    }

    fs.writeFileSync(jsonPath, JSON.stringify(data, null, 2), 'utf8');

    if ((idx + 1) % 20 === 0) {
      console.log(`  [${idx + 1}/${jsonFiles.length}] kept=${totalKept} replaced=${totalReplaced} pruned=${totalPruned}`);
    }
  }

  console.log('\n======================================');
  console.log('Link pruning complete!');
  console.log(`Entries with no GT link (untouched): ${totalNoLinkEntry}`);
  console.log(`GT links checked:                    ${totalWithLink}`);
  console.log(`  Kept as-is (exact match):          ${totalKept}`);
  console.log(`  Replaced with PDF link (same paper): ${totalReplaced}`);
  console.log(`  Pruned (not in PDF):               ${totalPruned}`);
  console.log('======================================');
}

pruneLinks().catch(console.error);
