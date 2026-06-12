import { loadPdfDocument, extractPageTextAndLinks, findReferencesStartPage } from './pdfParser';
import { groupItemsIntoLines, getColumnMargin, segmentColumnIntoBlocks } from './segmenter';
import { resolveReferenceUrl } from './urlResolver';
import { parseRegexHeuristics } from './parser';
import { 
  ExtractorOptions, 
  ExtractorOutput, 
  TextItem, 
  LinkAnn, 
  RefBlock, 
  Citation, 
  InlineLink,
  validateCitation,
  validateInlineLink,
} from './types';

/**
 * Main API: Extracts structured citations and inline clickable links from PDF buffer.
 */
export async function extractCitationsFromPdf(
  pdfData: Uint8Array,
  options?: ExtractorOptions
): Promise<ExtractorOutput> {
  const doc = await loadPdfDocument(pdfData, options);
  const numPages = doc.numPages;

  const allTextItems: { [pageNum: number]: TextItem[] } = {};
  const externalLinks: LinkAnn[] = [];
  const internalLinks: LinkAnn[] = [];

  // 1. Pass: Extract text items and links in parallel
  let completedPages = 0;
  const pagePromises = Array.from({ length: numPages }, (_, i) => i + 1).map(async (p) => {
    const data = await extractPageTextAndLinks(doc, p);
    completedPages++;
    if (options?.onProgress) {
      options.onProgress(Math.round((completedPages / numPages) * 100));
    }
    return data;
  });
  const pagesData = await Promise.all(pagePromises);
  
  pagesData.forEach(({ textItems, externalLinks: ext, internalLinks: int }, index) => {
    const p = index + 1;
    allTextItems[p] = textItems;
    externalLinks.push(...ext);
    internalLinks.push(...int);
  });


  // 2. Identify references section start page
  const refStartPage = findReferencesStartPage(allTextItems, numPages);

  // 3. Reconstruct reference blocks from references pages
  const refBlocks: RefBlock[] = [];
  const columnBoundary = options?.columnSplitBoundary ?? 270;

  for (let p = refStartPage; p <= numPages; p++) {
    const pageItems = (allTextItems[p] || []).filter(it => it.y > 50 && it.y < 730);
    if (pageItems.length === 0) continue;

    // Partition text items first by column boundary
    const leftColumnItems = pageItems.filter(it => it.x < columnBoundary);
    const rightColumnItems = pageItems.filter(it => it.x >= columnBoundary);

    // Group items into lines
    const leftLines = groupItemsIntoLines(leftColumnItems);
    const rightLines = groupItemsIntoLines(rightColumnItems);

    // Dynamic Margin Detection
    const leftMargin = getColumnMargin(leftLines, 54);
    const rightMargin = getColumnMargin(rightLines, 307);

    // Segment lines into reference blocks per column
    const leftBlocks = leftLines.length > 0 ? segmentColumnIntoBlocks(leftLines, leftMargin) : [];
    const rightBlocks = rightLines.length > 0 ? segmentColumnIntoBlocks(rightLines, rightMargin) : [];

    const pageBlocks = [...leftBlocks, ...rightBlocks];

    for (const b of pageBlocks) {
      // Resolve reference URL using modular strategies
      const resolvedUrl = resolveReferenceUrl(b.text, b.items, p, externalLinks, options?.strategies);

      refBlocks.push({
        page: p,
        startY: b.startY,
        text: b.text,
        items: b.items,
        extractedUrl: resolvedUrl,
      });
    }
  }

  // 4. Map inline links (internal links) to reference blocks and construct output
  const citations: Citation[] = [];
  const inlineLinks: InlineLink[] = [];

  // Populate citations array with Zod validation
  for (const block of refBlocks) {
    const citObj = {
      text: block.text,
      url: block.extractedUrl,
      page: block.page,
      startY: block.startY,
    };
    
    // Validate with modular Zod validator
    citations.push(validateCitation(citObj));
  }

  // Populate inline links array with Zod validation
  for (const link of internalLinks) {
    if (link.dest && link.targetPage && link.targetPage >= refStartPage) {
      const pageBlocks = refBlocks.filter(b => b.page === link.targetPage);
      if (pageBlocks.length === 0) continue;

      let bestBlock: RefBlock | null = null;
      let minDistance = Infinity;

      for (const block of pageBlocks) {
        const dist = Math.abs(block.startY - link.targetY!);
        if (dist < minDistance && dist < 45) { // within ~3 lines height
          minDistance = dist;
          bestBlock = block;
        }
      }

      let targetMetadata = null;
      if (bestBlock) {
        const meta = parseRegexHeuristics(bestBlock.text);
        targetMetadata = {
          authors: (meta.authors && meta.authors.length > 0) ? meta.authors : null,
          title: meta.title || null,
          venue: meta.venue || null,
          year: meta.year || null,
        };
      }

      const linkObj = {
        sourcePage: link.page,
        sourceRect: link.rect,
        destName: link.dest,
        targetUrl: bestBlock ? bestBlock.extractedUrl : null,
        targetMetadata: targetMetadata,
      };

      // Validate with modular Zod validator
      inlineLinks.push(validateInlineLink(linkObj));
    }
  }

  return {
    citations,
    inlineLinks,
    linkCount: {
      total: externalLinks.length + internalLinks.length,
      internal: internalLinks.length,
      external: externalLinks.length,
    },
  };
}

export * from './types';
export * from './urlResolver';
export { loadPdfDocument } from './pdfParser';
export { ExtractorConfig } from './config';

