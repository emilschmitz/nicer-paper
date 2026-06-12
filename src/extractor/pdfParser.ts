import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import { TextItem, LinkAnn, ExtractorOptions } from './types';
import { ExtractorConfig as ExtConfig } from './config';
import { groupItemsIntoLines } from './segmenter';

/**
 * Loads the PDF document using pdfjs-dist.
 */
export async function loadPdfDocument(
  pdfData: Uint8Array,
  options?: ExtractorOptions
): Promise<any> {
  if (options?.workerSrc) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = options.workerSrc;
  }
  return pdfjsLib.getDocument({ data: pdfData }).promise;
}

/**
 * Extracts raw text items and resolves link annotations for a single page.
 */
export async function extractPageTextAndLinks(
  doc: any,
  pageNum: number
): Promise<{ textItems: TextItem[]; externalLinks: LinkAnn[]; internalLinks: LinkAnn[] }> {
  const page = await doc.getPage(pageNum);
  const [textContent, annotations] = await Promise.all([
    page.getTextContent(),
    page.getAnnotations(),
  ]);
  
  const textItems: TextItem[] = textContent.items.map((item: any) => ({
    text: item.str,
    x: item.transform[4],
    y: item.transform[5],
    w: item.width,
    h: item.height,
  }));

  const externalLinks: LinkAnn[] = [];
  const internalLinks: LinkAnn[] = [];

  const links = annotations.filter((ann: any) => ann.subtype === 'Link');

  const linkPromises = links.map(async (link: any) => {
    if (link.url) {
      externalLinks.push({
        page: pageNum,
        rect: link.rect,
        url: link.url,
      });
    } else if (link.dest) {
      try {
        const dest = await doc.getDestination(link.dest);
        if (dest && dest[0]) {
          const targetPageIndex = await doc.getPageIndex(dest[0]);
          const targetPage = targetPageIndex + 1;
          
          let targetX = 0;
          let targetY = 0;
          const destType = dest[1] && dest[1].name;

          if (destType === 'XYZ') {
            targetX = typeof dest[2] === 'number' ? dest[2] : 0;
            targetY = typeof dest[3] === 'number' ? dest[3] : 0;
          } else if (destType === 'FitH' || destType === 'FitBH') {
            targetY = typeof dest[2] === 'number' ? dest[2] : 0;
            targetX = 0;
          } else if (destType === 'FitV' || destType === 'FitBV') {
            targetX = typeof dest[2] === 'number' ? dest[2] : 0;
            targetY = 0;
          } else if (destType === 'FitR') {
            targetX = typeof dest[2] === 'number' ? dest[2] : 0;
            targetY = typeof dest[5] === 'number' ? dest[5] : 0;
          } else {
            targetX = typeof dest[2] === 'number' ? dest[2] : 0;
            targetY = typeof dest[3] === 'number' ? dest[3] : 0;
          }

          internalLinks.push({
            page: pageNum,
            rect: link.rect,
            dest: typeof link.dest === 'string' ? link.dest : JSON.stringify(link.dest),
            targetPage,
            targetX,
            targetY,
          });
        }
      } catch (e) {
        // Fail silently on destination resolution error
      }
    }
  });

  await Promise.all(linkPromises);

  return { textItems, externalLinks, internalLinks };
}

/**
 * Finds the starting page index of the references section by scanning forward.
 */
export function findReferencesStartPage(
  allTextItems: { [pageNum: number]: TextItem[] },
  numPages: number
): number {
  const ratio = ExtConfig.PDF.REF_START_PAGE_RATIO;
  const minStartPage = Math.max(1, Math.floor(numPages * ratio));
  // Default to a safe fallback (the last 3 pages of the document)
  let refStartPage = Math.max(minStartPage, numPages - 2);

  for (let p = minStartPage; p <= numPages; p++) {
    const pageItems = allTextItems[p] || [];
    if (pageItems.length === 0) continue;

    // Group text items into lines to handle split tokens (e.g. "R EFERENCES")
    const lines = groupItemsIntoLines(pageItems);

    const hasHeader = lines.some(line => {
      const parts = line.text.split(/\s{2,}/);
      return parts.some(part => {
        const text = part.trim().toLowerCase();
        // Heuristic: headers are usually short
        if (text.length > 40) return false;

        // Strip spaces, numbers, punctuation
        const normalized = text.replace(/[\s\d\.\:\-\[\]\(\)]+/g, '');
        return normalized === 'references' || 
               normalized === 'bibliography' || 
               normalized === 'literaturecited' ||
               normalized === 'referencesandnotes' ||
               normalized === 'referencesandappendix';
      });
    });

    if (hasHeader) {
      refStartPage = p;
      break;
    }
  }
  return refStartPage;
}
