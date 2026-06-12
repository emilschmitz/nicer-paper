import { UrlEquivalenceRules } from './extractor/config';

export interface GroundTruthEntry {
  title: string;
  authors: string[];
  year: string;
  arxiv_link: string | null;
  doi_link: string | null;
}

export interface ExtractedEntry {
  text: string;
  url: string | null;
  authors: string[];
  title: string;
  venue: string;
  year: string;
}

export interface EntryScore {
  titleScore: number;
  yearScore: number;
  authorScore: number;
  linkScore: number;
  totalScore: number;
}

export interface MatchDetail {
  gt: GroundTruthEntry;
  matchedExt: ExtractedEntry | null;
  similarityScore: number; // title similarity score
  fieldScores: EntryScore;
  status: 'matched' | 'unmatched';
}

export interface PaperScoreResult {
  scores: EntryScore; // average scores across all GT entries for this paper
  details: MatchDetail[];
}

/**
 * Sørensen-Dice coefficient for text similarity (character bigrams)
 */
function getBigrams(str: string): Set<string> {
  const s = str.toLowerCase().replace(/\s+/g, '');
  const bigrams = new Set<string>();
  for (let i = 0; i < s.length - 1; i++) {
    bigrams.add(s.substring(i, i + 2));
  }
  return bigrams;
}

export function getDiceSimilarity(s1: string, s2: string): number {
  const b1 = getBigrams(s1);
  const b2 = getBigrams(s2);
  if (b1.size === 0 && b2.size === 0) return 1;
  if (b1.size === 0 || b2.size === 0) return 0;
  
  let intersection = 0;
  for (const val of b1) {
    if (b2.has(val)) {
      intersection++;
    }
  }
  return (2 * intersection) / (b1.size + b2.size);
}

/**
 * Checks if token t1 matches t2. Supports initials (e.g. 'j' matches 'jeffrey').
 */
function tokenMatches(t1: string, t2: string): boolean {
  if (t1 === t2) return true;
  if (t1.length === 1 && t2.startsWith(t1)) return true;
  if (t2.length === 1 && t1.startsWith(t2)) return true;
  return false;
}

/**
 * Matches two author names supporting middle initials, abbreviation, or subset matches.
 * e.g., 'Jeffrey E. Hinton' matches 'Jeffrey Hinton', 'Jeffrey', or 'J. Hinton'.
 */
export function matchSingleAuthor(name1: string, name2: string): boolean {
  const clean = (s: string) => s.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(Boolean);
  const tok1 = clean(name1);
  const tok2 = clean(name2);
  if (tok1.length === 0 || tok2.length === 0) return false;

  // We want the shorter list of tokens to be fully matched by the longer list
  const [shorter, longer] = tok1.length <= tok2.length ? [tok1, tok2] : [tok2, tok1];

  // Every token in shorter must match at least one token in longer
  return shorter.every(sToken => longer.some(lToken => tokenMatches(sToken, lToken)));
}

/**
 * Scores the extracted authors list against the ground truth authors list.
 * Computes fraction of extracted authors that are correctly matched.
 */
export function scoreAuthors(gtAuthors: string[], extAuthors: string[]): number {
  const cleanExt = extAuthors.filter(a => a !== 'others');
  if (gtAuthors.length === 0 && cleanExt.length === 0) return 1;
  if (gtAuthors.length === 0 || cleanExt.length === 0) return 0;

  let matchedCount = 0;
  for (const extAuthor of cleanExt) {
    const hasMatch = gtAuthors.some(gtAuthor => matchSingleAuthor(extAuthor, gtAuthor));
    if (hasMatch) {
      matchedCount++;
    }
  }
  
  // If the extracted authors have 'others' (e.g. from et al.), and there are still ground truth
  // authors left unmatched, treat 'others' as a correct match.
  const hadOthers = extAuthors.includes('others');
  if (hadOthers && gtAuthors.length > matchedCount) {
    matchedCount++;
  }
  
  const totalToDivide = hadOthers ? cleanExt.length + 1 : cleanExt.length;
  return matchedCount / totalToDivide;
}

/**
 * Extracts DOI from URL if present.
 */
function extractDoi(url: string): string | null {
  const doiRegex = /\b(10\.\d{4,9}\/[-._;()/:A-Za-z0-9]+)/;
  const match = url.match(doiRegex);
  if (match) {
    return match[1].replace(/[.,;)]+$/, '').toLowerCase();
  }
  return null;
}

/**
 * Extracts arXiv ID from URL if present.
 */
function extractArxivId(url: string): string | null {
  const newArxivRegex = /\b(\d{4}\.\d{4,5})\b/;
  const oldArxivRegex = /\b([a-z\-]+(?:\.[a-z\-]+)*\/\d{7})\b/i;
  
  const matchNew = url.match(newArxivRegex);
  if (matchNew) return matchNew[1];
  
  const matchOld = url.match(oldArxivRegex);
  if (matchOld) return matchOld[1].toLowerCase();
  
  return null;
}

/**
 * Normalizes URL for comparison.
 */
export function getCanonicalUrl(url: string): string {
  if (!url) return '';
  const doi = extractDoi(url);
  if (doi) return `doi:${doi}`;
  
  const arxiv = extractArxivId(url);
  if (arxiv) return `arxiv:${arxiv}`;

  // Custom rules from config
  const cleanUrl = url.trim().toLowerCase().replace(/\/$/, '');
  for (const rule of UrlEquivalenceRules) {
    for (const pattern of rule.patterns) {
      const match = cleanUrl.match(pattern);
      if (match) {
        return rule.canonicalize(match[1]);
      }
    }
  }

  // Fallback
  let clean = url.trim().toLowerCase();
  clean = clean.replace(/^https?:\/\//, '');
  clean = clean.replace(/^www\./, '');
  clean = clean.replace(/\/$/, '');
  return clean;
}

export function areUrlsEquivalent(url1: string | null, url2: string | null): boolean {
  if (url1 === url2) return true;
  if (!url1 || !url2) return false;
  
  const parts1 = url1.split(/\s*\|\|\s*/);
  const parts2 = url2.split(/\s*\|\|\s*/);
  
  for (const p1 of parts1) {
    for (const p2 of parts2) {
      if (getCanonicalUrl(p1) === getCanonicalUrl(p2)) {
        return true;
      }
    }
  }
  return false;
}

export const TITLE_MATCH_THRESHOLD = 0.5;

/**
 * Greedily matches and scores ground truth entries against extracted entries.
 */
export function matchAndScorePaper(
  gtEntries: GroundTruthEntry[],
  extEntries: ExtractedEntry[]
): PaperScoreResult {
  const details: MatchDetail[] = [];
  
  // Sums and counts for averaging across the paper
  let sumTitle = 0;   let countTitle = 0;
  let sumYear = 0;    let countYear = 0;
  let sumAuthor = 0;  let countAuthor = 0;
  let sumLink = 0;    let countLink = 0;
  let sumTotal = 0;   let countTotal = 0;

  for (const gt of gtEntries) {
    let bestExt: ExtractedEntry | null = null;
    let bestScore = -1;

    for (const ext of extEntries) {
      const score = getDiceSimilarity(gt.title, ext.title);
      if (score > bestScore) {
        bestScore = score;
        bestExt = ext;
      }
    }

    const isMatched = bestExt !== null;
    
    // Check which fields are present in the ground truth
    const hasGtTitle = gt.title && gt.title.trim() !== "";
    const hasGtYear = gt.year && gt.year.trim() !== "";
    const hasGtAuthors = gt.authors && gt.authors.length > 0;
    const hasGtLink = !!(gt.arxiv_link || gt.doi_link);

    let titleScore = 0;
    let yearScore = 0;
    let authorScore = 0;
    let linkScore = 0;

    let entryNumerator = 0;
    let entryDenominator = 0;

    if (isMatched && bestExt) {
      // Score only present fields
      if (hasGtTitle) {
        titleScore = bestScore;
        entryNumerator += titleScore;
        entryDenominator += 1;
        
        sumTitle += titleScore;
        countTitle += 1;
      }
      if (hasGtYear) {
        yearScore = (gt.year.trim() === bestExt.year.trim()) ? 1 : 0;
        entryNumerator += yearScore;
        entryDenominator += 1;

        sumYear += yearScore;
        countYear += 1;
      }
      if (hasGtAuthors) {
        authorScore = scoreAuthors(gt.authors, bestExt.authors);
        entryNumerator += authorScore;
        entryDenominator += 1;

        sumAuthor += authorScore;
        countAuthor += 1;
      }
      // Score arXiv link: only when GT has arxiv_link
      if (gt.arxiv_link) {
        const extUrl = bestExt.url || '';
        const canonicalExt = extUrl ? getCanonicalUrl(extUrl) : '';
        const isExtArxiv = canonicalExt.startsWith('arxiv:');
        const canonicalGtArxiv = getCanonicalUrl(gt.arxiv_link);
        const arxivScore = (isExtArxiv && canonicalExt === canonicalGtArxiv) ? 1 : 0;
        entryNumerator += arxivScore;
        entryDenominator += 1;
        sumLink += arxivScore;
        countLink += 1;
        linkScore += arxivScore;
      }

      // Score DOI link: only when GT has doi_link
      if (gt.doi_link) {
        const extUrl = bestExt.url || '';
        const canonicalExt = extUrl ? getCanonicalUrl(extUrl) : '';
        const isExtDoi = canonicalExt.startsWith('doi:');
        const canonicalGtDoi = getCanonicalUrl(gt.doi_link);
        const doiScore = (isExtDoi && canonicalExt === canonicalGtDoi) ? 1 : 0;
        entryNumerator += doiScore;
        entryDenominator += 1;
        sumLink += doiScore;
        countLink += 1;
        linkScore += doiScore;
      }
    } else {
      // Unmatched: present fields get 0
      if (hasGtTitle) {
        entryDenominator += 1;
        countTitle += 1;
      }
      if (hasGtYear) {
        entryDenominator += 1;
        countYear += 1;
      }
      if (hasGtAuthors) {
        entryDenominator += 1;
        countAuthor += 1;
      }
      if (gt.arxiv_link) { entryDenominator += 1; countLink += 1; }
      if (gt.doi_link)   { entryDenominator += 1; countLink += 1; }
    }

    const entryTotalScore = entryDenominator > 0 ? (entryNumerator / entryDenominator) : 0;
    if (entryDenominator > 0) {
      sumTotal += entryTotalScore;
      countTotal += 1;
    }

    const fieldScores: EntryScore = {
      titleScore,
      yearScore,
      authorScore,
      linkScore,
      totalScore: entryTotalScore
    };

    details.push({
      gt,
      matchedExt: isMatched ? bestExt : null,
      similarityScore: bestScore,
      fieldScores,
      status: isMatched ? 'matched' : 'unmatched'
    });
  }

  const avgScores: EntryScore = {
    titleScore: countTitle > 0 ? sumTitle / countTitle : 0,
    yearScore: countYear > 0 ? sumYear / countYear : 0,
    authorScore: countAuthor > 0 ? sumAuthor / countAuthor : 0,
    linkScore: countLink > 0 ? sumLink / countLink : 0,
    totalScore: countTotal > 0 ? sumTotal / countTotal : 0,
  };

  return {
    scores: avgScores,
    details
  };
}
