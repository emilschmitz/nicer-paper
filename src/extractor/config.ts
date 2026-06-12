export const ExtractorConfig = {
  SLM: {
    MAX_NEW_TOKENS: 100,
    TEMPERATURE: 0.0,
  },
  NER: {
    STRICT_THRESHOLD: 0.85,
  },
  PDF: {
    REF_START_PAGE_RATIO: 0.4,
  }
};

export const UrlEquivalenceRules = [
  {
    name: 'arXiv-DOI-Equivalence',
    patterns: [
      /arxiv\.org\/abs\/(\d{4}\.\d{4,5})/i,
      /doi\.org\/10\.48550\/arXiv\.(\d{4}\.\d{4,5})/i,
      /arxiv\.org\/pdf\/(\d{4}\.\d{4,5})/i,
    ],
    canonicalize: (id: string) => `arxiv:${id.toLowerCase()}`
  }
];
