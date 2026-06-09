import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import { TextItem, LinkAnn, ExtractorOptions } from './types';

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
  const textContent = await page.getTextContent();
  
  const textItems: TextItem[] = textContent.items.map((item: any) => ({
    text: item.str,
    x: item.transform[4],
    y: item.transform[5],
    w: item.width,
    h: item.height,
  }));

  const externalLinks: LinkAnn[] = [];
  const internalLinks: LinkAnn[] = [];

  const annotations = await page.getAnnotations();
  const links = annotations.filter((ann: any) => ann.subtype === 'Link');

  for (const link of links) {
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
  }

  return { textItems, externalLinks, internalLinks };
}

/**
 * Finds the starting page index of the references section by scanning forward.
 */
export function findReferencesStartPage(
  allTextItems: { [pageNum: number]: TextItem[] },
  numPages: number
): number {
  let refStartPage = Math.max(1, Math.floor(numPages * 0.4));
  for (let p = Math.max(1, Math.floor(numPages * 0.4)); p <= numPages; p++) {
    const pageItems = allTextItems[p] || [];
    const hasHeader = pageItems.some(it => 
      /^\s*(\d+[\s\.]*)?(references|bibliography|literature cited)\s*$/i.test(it.text.trim())
    );
    if (hasHeader) {
      refStartPage = p;
      break;
    }
  }
  return refStartPage;
}
