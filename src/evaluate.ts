import { extractCitationsFromPdf } from './extractor/index';
import { parseRegexHeuristics } from './extractor/parser';
import { 
  matchAndScorePaper, 
  GroundTruthEntry, 
  ExtractedEntry, 
  EntryScore 
} from './evaluator';
import path from 'path';
import fs from 'fs';

// Load environment variables (fallback to defaults if not set)
const PDF_DIR = process.env.PDF_DIR || './pdfs';
const ANNOTATIONS_DIR = process.env.ANNOTATIONS_DIR || './annotations';
const OUTPUT_JSON = process.env.OUTPUT_JSON || './eval_results.json';
const FAILURES_JSON = process.env.FAILURES_JSON || './eval_failures.json';

async function runEvaluation() {
  console.log('========================================================================');
  console.log('Starting Citation Link & Metadata Extraction Evaluation (New Modular scoring)...');
  console.log(`PDF Directory: ${PDF_DIR}`);
  console.log(`Annotations Directory: ${ANNOTATIONS_DIR}`);
  
  let jsonFiles = fs.readdirSync(ANNOTATIONS_DIR).filter(f => f.endsWith('.json'));

  // Default to 10% sample for quick runs, but allow overriding via environment variable
  const sampleRatio = parseFloat(process.env.SAMPLE_RATIO || '0.10');
  if (sampleRatio < 1.0) {
    console.log(`Sampling ${Math.round(sampleRatio * 100)}% of files randomly...`);
    // Fisher-Yates shuffle
    for (let i = jsonFiles.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [jsonFiles[i], jsonFiles[j]] = [jsonFiles[j], jsonFiles[i]];
    }
    const sampleSize = Math.max(1, Math.round(jsonFiles.length * sampleRatio));
    jsonFiles = jsonFiles.slice(0, sampleSize);
    console.log(`Selected ${jsonFiles.length} files of ${jsonFiles.length / sampleRatio} for evaluation.`);
  }

  const results: any[] = [];
  const failures: any[] = [];

  let grandTotalCitations = 0;
  
  // Scoring accumulation
  let sumTitleScore = 0;
  let sumYearScore = 0;
  let sumAuthorScore = 0;
  let sumLinkScore = 0;
  let sumTotalScore = 0;
  let totalTimeMs = 0;

  const CONCURRENCY_LIMIT = 8;
  let index = 0;
  const startTimeTotal = Date.now();

  async function worker() {
    while (index < jsonFiles.length) {
      const currentIdx = index++;
      const jsonFile = jsonFiles[currentIdx];
      const jsonPath = path.join(ANNOTATIONS_DIR, jsonFile);
      const data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
      
      const pdfFilename = jsonFile.replace('.json', '.pdf');
      const pdfPath = path.join(PDF_DIR, pdfFilename);

      if (!fs.existsSync(pdfPath)) {
        console.warn(`PDF file not found: ${pdfPath}. Skipping ${jsonFile}...`);
        continue;
      }

      const bibEntries = data.bib_entries || {};
      const annotations: GroundTruthEntry[] = Object.values(bibEntries).map((ann: any) => {
        return {
          title: ann.title || '',
          authors: Array.isArray(ann.authors) ? ann.authors : (ann.author ? [ann.author] : []),
          year: ann.year ? String(ann.year) : '',
          link: ann.link || null,
        };
      });

      if (annotations.length === 0) continue;

      console.log(`Processing ${pdfFilename} (GT: ${annotations.length} entries)...`);
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
      const { citations, inlineLinks, linkCount } = extractResult;
      
      // Parse metadata for each extracted block using standard heuristics extractor
      const extractedEntries: ExtractedEntry[] = citations.map(cit => {
        const meta = parseRegexHeuristics(cit.text);
        return {
          text: cit.text,
          url: cit.url,
          authors: meta.authors || [],
          title: meta.title || '',
          venue: meta.venue || '',
          year: meta.year || '',
        };
      });

      // Match and score
      const { scores, details } = matchAndScorePaper(annotations, extractedEntries);

      // Track failures (unmatched, or score < 0.8)
      for (const d of details) {
        if (d.status === 'unmatched' || d.fieldScores.totalScore < 0.8) {
          failures.push({
            paper: pdfFilename,
            status: d.status,
            ground_truth: d.gt,
            extracted: d.matchedExt ? {
              text: d.matchedExt.text,
              title: d.matchedExt.title,
              authors: d.matchedExt.authors,
              year: d.matchedExt.year,
              url: d.matchedExt.url
            } : null,
            scores: d.fieldScores,
            similarityScore: d.similarityScore
          });
        }
      }

      console.log(`  Finished ${pdfFilename}: Extracted ${citations.length} refs in ${latencyMs}ms | Score: ${(scores.totalScore * 100).toFixed(1)}%`);

      results.push({
        paper: pdfFilename,
        annotations_count: annotations.length,
        extracted_blocks_count: citations.length,
        scores,
        latency_ms: latencyMs,
        link_stats: { total: linkCount.total, internal: linkCount.internal, external: linkCount.external },
        details
      });
    }
  }

  const workers = Array.from({ length: Math.min(CONCURRENCY_LIMIT, jsonFiles.length) }, worker);
  await Promise.all(workers);

  // Aggregate stats
  let countTitle = 0;
  let countYear = 0;
  let countAuthor = 0;
  let countLink = 0;
  let countTotal = 0;

  for (const r of results) {
    grandTotalCitations += r.annotations_count;
    totalTimeMs += r.latency_ms;
    
    for (const d of r.details) {
      const hasTitle = d.gt.title && d.gt.title.trim() !== "";
      const hasYear = d.gt.year && d.gt.year.trim() !== "";
      const hasAuthor = d.gt.authors && d.gt.authors.length > 0;
      const hasLink = d.gt.link !== null && d.gt.link.trim() !== "";

      if (hasTitle) {
        sumTitleScore += d.fieldScores.titleScore;
        countTitle++;
      }
      if (hasYear) {
        sumYearScore += d.fieldScores.yearScore;
        countYear++;
      }
      if (hasAuthor) {
        sumAuthorScore += d.fieldScores.authorScore;
        countAuthor++;
      }
      if (hasLink) {
        sumLinkScore += d.fieldScores.linkScore;
        countLink++;
      }
      
      sumTotalScore += d.fieldScores.totalScore;
      countTotal++;
    }
  }
  
  const totalExecutionTimeMs = Date.now() - startTimeTotal;

  // Write evaluation results JSON
  fs.writeFileSync(OUTPUT_JSON, JSON.stringify(results, null, 2));
  // Write failure results JSON
  fs.writeFileSync(FAILURES_JSON, JSON.stringify(failures, null, 2));

  // Print summary to console
  console.log('\n========================================================================');
  console.log('EVALUATION RESULTS SUMMARY (NEW METRIC)');
  console.log('========================================================================');
  console.log(`Total Papers Evaluated:     ${results.length}`);
  console.log(`Total Ground Truth Refs:    ${grandTotalCitations}`);
  console.log(`Average Title Similarity:   ${countTitle > 0 ? ((sumTitleScore / countTitle) * 100).toFixed(1) : '0.0'}%`);
  console.log(`Average Year Accuracy:      ${countYear > 0 ? ((sumYearScore / countYear) * 100).toFixed(1) : '0.0'}%`);
  console.log(`Average Author Score:       ${countAuthor > 0 ? ((sumAuthorScore / countAuthor) * 100).toFixed(1) : '0.0'}%`);
  console.log(`Average Link Match Score:   ${countLink > 0 ? ((sumLinkScore / countLink) * 100).toFixed(1) : '0.0'}%`);
  console.log(`------------------------------------------------------------------------`);
  console.log(`OVERALL PIPELINE SCORE:     ${countTotal > 0 ? ((sumTotalScore / countTotal) * 100).toFixed(1) : '0.0'}%`);
  console.log(`------------------------------------------------------------------------`);
  console.log(`Total Latency Sum:          ${totalTimeMs} ms`);
  console.log(`Total Real Execution Time:  ${totalExecutionTimeMs} ms`);
  console.log(`Average Latency per Paper:  ${(totalTimeMs / results.length).toFixed(1)} ms`);
  console.log(`Results saved to:           ${OUTPUT_JSON}`);
  console.log(`Traceable failures saved to: ${FAILURES_JSON}`);
  console.log('========================================================================');
}

runEvaluation().catch(console.error);
