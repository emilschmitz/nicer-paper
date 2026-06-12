import fs from 'fs';
import path from 'path';
import {
  initNerPipeline,
  parseRegexSimple,
  parseRegexHeuristics,
  parseBertNer,
  parseBertNerStrict,
  parseHybridNerHeuristics,
  getDiceSimilarity,
  ExtractedMetadata
} from './extractor/parser';

const ANNOTATIONS_DIR = './annotations';
const SAMPLE_SIZE_PER_PAPER = parseInt(process.env.SAMPLE_SIZE || '20', 10);

interface EvalResult {
  strategy: string;
  authorScore: number;
  titleScore: number;
  venueScore: number;
  yearAccuracy: number;
  avgLatencyMs: number;
  evaluatedOn: number;
}

interface CitationItem {
  raw: string;
  author: string;
  title: string;
  venue: string;
  year: string;
}

function printProgressBar(current: number, total: number, prefix: string) {
  const width = 30;
  const percent = Math.min(Math.max(current / total, 0), 1);
  const filled = Math.round(width * percent);
  const empty = width - filled;
  const bar = "█".repeat(filled) + "░".repeat(empty);
  const pctStr = (percent * 100).toFixed(1);
  process.stdout.write(`\r${prefix.padEnd(25)}: [${bar}] ${current}/${total} (${pctStr}%)`);
  if (current === total) {
    process.stdout.write("\n");
  }
}

async function runEvaluation() {
  console.log("=================================================");
  console.log("CITATION METADATA EXTRACTION EVALUATION");
  console.log("=================================================");
  console.log(`Annotations Directory: ${ANNOTATIONS_DIR}`);
  console.log(`Sample Size per Paper: ${SAMPLE_SIZE_PER_PAPER} per paper`);
  
  // 1. Load and sample ground truth annotations
  const jsonFiles = fs.readdirSync(ANNOTATIONS_DIR).filter(f => f.endsWith('.json'));
  const evaluationSet: CitationItem[] = [];

  for (const file of jsonFiles) {
    const filePath = path.join(ANNOTATIONS_DIR, file);
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    
    const bibEntries = data.bib_entries || {};
    const mapped: CitationItem[] = Object.values(bibEntries).map((ann: any) => {
      const authorsStr = Array.isArray(ann.authors) ? ann.authors.join(' and ') : (ann.author || '');
      const raw = `${authorsStr}. ${ann.title}. ${ann.year || ''}.`;
      return {
        raw,
        author: authorsStr,
        title: ann.title || "",
        venue: ann.venue || "",
        year: ann.year ? String(ann.year) : ""
      };
    }).filter((d: CitationItem) => d.raw && (d.author || d.title));

    // Sample items from this paper
    const sampled = mapped.slice(0, SAMPLE_SIZE_PER_PAPER);
    evaluationSet.push(...sampled);
  }

  console.log(`Total citation entries loaded: ${evaluationSet.length}`);

  // Warm up local pipelines once to get accurate latency metrics
  console.log("\nPre-loading and warming up BERT NER model...");
  const warmupStart = Date.now();
  await initNerPipeline();
  console.log(`BERT NER model loaded in ${((Date.now() - warmupStart) / 1000).toFixed(1)}s`);

  // Define strategies to run
  const strategies = [
    {
      name: '1. Regex-Simple',
      run: async (text: string) => parseRegexSimple(text)
    },
    {
      name: '2. Regex-Heuristics',
      run: async (text: string) => parseRegexHeuristics(text)
    },
    {
      name: '3. BERT-NER-Standard',
      run: async (text: string) => parseBertNer(text)
    },
    {
      name: '4. BERT-NER-Strict',
      run: async (text: string) => parseBertNerStrict(text)
    },
    {
      name: '5. Hybrid-NER-Heuristics',
      run: async (text: string) => parseHybridNerHeuristics(text)
    }
  ];

  const results: EvalResult[] = [];

  // Run evaluation for each strategy
  for (const strategy of strategies) {
    const totalCount = evaluationSet.length;
    
    let totalAuthorScore = 0;
    let totalTitleScore = 0;
    let totalVenueScore = 0;
    let totalYearCorrect = 0;
    let totalTimeMs = 0;
    let count = 0;

    printProgressBar(0, totalCount, strategy.name);

    for (const item of evaluationSet) {
      const start = Date.now();
      let extracted: ExtractedMetadata;
      try {
        extracted = await strategy.run(item.raw);
      } catch (err) {
        console.error(`\nError in strategy ${strategy.name} on text: "${item.raw.substring(0, 40)}...":`, err);
        continue;
      }
      const latency = Date.now() - start;
      totalTimeMs += latency;
      count++;

      // Score fields
      const authorSim = getDiceSimilarity(item.author, extracted.authors.join(" and "));
      const titleSim = getDiceSimilarity(item.title, extracted.title);
      const venueSim = getDiceSimilarity(item.venue, extracted.venue);
      const yearCorrect = item.year.trim() === extracted.year.trim() ? 1 : 0;

      totalAuthorScore += authorSim;
      totalTitleScore += titleSim;
      totalVenueScore += venueSim;
      totalYearCorrect += yearCorrect;

      printProgressBar(count, totalCount, strategy.name);
    }

    results.push({
      strategy: strategy.name,
      authorScore: totalAuthorScore / count,
      titleScore: totalTitleScore / count,
      venueScore: totalVenueScore / count,
      yearAccuracy: totalYearCorrect / count,
      avgLatencyMs: totalTimeMs / count,
      evaluatedOn: count
    });
  }

  // Print results
  console.log("\n==========================================================================================");
  console.log("EVALUATION RESULTS SUMMARY");
  console.log("==========================================================================================");
  
  console.log(
    String("Strategy").padEnd(25) + " | " +
    String("Author Match").padEnd(12) + " | " +
    String("Title Match").padEnd(12) + " | " +
    String("Venue Match").padEnd(12) + " | " +
    String("Year Acc").padEnd(8) + " | " +
    String("Latency (ms)").padEnd(12) + " | " +
    String("Samples")
  );
  console.log("-".repeat(98));
  for (const r of results) {
    console.log(
      r.strategy.padEnd(25) + " | " +
      ((r.authorScore * 100).toFixed(1) + '%').padEnd(12) + " | " +
      ((r.titleScore * 100).toFixed(1) + '%').padEnd(12) + " | " +
      ((r.venueScore * 100).toFixed(1) + '%').padEnd(12) + " | " +
      ((r.yearAccuracy * 100).toFixed(1) + '%').padEnd(8) + " | " +
      r.avgLatencyMs.toFixed(1).padEnd(12) + " | " +
      r.evaluatedOn
    );
  }
  console.log("==========================================================================================");
}

runEvaluation().catch(console.error);
