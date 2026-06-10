import { pipeline, env } from '@huggingface/transformers';

import { ExtractorConfig } from './config';

// Configure offline mode for Transformers.js
env.allowRemoteFiles = false;
env.allowLocalFiles = true;

export interface ExtractedMetadata {
  authors: string;
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
export function normalizeAuthors(authorsStr: string): string {
  if (!authorsStr) return "";
  const hasEtAl = /\bet\s+al\b/i.test(authorsStr);
  let clean = authorsStr.trim().replace(/^[\s,.;&]+|[\s,.;&]+$/g, "");
  clean = clean.replace(/\b(and|&)\b/gi, " and ");
  clean = clean.replace(/,/g, " and ");
  clean = clean.replace(/(\s+and\s+)+/gi, " and ");
  clean = clean.split(/\s+/).join(" ");
  const authors = clean.split(/\s+and\s+/i)
    .map(a => a.trim())
    .filter(a => a.length > 1 && !/^(et\s+al\.?|and|editor[s]?)$/i.test(a));
  
  let normalized = authors.join(" and ");
  if (hasEtAl) {
    if (normalized) {
      normalized += " and others";
    } else {
      normalized = "others";
    }
  }
  return normalized;
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
export function parseRegexHeuristics(text: string): ExtractedMetadata {
  // Clean up starting index numbers like [1] or 1.
  let cleanText = text.replace(/^\[\d+\]\s*/, "").replace(/^\d+\.\s*/, "").trim();

  // 1. Extract Year (Strict)
  let year = "";
  let textWithoutYear = cleanText;
  let yearInParens = false;

  const parenYearMatch = cleanText.match(/\((19\d{2}|20\d{2})\b[a-z]?\)/);
  if (parenYearMatch) {
    year = parenYearMatch[1];
    textWithoutYear = cleanText.replace(parenYearMatch[0], " __YEAR__ ");
    yearInParens = true;
  } else {
    // Scan all 4-digit numbers in the 1900-2099 range
    const yearMatches = Array.from(cleanText.matchAll(/\b(19\d{2}|20\d{2})\b/g));
    for (const match of yearMatches) {
      const candidate = match[1];
      const matchIdx = match.index!;
      
      const beforeStr = cleanText.substring(Math.max(0, matchIdx - 15), matchIdx);
      const afterStr = cleanText.substring(matchIdx + candidate.length, Math.min(cleanText.length, matchIdx + candidate.length + 10));
      
      // Reject if inside page range or volume context
      if (
        /\b(vol\.?|volume|pp\.?|pages?|issue|no\.?)\b/i.test(beforeStr) || 
        /^[-\–\u2013\u2014]\d+/.test(afterStr) || 
        /\d+[-\–\u2013\u2014]$/.test(beforeStr)
      ) {
        continue;
      }
      
      // Enforce clean boundary characters
      const charBefore = beforeStr.length > 0 ? beforeStr[beforeStr.length - 1] : "";
      const charAfter = afterStr.length > 0 ? afterStr[0] : "";
      const validBefore = charBefore === "" || /[\s,.;\(\)\[\]]/.test(charBefore);
      const validAfter = charAfter === "" || /[\s,.;\(\)\[\]]/.test(charAfter);
      
      if (validBefore && validAfter) {
        year = candidate;
        textWithoutYear = cleanText.replace(match[0], " __YEAR__ ");
        break;
      }
    }
  }

  // 2. Extract Authors
  let authors = "";
  let remainder = textWithoutYear;

  if (yearInParens) {
    const yearIdx = textWithoutYear.indexOf("__YEAR__");
    if (yearIdx !== -1) {
      authors = textWithoutYear.substring(0, yearIdx).trim();
      remainder = textWithoutYear.substring(yearIdx + "__YEAR__".length).trim();
    }
  } else if (/\bet\s+al\b/i.test(textWithoutYear)) {
    const etAlMatch = textWithoutYear.match(/(.*?)\bet\s+al\.?\b(,\s*)?/i);
    if (etAlMatch) {
      authors = etAlMatch[1] + " et al.";
      remainder = textWithoutYear.substring(etAlMatch[0].length).trim();
    }
  } else {
    let splitIdx = -1;
    for (let i = 0; i < textWithoutYear.length; i++) {
      if (textWithoutYear[i] === '.') {
        const prevChar = i > 0 ? textWithoutYear[i - 1] : '';
        const prevPrevChar = i > 1 ? textWithoutYear[i - 2] : '';
        if (/[A-Z]/.test(prevChar) && (prevPrevChar === '' || /[^A-Za-z]/.test(prevPrevChar))) {
          continue;
        }
        if (i >= 5 && textWithoutYear.substring(i - 5, i + 1).toLowerCase() === 'et al.') {
          continue;
        }
        splitIdx = i;
        break;
      }
    }
    
    if (splitIdx !== -1) {
      authors = textWithoutYear.substring(0, splitIdx).trim();
      remainder = textWithoutYear.substring(splitIdx + 1).trim();
    } else {
      const commaIdx = textWithoutYear.indexOf(',');
      if (commaIdx !== -1) {
        authors = textWithoutYear.substring(0, commaIdx).trim();
        remainder = textWithoutYear.substring(commaIdx + 1).trim();
      } else {
        authors = textWithoutYear;
        remainder = "";
      }
    }
  }

  authors = authors.replace(/^[\s,.;&\(\)\[\]]+|[\s,.;&\(\)\[\]]+$/g, "").trim();
  remainder = remainder.replace("__YEAR__", "").trim();
  remainder = remainder.replace(/^[\s,.:;"'“”韵‘’()\[\]]+|[\s,.:;"'“”韵‘’()\[\]]+$/g, "").trim();

  let title = "";
  let venue = "";

  const simpleQuoteMatch = remainder.match(/["“‘]([^"制造“”‘’]+)["”’]/) || remainder.match(/["“‘]([^"“”‘’]+)["”’]/);
  if (simpleQuoteMatch) {
    title = simpleQuoteMatch[1];
    venue = remainder.replace(simpleQuoteMatch[0], "").trim();
  } else {
    const inMatch = remainder.match(/(.*?)\b(in|In)\b\s+(.*)/);
    if (inMatch) {
      title = inMatch[1];
      venue = inMatch[3];
    } else {
      const parts = remainder.split(/\.\s+/);
      title = parts[0] || "";
      venue = parts.slice(1).join(". ") || "";
    }
  }

  title = title.replace(/^[\s,.:;"'“”‘’()\[\]]+|[\s,.:;"'“”‘’()\[\]]+$/g, "").trim();
  venue = venue.replace(/^[\s,.:;"'“”‘’()\[\]]+|[\s,.:;"'“”‘’()\[\]]+$/g, "").trim();

  // Strict sanitization: reject if it looks like junk parsed text
  if (
    title.length < 3 ||
    /\b(doi|https?|www|vol\.?|volume|pp\.?|pages?)\b/i.test(title) ||
    /^\d+$/.test(title)
  ) {
    title = "";
  }

  venue = venue.replace(/\b(pp\.?|pages|vol\.?|volume|no\.?|issue)\s*[\d\s\-\–,:]+/gi, "");
  venue = venue.replace(/https?:\/\/\S+/gi, "");
  venue = venue.replace(/doi:\s*\S+/gi, "");
  venue = venue.replace(/,\s*abs\/\S+/gi, "");
  venue = venue.replace(/^[\s,.:;"'“”‘’()\[\]]+|[\s,.:;"'“”‘’()\[\]]+$/g, "").trim();

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
  return { authors: "", title: "", venue: "", year: "" };
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
  if (!authors) {
    authors = heuristicsResult.authors;
  }

  return {
    authors,
    title: heuristicsResult.title,
    venue: heuristicsResult.venue,
    year: heuristicsResult.year || parseRegexHeuristics(text).year
  };
}
