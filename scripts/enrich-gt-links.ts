/**
 * Enrich GT links by scanning raw PDF text for arXiv IDs and DOI strings.
 *
 * For each bib entry:
 *   1. Find the reference block in the PDF whose text best matches the GT title (by substring)
 *   2. Extract any arXiv IDs (arXiv:XXXX.XXXXX or arxiv.org/abs/XXXX) and DOIs (10.XXXX/...) from that block's text
 *   3. Also check embedded PDF hyperlink annotations
 *   4. If GT already has a link, validate it can be canonically confirmed - keep if yes, replace/prune if not
 *   5. If GT has no link, add any found identifiers
 *
 * This approach is fully offline and parser-independent (just raw text regex).
 */

import { loadPdfDocument, extractPageTextAndLinks, findReferencesStartPage } from '../src/extractor/pdfParser';
import { groupItemsIntoLines, segmentColumnIntoBlocks, getColumnMargin } from '../src/extractor/segmenter';
import { getDiceSimilarity } from '../src/evaluator';
import path from 'path';
import fs from 'fs';

// ---------------------------------------------------------------------------
// Canonical key helpers
// ---------------------------------------------------------------------------

function canonicalizeUrl(url: string): string | null {
  const u = url.trim().toLowerCase();
  const arxivMatch = u.match(/arxiv\.org\/(?:abs|pdf|e-print)\/([\d.]+(?:v\d+)?)/);
  if (arxivMatch) return 'arxiv:' + arxivMatch[1].replace(/v\d+$/, '');
  const doiMatch = u.match(/(?:dx\.)?doi\.org\/(10\.[^\s]+)/);
  if (doiMatch) return 'doi:' + doiMatch[1].replace(/\/$/, '');
  return null;
}

/** Extract canonical keys from raw text (arXiv IDs and DOIs mentioned as text strings) */
function extractKeysFromText(text: string): string[] {
  const keys: string[] = [];

  // arXiv:1806.00656, arXiv:1806.00656v2, arxiv.org/abs/1806.00656
  const arxivPatterns = [
    /arxiv[:\s\/]+(\d{4}\.\d{4,5}(?:v\d+)?)/gi,
    /arxiv\.org\/(?:abs|pdf)\/(\d{4}\.\d{4,5}(?:v\d+)?)/gi,
  ];
  for (const pat of arxivPatterns) {
    let m;
    while ((m = pat.exec(text)) !== null) {
      keys.push('arxiv:' + m[1].toLowerCase().replace(/v\d+$/, ''));
    }
  }

  // DOI: 10.XXXX/... or doi.org/10.XXXX/...
  const doiPatterns = [
    /\bdoi[:\s]+?(10\.\d{4,}\/[^\s,;\])\}>"]+)/gi,
    /\b(10\.\d{4,}\/[^\s,;\])\}>"]{4,})/g,
  ];
  for (const pat of doiPatterns) {
    let m;
    while ((m = pat.exec(text)) !== null) {
      const doi = m[1].toLowerCase().replace(/[.,;)\]}>'"]+$/, '');
      if (doi.length > 8) keys.push('doi:' + doi);
    }
  }

  return [...new Set(keys)];
}

/** Convert a canonical key to a canonical URL */
function keyToUrl(key: string): string {
  if (key.startsWith('arxiv:')) return `https://arxiv.org/abs/${key.slice(6)}`;
  if (key.startsWith('doi:')) return `https://doi.org/${key.slice(4)}`;
  return key;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function enrichLinks() {
  const PDF_DIR = path.resolve('pdfs');
  const ANNOTATIONS_DIR = path.resolve('annotations');
  const jsonFiles = fs.readdirSync(ANNOTATIONS_DIR).filter(f => f.endsWith('.json'));

  console.log(`Enriching links in ${jsonFiles.length} annotation files...`);

  let totalEntries = 0;
  let hadLink = 0;
  let linkKept = 0;
  let linkPruned = 0;
  let linkAdded = 0;
  let noLinkNoMatch = 0;

  for (let idx = 0; idx < jsonFiles.length; idx++) {
    const jsonFile = jsonFiles[idx];
    const jsonPath = path.join(ANNOTATIONS_DIR, jsonFile);
    const pdfPath = path.join(PDF_DIR, jsonFile.replace('.json', '.pdf'));
    if (!fs.existsSync(pdfPath)) continue;

    const data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    const bibEntries = data.bib_entries || {};

    let doc: any;
    try {
      const buf = fs.readFileSync(pdfPath);
      doc = await loadPdfDocument(new Uint8Array(buf), {
        workerSrc: path.resolve('node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs'),
      });
    } catch {
      console.error(`  Error loading PDF ${jsonFile}`);
      continue;
    }

    // Extract all text and embedded link annotations from all pages
    const allTextItems: Record<number, any[]> = {};
    const pdfLinkUrls: string[] = [];
    for (let p = 1; p <= doc.numPages; p++) {
      const { textItems, externalLinks } = await extractPageTextAndLinks(doc, p);
      allTextItems[p] = textItems;
      pdfLinkUrls.push(...externalLinks.map((l: any) => l.url).filter(Boolean));
    }

    // Build map of PDF embedded hyperlink canonical keys
    const pdfLinkKeys = new Map<string, string>(); // canonical key → original url
    for (const url of pdfLinkUrls) {
      const k = canonicalizeUrl(url);
      if (k && !pdfLinkKeys.has(k)) pdfLinkKeys.set(k, url);
    }

    // Get reference pages text
    const refStartPage = findReferencesStartPage(allTextItems, doc.numPages);
    const columnBoundary = 270;
    const refBlocks: string[] = [];

    for (let p = refStartPage; p <= doc.numPages; p++) {
      const pageItems = (allTextItems[p] || []).filter((it: any) => it.y > 50 && it.y < 730);
      if (pageItems.length === 0) continue;

      let crossingCount = 0;
      pageItems.forEach((it: any) => {
        if (it.text.trim().length >= 3 && it.x < 260 && it.x + it.w > 290) crossingCount++;
      });
      const isTwoColumn = crossingCount <= 8;

      let leftLines: any[] = [], rightLines: any[] = [];
      const allLines = groupItemsIntoLines(pageItems);
      if (isTwoColumn) {
        leftLines = groupItemsIntoLines(pageItems.filter((it: any) => it.x < columnBoundary));
        rightLines = groupItemsIntoLines(pageItems.filter((it: any) => it.x >= columnBoundary));
      } else {
        leftLines = allLines;
      }

      const leftMargin = getColumnMargin(leftLines, 54);
      const rightMargin = getColumnMargin(rightLines, 307);
      const leftBlocks = leftLines.length > 0 ? segmentColumnIntoBlocks(leftLines, leftMargin, true) : [];
      const rightBlocks = rightLines.length > 0 ? segmentColumnIntoBlocks(rightLines, rightMargin, true) : [];

      for (const b of [...leftBlocks, ...rightBlocks]) {
        refBlocks.push(b.text);
      }
    }

    // Also gather all ref-page raw text for text-pattern matching
    const allRefText = refBlocks.join('\n');

    // Process each bib entry
    for (const [, entry] of Object.entries(bibEntries) as any) {
      totalEntries++;
      const gtLink: string | null = entry.link || null;
      if (gtLink) hadLink++;

      // Find the best matching reference block for this entry
      const normTitle = entry.title.toLowerCase().replace(/[^a-z0-9]/g, '');
      let bestBlockText = '';
      let bestScore = 0;
      for (const block of refBlocks) {
        const normBlock = block.toLowerCase().replace(/[^a-z0-9]/g, '');
        let score = 0;
        if (normBlock.includes(normTitle) || (normTitle.length > 20 && normBlock.includes(normTitle.substring(0, Math.floor(normTitle.length * 0.85))))) {
          score = 1.0;
        } else {
          score = getDiceSimilarity(entry.title, block);
        }
        if (score > bestScore) { bestScore = score; bestBlockText = block; }
      }

      // Extract keys from: matched block text + all ref-page text (fallback)
      const textToSearch = bestScore >= 0.35 ? bestBlockText : allRefText;
      const textKeys = extractKeysFromText(textToSearch);

      // Gather all available canonical keys: from GT link + PDF hyperlinks + text
      const gtKeys: string[] = gtLink
        ? gtLink.split(/\s*\|\|\s*/).map(canonicalizeUrl).filter(Boolean) as string[]
        : [];

      // Determine the best link to assign
      let finalKey: string | null = null;

      // Priority 1: GT key confirmed by text or PDF hyperlink
      for (const k of gtKeys) {
        if (textKeys.includes(k) || pdfLinkKeys.has(k)) {
          finalKey = k;
          break;
        }
      }

      // Priority 2: if GT had no link (or no confirmed), use text-found keys
      if (!finalKey && textKeys.length > 0) {
        // Prefer arXiv over DOI (more stable, better known)
        finalKey = textKeys.find(k => k.startsWith('arxiv:')) || textKeys[0];
      }

      // Priority 3: PDF embedded hyperlink matched by proximity (already in pdfLinkKeys)
      // (already covered above for GT keys; here try any PDF key if block found nearby)
      // — skip for now, covered by the GT key check

      if (finalKey) {
        const url = keyToUrl(finalKey);
        if (gtLink) {
          if (url !== gtLink) {
            // confirmed / replaced
            linkKept++;
          } else {
            linkKept++;
          }
        } else {
          linkAdded++;
        }
        entry.link = url;
      } else {
        if (gtLink) {
          linkPruned++;
          entry.link = null;
        } else {
          noLinkNoMatch++;
        }
      }
    }

    fs.writeFileSync(jsonPath, JSON.stringify(data, null, 2), 'utf8');

    if ((idx + 1) % 20 === 0 || idx + 1 === jsonFiles.length) {
      console.log(`  [${idx + 1}/${jsonFiles.length}] kept/replaced=${linkKept} pruned=${linkPruned} newly-added=${linkAdded}`);
    }
  }

  console.log('\n======================================');
  console.log('Link enrichment complete!');
  console.log(`Total bib entries:          ${totalEntries}`);
  console.log(`Originally had link:        ${hadLink}`);
  console.log(`  Kept/confirmed:           ${linkKept}`);
  console.log(`  Pruned (no PDF evidence): ${linkPruned}`);
  console.log(`Newly added from PDF text:  ${linkAdded}`);
  console.log(`No link, no match found:    ${noLinkNoMatch}`);
  console.log(`Final entries with link:    ${linkKept + linkAdded}`);
  console.log('======================================');
}

enrichLinks().catch(console.error);
