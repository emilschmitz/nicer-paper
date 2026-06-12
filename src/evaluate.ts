import { extractCitationsFromPdf, Citation } from './extractor/index';
import { UrlEquivalenceRules } from './extractor/config';
import path from 'path';
import fs from 'fs';

// Load environment variables (fallback to defaults if not set)
const PDF_DIR = process.env.PDF_DIR || './pdfs';
const ANNOTATIONS_DIR = process.env.ANNOTATIONS_DIR || './annotations';
const OUTPUT_JSON = process.env.OUTPUT_JSON || './eval_results.json';
const SIMILARITY_THRESHOLD = parseFloat(process.env.SIMILARITY_THRESHOLD || '0.7');

// Helper: Sørensen-Dice coefficient for text similarity (character bigrams)
function getBigrams(str: string): Set<string> {
  const s = str.toLowerCase().replace(/\s+/g, '');
  const bigrams = new Set<string>();
  for (let i = 0; i < s.length - 1; i++) {
    bigrams.add(s.substring(i, i + 2));
  }
  return bigrams;
}

function getDiceSimilarity(s1: string, s2: string): number {
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

function getCanonicalUrl(url: string): string {
  const cleanUrl = url.trim().toLowerCase().replace(/\/$/, '');
  for (const rule of UrlEquivalenceRules) {
    for (const pattern of rule.patterns) {
      const match = cleanUrl.match(pattern);
      if (match) {
        return rule.canonicalize(match[1]);
      }
    }
  }
  return cleanUrl;
}

function areUrlsEquivalent(url1: string | null, url2: string | null): boolean {
  if (url1 === url2) return true;
  if (!url1 || !url2) return false;
  return getCanonicalUrl(url1) === getCanonicalUrl(url2);
}

async function runEvaluation() {
  console.log('Starting Citation Link Extraction Evaluation (Modular Extractor)...');
  console.log(`PDF Directory: ${PDF_DIR}`);
  console.log(`Annotations Directory: ${ANNOTATIONS_DIR}`);
  console.log(`Similarity Threshold: ${SIMILARITY_THRESHOLD}`);

  const results: any[] = [];
  const jsonFiles = fs.readdirSync(ANNOTATIONS_DIR).filter(f => f.endsWith('.json'));

  let grandTotalCitations = 0;
  let grandTotalMatched = 0;
  let grandTotalCorrectUrls = 0;
  let grandTotalMissedUrls = 0;
  let grandTotalMismatchedUrls = 0;
  let grandTotalNewUrlsFound = 0;
  let totalTimeMs = 0;

  for (const jsonFile of jsonFiles) {
    const jsonPath = path.join(ANNOTATIONS_DIR, jsonFile);
    const data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    
    const pdfFilename = jsonFile.replace('.json', '.pdf');
    const pdfPath = path.join(PDF_DIR, pdfFilename);

    if (!fs.existsSync(pdfPath)) {
      console.warn(`PDF file not found: ${pdfPath}. Skipping ${jsonFile}...`);
      continue;
    }

    const bibEntries = data.bib_entries || {};
    const annotations = Object.values(bibEntries).map((ann: any) => {
      const authorsStr = Array.isArray(ann.authors) ? ann.authors.join(' and ') : (ann.author || '');
      const raw = `${authorsStr}. ${ann.title}. ${ann.year || ''}.`;
      return {
        raw,
        url: ann.link || null,
        author: authorsStr,
        title: ann.title || '',
        year: ann.year ? String(ann.year) : '',
      };
    });

    if (annotations.length === 0) continue;

    console.log(`\nProcessing ${pdfFilename}...`);
    const startTime = Date.now();
    
    let extractResult;
    try {
      const fileBuffer = fs.readFileSync(pdfPath);
      const data = new Uint8Array(fileBuffer);
      extractResult = await extractCitationsFromPdf(data, {
        workerSrc: path.resolve('node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs'),
      });
    } catch (err: any) {
      console.error(`Error processing PDF ${pdfFilename}:`, err);
      continue;
    }
    
    const latencyMs = Date.now() - startTime;
    totalTimeMs += latencyMs;

    const { citations, inlineLinks, linkCount } = extractResult;
    console.log(`  Extracted ${citations.length} references in ${latencyMs}ms (Internal links: ${linkCount.internal}, External: ${linkCount.external})`);

    const paperMatches: any[] = [];
    let matchedCount = 0;
    let correctUrls = 0;
    let missedUrls = 0;
    let mismatchedUrls = 0;
    let newUrlsFound = 0;

    for (const ann of annotations) {
      // Find the best match amongst extracted citations
      let bestBlock: Citation | null = null;
      let bestScore = 0;

      for (const block of citations) {
        const score = getDiceSimilarity(ann.raw, block.text);
        if (score > bestScore) {
          bestScore = score;
          bestBlock = block;
        }
      }

      const hasMatch = bestScore >= SIMILARITY_THRESHOLD && bestBlock !== null;
      let status = 'fail';
      let extractedUrl: string | null = null;

      if (hasMatch && bestBlock) {
        matchedCount++;
        extractedUrl = bestBlock.url;
        
        const gtUrl = ann.url || null;

        if (areUrlsEquivalent(gtUrl, extractedUrl)) {
          correctUrls++;
          status = 'correct';
        } else if (gtUrl !== null && extractedUrl === null) {
          missedUrls++;
          status = 'miss';
        } else if (gtUrl === null && extractedUrl !== null) {
          newUrlsFound++;
          status = 'new_found'; // We found a URL not marked in ground truth
        } else {
          mismatchedUrls++;
          status = 'mismatch';
        }
      } else {
        status = 'unmatched';
        missedUrls++;
      }

      paperMatches.push({
        raw_ground_truth: ann.raw,
        matched_text: bestBlock ? bestBlock.text : null,
        ground_truth_url: ann.url || null,
        extracted_url: extractedUrl,
        similarity_score: bestScore,
        status,
      });
    }

    grandTotalCitations += annotations.length;
    grandTotalMatched += matchedCount;
    grandTotalCorrectUrls += correctUrls;
    grandTotalMissedUrls += missedUrls;
    grandTotalMismatchedUrls += mismatchedUrls;
    grandTotalNewUrlsFound += newUrlsFound;

    results.push({
      paper: pdfFilename,
      annotations_count: annotations.length,
      extracted_blocks_count: citations.length,
      matched_count: matchedCount,
      correct_urls: correctUrls,
      missed_urls: missedUrls,
      mismatched_urls: mismatchedUrls,
      new_urls_found: newUrlsFound,
      latency_ms: latencyMs,
      link_stats: { total: linkCount.total, internal: linkCount.internal, external: linkCount.external },
      details: paperMatches,
    });
  }

  // Write evaluation results JSON
  fs.writeFileSync(OUTPUT_JSON, JSON.stringify(results, null, 2));

  // Print summary to console
  console.log('\n======================================');
  console.log('EVALUATION RESULTS SUMMARY');
  console.log('======================================');
  console.log(`Total Papers Evaluated:     ${results.length}`);
  console.log(`Total Citations:            ${grandTotalCitations}`);
  console.log(`Successfully Matched:       ${grandTotalMatched} (${((grandTotalMatched / grandTotalCitations) * 100).toFixed(1)}%)`);
  console.log(`Correct URLs:               ${grandTotalCorrectUrls} (${((grandTotalCorrectUrls / grandTotalCitations) * 100).toFixed(1)}%)`);
  console.log(`Missed URLs:                ${grandTotalMissedUrls} (${((grandTotalMissedUrls / grandTotalCitations) * 100).toFixed(1)}%)`);
  console.log(`Mismatched URLs:            ${grandTotalMismatchedUrls} (${((grandTotalMismatchedUrls / grandTotalCitations) * 100).toFixed(1)}%)`);
  console.log(`New URLs Found (GT was null): ${grandTotalNewUrlsFound}`);
  console.log(`Total Execution Time:       ${totalTimeMs} ms`);
  console.log(`Average Latency per Paper:  ${(totalTimeMs / results.length).toFixed(1)} ms`);
  console.log(`Results saved to:           ${OUTPUT_JSON}`);
  console.log('======================================');
}

runEvaluation().catch(console.error);
