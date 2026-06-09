import { TextItem, LinkAnn, LinkExtractorStrategy } from './types';
import { validateUrl } from './validator';

// Check 2D bounding box intersection (overlap)
export function boxesOverlap(
  ax1: number, ay1: number, ax2: number, ay2: number,
  bx1: number, by1: number, bx2: number, by2: number
): boolean {
  return ax1 < bx2 && ax2 > bx1 && ay1 < by2 && ay2 > by1;
}

/**
 * Checks if a blockItem overlaps with any external annotation.
 */
export function findOverlappingAnnotation(
  blockItems: TextItem[],
  pageNum: number,
  externalLinks: LinkAnn[],
  filterFn?: (url: string) => boolean
): string | null {
  const pageExtLinks = externalLinks.filter(el => el.page === pageNum);
  for (const el of pageExtLinks) {
    if (!el.url) continue;
    if (filterFn && !filterFn(el.url)) continue;

    const overlaps = blockItems.some(it => {
      const itX1 = it.x;
      const itY1 = it.y;
      const itX2 = it.x + it.w;
      const itY2 = it.y + it.h;
      
      const elX1 = el.rect[0];
      const elY1 = el.rect[1];
      const elX2 = el.rect[2];
      const elY2 = el.rect[3];
      
      return boxesOverlap(itX1, itY1, itX2, itY2, elX1, elY1, elX2, elY2);
    });

    if (overlaps) {
      const resolved = validateUrl(el.url);
      if (resolved) return resolved;
    }
  }
  return null;
}

/**
 * ArxivStrategy: prioritizes arXiv format, maps it to a valid https://arxiv.org/abs/... URL.
 * Also checks if there's an overlapping annotation with an arXiv URL.
 */
export const ArxivStrategy: LinkExtractorStrategy = {
  name: 'arXiv',
  extract(text, blockItems, pageNum, externalLinks) {
    // 1. Check text for arXiv ID (e.g. arXiv:2103.00020)
    const arxivMatch = text.match(/arxiv(?:\s+preprint)?(?:\s+arxiv)?:?\s*(\d{4}\.\d{4,5})/i);
    if (arxivMatch) {
      const resolved = validateUrl(`https://arxiv.org/abs/${arxivMatch[1]}`);
      if (resolved) return resolved;
    }

    // 2. Check annotations for arXiv URLs
    return findOverlappingAnnotation(
      blockItems,
      pageNum,
      externalLinks,
      url => url.includes('arxiv.org')
    );
  }
};

/**
 * DoiStrategy: checks for DOI in text or in overlapping annotations.
 */
export const DoiStrategy: LinkExtractorStrategy = {
  name: 'DOI',
  extract(text, blockItems, pageNum, externalLinks) {
    // 1. Check text for DOI
    const doiMatch = text.match(/10\.\d{4,9}\/[-._;()/:a-zA-Z0-9]+/);
    if (doiMatch) {
      const doi = doiMatch[0].replace(/[,;.\s]+$/, ''); // Clean trailing punctuation
      const resolved = validateUrl(`https://doi.org/${doi}`);
      if (resolved) return resolved;
    }

    // 2. Check annotations for DOI URLs
    return findOverlappingAnnotation(
      blockItems,
      pageNum,
      externalLinks,
      url => url.includes('doi.org')
    );
  }
};

/**
 * AnnotationOverlapStrategy: checks for general overlapping external link annotations.
 */
export const AnnotationOverlapStrategy: LinkExtractorStrategy = {
  name: 'annotation-overlap',
  extract(text, blockItems, pageNum, externalLinks) {
    return findOverlappingAnnotation(
      blockItems,
      pageNum,
      externalLinks,
      // Exclude arXiv and DOI since they are handled by higher-priority strategies
      url => !url.includes('arxiv.org') && !url.includes('doi.org')
    );
  }
};

/**
 * DirectTextUrlStrategy: checks text for general HTTP/HTTPS URLs.
 */
export const DirectTextUrlStrategy: LinkExtractorStrategy = {
  name: 'direct-text-url',
  extract(text) {
    const urlMatch = text.match(/https?:\/\/[^\s<>"]+[a-zA-Z0-9/]/);
    if (urlMatch) {
      return validateUrl(urlMatch[0]);
    }
    return null;
  }
};

// Default strategies in priority order: arXiv > DOI > Annotation > Direct Text URL
export const defaultStrategies: LinkExtractorStrategy[] = [
  ArxivStrategy,
  DoiStrategy,
  AnnotationOverlapStrategy,
  DirectTextUrlStrategy,
];

/**
 * Resolves URLs from a reference entry text block and PDF annotations.
 * Delegates to the list of modular strategies in order.
 */
export function resolveReferenceUrl(
  text: string,
  blockItems: TextItem[],
  pageNum: number,
  externalLinks: LinkAnn[],
  strategies: LinkExtractorStrategy[] = defaultStrategies
): string | null {
  for (const strategy of strategies) {
    const url = strategy.extract(text, blockItems, pageNum, externalLinks);
    if (url) {
      const validated = validateUrl(url);
      if (validated) {
        return validated;
      }
    }
  }
  return null;
}
