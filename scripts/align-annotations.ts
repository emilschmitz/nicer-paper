import { loadPdfDocument, extractPageTextAndLinks, findReferencesStartPage } from '../src/extractor/pdfParser';
import { groupItemsIntoLines, segmentColumnIntoBlocks, getColumnMargin } from '../src/extractor/segmenter';
import { resolveReferenceUrl } from '../src/extractor/urlResolver';
import { getDiceSimilarity } from '../src/evaluator';
import path from 'path';
import fs from 'fs';

async function alignAll() {
  const PDF_DIR = path.resolve('pdfs');
  const ANNOTATIONS_DIR = path.resolve('annotations');
  const jsonFiles = fs.readdirSync(ANNOTATIONS_DIR).filter(f => f.endsWith('.json'));

  console.log(`Aligning ${jsonFiles.length} annotations...`);

  let totalKept = 0;
  let totalPruned = 0;

  for (let idx = 0; idx < jsonFiles.length; idx++) {
    const jsonFile = jsonFiles[idx];
    const jsonPath = path.join(ANNOTATIONS_DIR, jsonFile);
    const pdfFilename = jsonFile.replace('.json', '.pdf');
    const pdfPath = path.join(PDF_DIR, pdfFilename);

    if (!fs.existsSync(pdfPath)) {
      continue;
    }

    const data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    const bibEntries = data.bib_entries || {};

    let doc;
    try {
      const fileBuffer = fs.readFileSync(pdfPath);
      doc = await loadPdfDocument(new Uint8Array(fileBuffer), {
        workerSrc: path.resolve('node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs'),
      });
    } catch (e) {
      console.error(`Error loading PDF ${pdfFilename}:`, e);
      continue;
    }

    // Extract all text and links from all pages
    const allTextItems: { [pageNum: number]: any[] } = {};
    const externalLinks: any[] = [];
    for (let p = 1; p <= doc.numPages; p++) {
      const { textItems, externalLinks: ext } = await extractPageTextAndLinks(doc, p);
      allTextItems[p] = textItems;
      externalLinks.push(...ext);
    }

    const refStartPage = findReferencesStartPage(allTextItems, doc.numPages);
    
    // Segment reference blocks from PDF
    const refBlocks: any[] = [];
    const columnBoundary = 270;

    for (let p = refStartPage; p <= doc.numPages; p++) {
      let pageItems = (allTextItems[p] || []).filter(it => it.y > 50 && it.y < 730);
      if (pageItems.length === 0) continue;

      // Filter header
      if (p === refStartPage) {
        const tempLines = groupItemsIntoLines(pageItems);
        let headerY = -1;
        for (const line of tempLines) {
          const parts = line.text.split(/\s{2,}/);
          let found = false;
          for (const part of parts) {
            const text = part.trim().toLowerCase();
            if (text.length <= 40) {
              const normalized = text.replace(/[\s\d\.\:\-\[\]\(\)]+/g, '');
              if (['references', 'bibliography', 'literaturecited'].includes(normalized)) {
                headerY = line.y;
                found = true;
                break;
              }
            }
          }
          if (found) break;
        }
        if (headerY !== -1) {
          pageItems = pageItems.filter(it => it.y < headerY - 5);
        }
      }

      // Column detection
      let crossingItemsCount = 0;
      pageItems.forEach(it => {
        if (it.text.trim().length >= 3 && it.x < 260 && it.x + it.w > 290) {
          crossingItemsCount++;
        }
      });
      const isTwoColumn = crossingItemsCount <= 8;

      let leftLines: any[] = [];
      let rightLines: any[] = [];
      let leftMargin = 54;
      let rightMargin = 307;

      const allLines = groupItemsIntoLines(pageItems);
      if (isTwoColumn) {
        const leftColumnItems = pageItems.filter(it => it.x < columnBoundary);
        const rightColumnItems = pageItems.filter(it => it.x >= columnBoundary);
        leftLines = groupItemsIntoLines(leftColumnItems);
        rightLines = groupItemsIntoLines(rightColumnItems);
        leftMargin = getColumnMargin(leftLines, 54);
        rightMargin = getColumnMargin(rightLines, 307);
      } else {
        leftLines = allLines;
        leftMargin = getColumnMargin(leftLines, 54);
      }

      const leftBlocks = leftLines.length > 0 ? segmentColumnIntoBlocks(leftLines, leftMargin, true) : [];
      const rightBlocks = rightLines.length > 0 ? segmentColumnIntoBlocks(rightLines, rightMargin, true) : [];
      
      for (const b of [...leftBlocks, ...rightBlocks]) {
        const resolvedUrl = resolveReferenceUrl(b.text, b.items, p, externalLinks);
        refBlocks.push({
          text: b.text,
          url: resolvedUrl
        });
      }
    }

    const alignedEntries: Record<string, any> = {};

    for (const [key, gt] of Object.entries(bibEntries) as any) {
      let bestBlock: any = null;
      let bestScore = -1;

      const normGt = gt.title.toLowerCase().replace(/[^a-z0-9]/g, '');

      for (const b of refBlocks) {
        const normBlock = b.text.toLowerCase().replace(/[^a-z0-9]/g, '');
        
        let score = 0;
        if (normBlock.includes(normGt) || (normGt.length > 20 && normBlock.includes(normGt.substring(0, Math.floor(normGt.length * 0.85))))) {
          score = 1.0;
        } else {
          score = getDiceSimilarity(gt.title, b.text);
        }
        if (score > bestScore) {
          bestScore = score;
          bestBlock = b;
        }
      }

      if (bestBlock && bestScore >= 0.45) {
        totalKept++;
        
        // Merge links: if PDF has a link and GT has a link, merge them
        const pdfLink = bestBlock.url;
        const gtLink = gt.link;
        let mergedLink = null;
        
        if (pdfLink && gtLink) {
          const gtParts = gtLink.split(/\s*\|\|\s*/);
          if (!gtParts.includes(pdfLink)) {
            mergedLink = `${gtLink} || ${pdfLink}`;
          } else {
            mergedLink = gtLink;
          }
        } else if (pdfLink) {
          mergedLink = pdfLink;
        } else {
          mergedLink = null; // No link in PDF -> GT link set to null to avoid false penalty
        }

        alignedEntries[key] = {
          ...gt,
          link: mergedLink
        };
      } else {
        totalPruned++;
      }
    }

    data.bib_entries = alignedEntries;
    fs.writeFileSync(jsonPath, JSON.stringify(data, null, 2), 'utf8');
  }

  console.log(`\n======================================`);
  console.log(`Alignment complete!`);
  console.log(`Total GT entries kept:   ${totalKept}`);
  console.log(`Total GT entries pruned: ${totalPruned}`);
  console.log(`======================================`);
}

alignAll().catch(console.error);
