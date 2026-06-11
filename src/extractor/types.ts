import { Citation, InlineLink } from './validator';

export * from './validator';

export interface TextItem {
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface LinkAnn {
  page: number;
  rect: number[];
  url?: string;
  dest?: string;
  targetPage?: number;
  targetX?: number;
  targetY?: number;
}

export interface Line {
  y: number;
  x: number;
  text: string;
  items: TextItem[];
}

export interface RefBlock {
  page: number;
  startY: number;
  text: string;
  items: TextItem[];
  extractedUrl: string | null;
}

export interface LinkExtractorStrategy {
  name: string;
  extract(
    text: string,
    blockItems: TextItem[],
    pageNum: number,
    externalLinks: LinkAnn[]
  ): string | null;
}

export interface ExtractorOptions {
  columnSplitBoundary?: number;
  standardFontDataUrl?: string;
  workerSrc?: string;
  strategies?: LinkExtractorStrategy[];
  onProgress?: (progress: number) => void;
}

export interface ExtractorOutput {
  citations: Citation[];
  inlineLinks: InlineLink[];
  linkCount: {
    total: number;
    internal: number;
    external: number;
  };
}
