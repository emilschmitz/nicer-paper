import { pipeline, env } from '@huggingface/transformers';

import { ExtractorConfig } from './config';

// Configure offline mode for Transformers.js
env.allowRemoteFiles = false;
env.allowLocalFiles = true;

export interface ExtractedMetadata {
  authors: string[];
  title: string;
  venue: string;
  year: string;
}

// Global cached pipelines to avoid reloading models on every call
let tokenClassifier: any = null;
let textGenerator: any = null;

export async function initNerPipeline() {
  if (!tokenClassifier) {
    console.log("Initializing BERT NER pipeline offline...");
    tokenClassifier = await pipeline('token-classification', 'Xenova/bert-base-NER');
  }
}

export async function initSlmPipeline() {
  if (!textGenerator) {
    console.log("Initializing Qwen2.5-0.5B pipeline offline...");
    textGenerator = await pipeline('text-generation', 'onnx-community/Qwen2.5-0.5B-Instruct');
  }
}

/**
 * Normalizes author strings to "Author 1 and Author 2 and Author 3" format.
 */
export function normalizeAuthors(authorsStr: string): string[] {
  if (!authorsStr) return [];
  const hasEtAl = /\bet\s+al\b/i.test(authorsStr);
  let clean = authorsStr.trim().replace(/^[\s,.;&]+|[\s,.;&]+$/g, "");
  clean = clean.replace(/\b(and|&)\b/gi, " and ");
  clean = clean.replace(/,/g, " and ");
  clean = clean.replace(/(\s+and\s+)+/gi, " and ");
  clean = clean.split(/\s+/).join(" ");
  const authors = clean.split(/\s+and\s+/i)
    .map(a => a.trim())
    .filter(a => a.length > 1 && !/^(et\s+al\.?|and|editor[s]?)$/i.test(a));
  
  if (hasEtAl) {
    authors.push("others");
  }
  return authors;
}

/**
 * Standard bigram similarity scoring for comparing text fields in evaluation.
 */
export function getDiceSimilarity(s1: string, s2: string): number {
  const clean = (str: string) => str.toLowerCase().replace(/[^a-z0-9]/g, '');
  const a = clean(s1);
  const b = clean(s2);
  if (a.length === 0 && b.length === 0) return 1;
  if (a.length === 0 || b.length === 0) return 0;
  
  const bigramsA = new Set<string>();
  for (let i = 0; i < a.length - 1; i++) {
    bigramsA.add(a.substring(i, i + 2));
  }
  const bigramsB = new Set<string>();
  for (let i = 0; i < b.length - 1; i++) {
    bigramsB.add(b.substring(i, i + 2));
  }
  
  let intersection = 0;
  for (const bigram of bigramsA) {
    if (bigramsB.has(bigram)) {
      intersection++;
    }
  }
  return (2 * intersection) / (bigramsA.size + bigramsB.size);
}

// ----------------------------------------------------
// APPROACH 1: Simple Regex Parser
// ----------------------------------------------------
export function parseRegexSimple(text: string): ExtractedMetadata {
  const yearMatch = text.match(/\b(19\d{2}|20\d{2})\b/);
  const year = yearMatch ? yearMatch[1] : "";
  
  let authors = "";
  let title = "";
  let venue = "";

  if (yearMatch && yearMatch.index !== undefined) {
    // Split text by the year
    authors = text.substring(0, yearMatch.index).trim();
    const rest = text.substring(yearMatch.index + year.length).trim();
    
    // Simple split of title and venue after the year
    // Look for first period or quotation mark
    const titleParts = rest.split(/[.“”"’‘]/);
    const candidateParts = titleParts.map(p => p.trim()).filter(p => p.length > 2);
    
    title = candidateParts[0] || "";
    venue = candidateParts.slice(1).join(". ") || "";
  } else {
    // Fallback if no year found
    const parts = text.split(/[.,]/);
    authors = parts[0] || "";
    title = parts[1] || "";
    venue = parts.slice(2).join(". ") || "";
  }

  // Clean authors
  authors = authors.replace(/^\[\d+\]\s*/, ""); // remove bracket number e.g. [1]
  authors = authors.replace(/^\d+\.\s*/, "");    // remove dot number e.g. 1.
  
  return {
    authors: normalizeAuthors(authors),
    title: title.replace(/^[\s,.:;"'“”‘’()]+|[\s,.:;"'“”‘’()]+$/g, "").trim(),
    venue: venue.replace(/^[\s,.:;"'“”‘’()]+|[\s,.:;"'“”‘’()]+$/g, "").trim(),
    year
  };
}

// ----------------------------------------------------
// APPROACH 2: Heuristic Regex Parser
function splitIntoClauses(text: string): string[] {
  const clauses: string[] = [];
  let current = '';
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '.') {
      const prev = i > 0 ? text[i-1] : '';
      const next = i < text.length - 1 ? text[i+1] : '';
      // Check if it's an initial (e.g., "A." or "A. B.")
      const isInitial = /[A-Z]/.test(prev) && (next === '' || /\s/.test(next) || /[A-Z]/.test(next));
      // Check for common abbreviations
      const lastWord = current.split(/\s+/).pop()?.toLowerCase() || '';
      const cleanWord = lastWord.replace(/[^a-z]/g, '');
      const isAbbrev = ['vol', 'no', 'pp', 'al', 'assoc', 'proc', 'conf', 'dept', 'univ', 'ed', 'eds', 'trans', 'sci', 'comput', 'lett', 'sig', 'commun', 'imag', 'vis'].includes(cleanWord);
      
      if (isInitial || isAbbrev) {
        current += char;
      } else {
        clauses.push(current.trim());
        current = '';
      }
    } else {
      current += char;
    }
  }
  if (current.trim()) {
    clauses.push(current.trim());
  }
  return clauses.filter(Boolean);
}

export function parseRegexHeuristics(text: string): ExtractedMetadata {
  // Clean up starting index numbers like [1] or 1.
  let cleanText = text.replace(/^\[\d+\]\s*/, "").replace(/^\d+\.\s*/, "").trim();

  // 1. Extract Year
  let year = "";
  const yearMatches = Array.from(cleanText.matchAll(/\b(19\d{2}|20\d{2})\b/g));
  
  // Rank 1: Year in parentheses/brackets e.g. (2016) or [2016]
  const parenMatch = cleanText.match(/[\(\[](19\d{2}|20\d{2})[\)\]]/);
  if (parenMatch) {
    year = parenMatch[1];
  } else {
    // Rank 2: Year at the end of the text (within last 35 chars)
    const endMatch = cleanText.match(/\b(19\d{2}|20\d{2})\b[.\s]*$/);
    if (endMatch) {
      year = endMatch[1];
    } else {
      // Rank 3: Find any year that is not part of a page range
      for (const m of yearMatches) {
        const candidate = m[1];
        const idx = m.index!;
        const before = cleanText.substring(Math.max(0, idx - 15), idx).toLowerCase();
        const after = cleanText.substring(idx + 4, Math.min(cleanText.length, idx + 15)).toLowerCase();
        
        const isPageNum = /\b(pp\.?|p\.?|pages?|vol\.?|volume|issue|no\.?)\b/.test(before) || 
                          /^[-\–\u2013\u2014]\d+/.test(after) || 
                          /\d+[-\–\u2013\u2014]/.test(before);
        if (!isPageNum) {
          year = candidate;
          break;
        }
      }
    }
  }

  // Fallback
  if (!year && yearMatches.length > 0) {
    for (const m of yearMatches) {
      const candidate = m[1];
      const idx = m.index!;
      const after = cleanText.substring(idx + 4, Math.min(cleanText.length, idx + 10));
      if (!/^[-\–\u2013\u2014]\d+/.test(after)) {
        year = candidate;
        break;
      }
    }
  }

  const textWithoutYear = year ? cleanText.replace(year, " __YEAR__ ") : cleanText;
  let authors = "";
  let title = "";
  let venue = "";

  // 2. Extract Title inside quotes if present
  const quoteMatch = cleanText.match(/["“‘]([^"制造“”‘’]+)["”’]/) || cleanText.match(/["“‘]([^"“”‘’]+)["”’]/);
  if (quoteMatch) {
    title = quoteMatch[1];
    const quotesIndex = cleanText.indexOf(quoteMatch[0]);
    authors = cleanText.substring(0, quotesIndex).trim();
    venue = cleanText.substring(quotesIndex + quoteMatch[0].length).trim();
  } else {
    // 3. Clause-based splitting
    const clauses = splitIntoClauses(textWithoutYear);
    if (clauses.length >= 2) {
      authors = clauses[0];
      let titleIdx = 1;
      if (clauses[1].includes("__YEAR__") && clauses[1].replace("__YEAR__", "").trim().length < 5) {
        titleIdx = 2;
      }
      title = clauses[titleIdx] || "";
      venue = clauses.slice(titleIdx + 1).join(". ") || "";
    } else {
      // Split by comma if only one clause
      const commaParts = textWithoutYear.split(/,\s+/);
      if (commaParts.length >= 2) {
        authors = commaParts[0];
        title = commaParts[1];
        venue = commaParts.slice(2).join(", ");
      } else {
        authors = textWithoutYear;
      }
    }
  }

  // Clean authors
  authors = authors.replace("__YEAR__", "").trim();
  authors = authors.replace(/^[\s,.;&\(\)\[\]]+|[\s,.;&\(\)\[\]]+$/g, "").trim();

  // Clean title
  title = title.replace("__YEAR__", "").trim();
  title = title.replace(/^[\s,.:;"'形“”‘’()\[\]\-\–\—韵]+|[\s,.:;"'形“”‘’()\[\]\-\–\—韵]+$/g, "").trim();

  // Clean venue
  venue = venue.replace("__YEAR__", "").trim();
  venue = venue.replace(/\b(pp\.?|pages|vol\.?|volume|no\.?|issue)\s*[\d\s\-\–,:]+/gi, "");
  venue = venue.replace(/https?:\/\/\S+/gi, "");
  venue = venue.replace(/doi:\s*\S+/gi, "");
  venue = venue.replace(/,\s*abs\/\S+/gi, "");
  venue = venue.replace(/^[\s,.:;"'“”‘’()\[\]]+|[\s,.:;"'“”‘’()\[\]]+$/g, "").trim();

  // Strict sanitization: reject if it looks like junk parsed text
  if (
    title.length < 5 ||
    /\b(doi|https?|www|vol\.?|volume|pp\.?|pages?)\b/i.test(title) ||
    /^\d+$/.test(title)
  ) {
    title = "";
  }

  if (
    venue.length < 3 ||
    /\b(https?|www|doi:)\b/i.test(venue) ||
    /^\d+$/.test(venue)
  ) {
    venue = "";
  }

  return {
    authors: normalizeAuthors(authors),
    title,
    venue,
    year
  };
}

// Helper to parse Qwen JSON output safely
function parseJsonOutput(qwenOutput: string): ExtractedMetadata {
  try {
    // Find the first JSON block in case there's surrounding text
    const jsonMatch = qwenOutput.match(/\{[\s\S]*?\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      
      let authors = "";
      if (Array.isArray(parsed.authors)) {
        authors = parsed.authors.join(" and ");
      } else {
        authors = String(parsed.authors || "");
      }

      return {
        authors: normalizeAuthors(authors),
        title: String(parsed.title || "").trim(),
        venue: String(parsed.venue || "").trim(),
        year: String(parsed.year || "").trim()
      };
    }
  } catch (e) {
    // Fallback on JSON parse error
  }
  return { authors: [], title: "", venue: "", year: "" };
}

// ----------------------------------------------------
// APPROACH 3: SLM Zero-Shot
// ----------------------------------------------------
export async function parseSlmZeroShot(text: string): Promise<ExtractedMetadata> {
  await initSlmPipeline();
  const prompt = `<|im_start|>system
You are a helpful citation parser. Extract metadata from the citation text and output in JSON format only:
{"authors": "...", "title": "...", "venue": "...", "year": "..."}
No conversational text.
<|im_end|>
<|im_start|>user
Citation: ${text}
<|im_end|>
<|im_start|>assistant
`;
  const result = await textGenerator(prompt, {
    max_new_tokens: ExtractorConfig.SLM.MAX_NEW_TOKENS,
    temperature: ExtractorConfig.SLM.TEMPERATURE,
    do_sample: false,
    return_full_text: false,
  });

  const generatedText = result[0]?.generated_text || "";
  return parseJsonOutput(generatedText);
}

// ----------------------------------------------------
// APPROACH 4: SLM Few-Shot
// ----------------------------------------------------
export async function parseSlmFewShot(text: string): Promise<ExtractedMetadata> {
  await initSlmPipeline();
  const prompt = `<|im_start|>system
You are a helpful citation parser. Extract metadata from the citation text and output in JSON format only:
{"authors": "...", "title": "...", "venue": "...", "year": "..."}
No conversational text.
<|im_end|>
<|im_start|>user
Citation: Samuel R Bowman, Gabor Angeli, Christopher Potts, and Christopher D Manning. 2015. A large annotated corpus for learning natural language inference. arXiv preprint arXiv: 1508.05326.
<|im_end|>
<|im_start|>assistant
{"authors": "Samuel R Bowman and Gabor Angeli and Christopher Potts and Christopher D Manning", "title": "A large annotated corpus for learning natural language inference", "venue": "arXiv preprint arXiv: 1508.05326", "year": "2015"}<|im_end|>
<|im_start|>user
Citation: Moustafa Alzantot, Yash Sharma, Ahmed Elgohary, Bo-Jhang Ho, Mani B. Srivastava, and Kai-Wei Chang. 2018. Generating natural language adversarial examples. CoRR, abs/1804.07998.
<|im_end|>
<|im_start|>assistant
{"authors": "Moustafa Alzantot and Yash Sharma and Ahmed Elgohary and Bo-Jhang Ho and Mani B. Srivastava and Kai-Wei Chang", "title": "Generating natural language adversarial examples", "venue": "CoRR", "year": "2018"}<|im_end|>
<|im_start|>user
Citation: ${text}
<|im_end|>
<|im_start|>assistant
`;
  const result = await textGenerator(prompt, {
    max_new_tokens: ExtractorConfig.SLM.MAX_NEW_TOKENS,
    temperature: ExtractorConfig.SLM.TEMPERATURE,
    do_sample: false,
    return_full_text: false,
  });

  const generatedText = result[0]?.generated_text || "";
  return parseJsonOutput(generatedText);
}

// Helper: processes BERT NER tokens into fields
function processNerTokens(tokens: any[], text: string, strictThreshold = 0.0): ExtractedMetadata {
  const authorWords: string[] = [];
  const orgWords: string[] = [];
  
  // Reconstruct words from wordpieces
  for (const token of tokens) {
    if (token.score < strictThreshold) continue;
    
    // Clean up wordpiece prefix
    const cleanWord = token.word.replace(/^##/, "");
    
    if (token.entity.includes("PER")) {
      if (token.word.startsWith("##") && authorWords.length > 0) {
        authorWords[authorWords.length - 1] += cleanWord;
      } else {
        authorWords.push(cleanWord);
      }
    } else if (token.entity.includes("ORG")) {
      if (token.word.startsWith("##") && orgWords.length > 0) {
        orgWords[orgWords.length - 1] += cleanWord;
      } else {
        orgWords.push(cleanWord);
      }
    }
  }

  // 1. Extract Year
  const yearMatch = text.match(/\b(19\d{2}|20\d{2})\b/);
  const year = yearMatch ? yearMatch[1] : "";

  // 2. Extract Authors
  let authors = authorWords.join(" ");
  if (!authors) {
    // Fallback: take first part before year
    if (yearMatch && yearMatch.index !== undefined) {
      authors = text.substring(0, yearMatch.index);
    }
  }

  // 3. Extract Venue
  let venue = orgWords.join(" ");
  if (!venue) {
    // Fallback: look for arXiv/CoRR/Journal terms
    const arxivMatch = text.match(/arxiv[^\s,.:;]*/i);
    const corrMatch = text.match(/corr[^\s,.:;]*/i);
    if (arxivMatch) venue = arxivMatch[0];
    else if (corrMatch) venue = corrMatch[0];
  }

  // 4. Title: take the text after authors/year, remove venue and clean
  let title = "";
  if (yearMatch && yearMatch.index !== undefined) {
    const afterYear = text.substring(yearMatch.index + year.length).trim();
    // Split by period to get first major clause
    const clauses = afterYear.split(/\.\s+/);
    title = clauses[0] || "";
  } else {
    const clauses = text.split(/\.\s+/);
    title = clauses[1] || "";
  }

  return {
    authors: normalizeAuthors(authors),
    title: title.replace(/^[\s,.:;"'“”‘’()]+|[\s,.:;"'“”‘’()]+$/g, "").trim(),
    venue: venue.replace(/^[\s,.:;"'“”‘’()]+|[\s,.:;"'“”‘’()]+$/g, "").trim(),
    year
  };
}

// ----------------------------------------------------
// APPROACH 5: BERT NER
// ----------------------------------------------------
export async function parseBertNer(text: string): Promise<ExtractedMetadata> {
  await initNerPipeline();
  const tokens = await tokenClassifier(text);
  return processNerTokens(tokens, text, 0.0);
}

// ----------------------------------------------------
// APPROACH 6: Strict BERT NER
// ----------------------------------------------------
export async function parseBertNerStrict(text: string): Promise<ExtractedMetadata> {
  await initNerPipeline();
  // Filter tokens with confidence score > 0.85
  const tokens = await tokenClassifier(text);
  return processNerTokens(tokens, text, 0.85);
}

// ----------------------------------------------------
// APPROACH 7: Hybrid NER + Heuristics
// ----------------------------------------------------
export async function parseHybridNerHeuristics(text: string): Promise<ExtractedMetadata> {
  await initNerPipeline();
  const tokens = await tokenClassifier(text);
  
  // 1. Identify Author tokens
  const authorWords: string[] = [];
  for (const token of tokens) {
    if (token.entity.includes("PER")) {
      const cleanWord = token.word.replace(/^##/, "");
      if (token.word.startsWith("##") && authorWords.length > 0) {
        authorWords[authorWords.length - 1] += cleanWord;
      } else {
        authorWords.push(cleanWord);
      }
    }
  }

  const rawAuthors = authorWords.join(" ");
  let authors = normalizeAuthors(rawAuthors);
  
  // If NER found authors, remove that span from the citation text to run heuristics on the rest
  let textForHeuristics = text;
  if (rawAuthors.length > 5) {
    // Try to find where the author sequence ends in the original string
    // Usually, authors are at the very beginning of the citation
    const firstAuthorWord = authorWords[0];
    const lastAuthorWord = authorWords[authorWords.length - 1];
    const startIdx = text.indexOf(firstAuthorWord);
    const endIdx = text.indexOf(lastAuthorWord) + lastAuthorWord.length;
    
    if (startIdx !== -1 && endIdx > startIdx) {
      // Extract the author block and the rest of the text
      textForHeuristics = text.substring(endIdx).trim();
    }
  }

  // 2. Run heuristic regex parser on the remainder text
  const heuristicsResult = parseRegexHeuristics(textForHeuristics);

  // If NER failed to detect authors, fall back to heuristics' author detection
  if (authors.length === 0) {
    authors = heuristicsResult.authors;
  }

  return {
    authors,
    title: heuristicsResult.title,
    venue: heuristicsResult.venue,
    year: heuristicsResult.year || parseRegexHeuristics(text).year
  };
}
