import fs from 'fs';
import path from 'path';
import { loadPdfDocument, extractPageTextAndLinks, findReferencesStartPage } from '../src/extractor/pdfParser';
import { groupItemsIntoLines } from '../src/extractor/segmenter';
import { TextItem } from '../src/extractor/types';

// Load environment variables manually
const envPath = path.resolve('.env');
const envContent = fs.readFileSync(envPath, 'utf8');
const env: { [key: string]: string } = {};
envContent.split('\n').forEach(line => {
  const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
  if (match) {
    let value = match[2] ? match[2].trim() : '';
    if (value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1);
    }
    env[match[1]] = value;
  }
});

const API_KEY = env['OPENROUTER_API_KEY'];
if (!API_KEY) {
  console.error("No OPENROUTER_API_KEY found in .env");
  process.exit(1);
}

const WORKER_SRC = path.resolve('node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs');
const PDF_DIR = './pdfs';
const ANNOTATIONS_DIR = './annotations';

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
  const b1 = getBigrams(s1 || '');
  const b2 = getBigrams(s2 || '');
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

async function processPaper(jsonFile: string) {
  const jsonPath = path.join(ANNOTATIONS_DIR, jsonFile);
  const gt = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  
  if (gt.length === 0) return null;
  const pdfFilename = gt[0].source_paper;
  const pdfPath = path.join(PDF_DIR, pdfFilename);

  if (!fs.existsSync(pdfPath)) {
    console.warn(`PDF not found: ${pdfPath}`);
    return null;
  }

  console.log(`\n[${pdfFilename}] Parsing PDF locally...`);
  const fileBuffer = fs.readFileSync(pdfPath);
  const doc = await loadPdfDocument(new Uint8Array(fileBuffer), { workerSrc: WORKER_SRC });
  const numPages = doc.numPages;

  const allTextItems: { [pageNum: number]: TextItem[] } = {};
  for (let p = 1; p <= numPages; p++) {
    const pageData = await extractPageTextAndLinks(doc, p);
    allTextItems[p] = pageData.textItems;
  }

  const refStartPage = findReferencesStartPage(allTextItems, numPages);
  
  let bibliographyText = '';
  const columnBoundary = 270;

  for (let p = refStartPage; p <= numPages; p++) {
    const pageItems = (allTextItems[p] || []).filter(it => it.y > 50 && it.y < 730);
    if (pageItems.length === 0) continue;

    let leftColumnItems = pageItems.filter(it => it.x < columnBoundary);
    let rightColumnItems = pageItems.filter(it => it.x >= columnBoundary);

    if (p === refStartPage) {
      const headerItem = pageItems.find(it => 
        /^\s*(\d+[\s\.]*)?(references|bibliography|literature citgled)\s*$/i.test(it.text.trim())
      );
      if (headerItem) {
        console.log(`[${pdfFilename}] Found references header on start page ${p}, x=${headerItem.x.toFixed(1)}, y=${headerItem.y.toFixed(1)}`);
        const isHeaderInLeft = headerItem.x < columnBoundary;
        if (isHeaderInLeft) {
          leftColumnItems = leftColumnItems.filter(it => it.y < headerItem.y - 5);
        } else {
          leftColumnItems = [];
          rightColumnItems = rightColumnItems.filter(it => it.y < headerItem.y - 5);
        }
      }
    }

    const leftLines = groupItemsIntoLines(leftColumnItems);
    const rightLines = groupItemsIntoLines(rightColumnItems);

    bibliographyText += `--- Page ${p} ---\n`;
    bibliographyText += leftLines.map(l => l.text).join('\n') + '\n';
    bibliographyText += rightLines.map(l => l.text).join('\n') + '\n';
  }

  const prompt = `Extract all bibliography references from the following text (which is the references/bibliography section of a paper).
For each reference, extract and return a JSON array containing objects structured exactly like this:
{
  "raw": "the full raw citation text as printed",
  "type": "article | book | inproceedings | phdthesis | misc | techreport",
  "author": "BibTeX format author string, separated by ' and '. Keep names EXACTLY as spelled in the raw citation text. Do NOT expand initials/abbreviations to full names (e.g. if the citation has 'Y. Bengio', format it as 'Y. Bengio' or 'Bengio, Y.', do NOT expand it to 'Yoshua Bengio'). If the citation lists 'Y. Bengio, P. Simard, and P. Frasconi', output 'Y. Bengio and P. Simard and P. Frasconi'.",
  "title": "Title of the work",
  "year": "Publication year",
  "journal": "Journal name",
  "booktitle": "Booktitle/Conference name",
  "volume": "Volume",
  "number": "Number",
  "pages": "Pages (e.g. '157--166' with double dash for ranges)",
  "publisher": "Publisher",
  "doi": "DOI if any",
  "url": "URL if any",
  "eprint": "arXiv ID if any"
}

To minimize output token size:
1. Do NOT include any keys that have null, empty, or missing values (just omit them).
2. Do NOT output a 'source_paper' or 'provenance' field.
Format the output strictly as a JSON array of objects. Respond with ONLY the valid JSON array inside a \`\`\`json block.

Bibliography text:
${bibliographyText}`;

  console.log(`[${pdfFilename}] Calling OpenRouter google/gemini-2.5-flash...`);
  const startTime = Date.now();
  
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash",
      messages: [
        {
          role: "user",
          content: prompt
        }
      ],
      max_tokens: 8192
    })
  });

  const resultData: any = await response.json();
  const duration = Date.now() - startTime;
  console.log(`[${pdfFilename}] Request completed in ${(duration / 1000).toFixed(1)}s.`);
  
  if (resultData.error) {
    console.error(`[${pdfFilename}] API Error:`, resultData.error);
    return null;
  }

  const content = resultData.choices?.[0]?.message?.content || "";
  let jsonStr = content;
  const jsonStart = jsonStr.indexOf('[');
  const jsonEnd = jsonStr.lastIndexOf(']');
  if (jsonStart !== -1 && jsonEnd !== -1) {
    jsonStr = jsonStr.substring(jsonStart, jsonEnd + 1);
  }

  let llmEntries = [];
  try {
    llmEntries = JSON.parse(jsonStr);
  } catch (err) {
    console.error(`[${pdfFilename}] JSON parse error on response:`, err);
    console.log("Raw content:", content);
    return null;
  }

  return {
    pdfFilename,
    gt,
    llmEntries,
    usage: resultData.usage
  };
}

async function main() {
  const jsonFiles = fs.readdirSync(ANNOTATIONS_DIR).filter(f => f.endsWith('.json'));
  console.log(`Found ground truth files: ${jsonFiles.join(', ')}`);

  console.log("Starting parallel runs for all 5 papers using Google Gemini 2.5 Flash...");
  const promises = jsonFiles.map(file => processPaper(file));
  const results = await Promise.all(promises);

  console.log("\n=========================================");
  console.log("GEMINI 2.5 FLASH EVALUATION RESULTS");
  console.log("=========================================");

  let grandTotalGt = 0;
  let grandTotalMatched = 0;
  let grandTotalAuthorSim = 0;
  let grandTotalTitleSim = 0;
  let grandTotalVenueSim = 0;
  let grandCorrectYears = 0;
  let grandCorrectTypes = 0;
  let grandCorrectEprints = 0;
  let grandCorrectUrls = 0;

  for (const r of results) {
    if (!r) continue;
    const { pdfFilename, gt, llmEntries } = r;

    let paperMatched = 0;
    let paperAuthorSim = 0;
    let paperTitleSim = 0;
    let paperVenueSim = 0;
    let paperCorrectYears = 0;
    let paperCorrectTypes = 0;
    let paperCorrectEprints = 0;
    let paperCorrectUrls = 0;

    for (const gtEntry of gt) {
      let bestMatch: any = null;
      let bestScore = 0;

      for (const llmEntry of llmEntries) {
        const score = getDiceSimilarity(gtEntry.raw, llmEntry.raw);
        if (score > bestScore) {
          bestScore = score;
          bestMatch = llmEntry;
        }
      }

      if (bestScore >= 0.7 && bestMatch) {
        paperMatched++;
        
        const authorSim = getDiceSimilarity(gtEntry.author, bestMatch.author);
        const titleSim = getDiceSimilarity(gtEntry.title, bestMatch.title);
        
        const gtVenue = gtEntry.journal || gtEntry.booktitle || "";
        const llmVenue = bestMatch.journal || bestMatch.booktitle || "";
        const venueSim = getDiceSimilarity(gtVenue, llmVenue);

        const yearCorrect = (gtEntry.year || "").trim() === (bestMatch.year || "").trim() ? 1 : 0;
        const typeCorrect = (gtEntry.type || "").trim().toLowerCase() === (bestMatch.type || "").trim().toLowerCase() ? 1 : 0;
        
        const gtEprint = gtEntry.eprint || null;
        const llmEprint = bestMatch.eprint || null;
        const eprintCorrect = gtEprint === llmEprint ? 1 : 0;

        const gtUrl = gtEntry.url || null;
        const llmUrl = bestMatch.url || null;
        const urlCorrect = gtUrl === llmUrl ? 1 : 0;

        paperAuthorSim += authorSim;
        paperTitleSim += titleSim;
        paperVenueSim += venueSim;
        paperCorrectYears += yearCorrect;
        paperCorrectTypes += typeCorrect;
        paperCorrectEprints += eprintCorrect;
        paperCorrectUrls += urlCorrect;
      }
    }

    grandTotalGt += gt.length;
    grandTotalMatched += paperMatched;
    grandTotalAuthorSim += paperAuthorSim;
    grandTotalTitleSim += paperTitleSim;
    grandTotalVenueSim += paperVenueSim;
    grandCorrectYears += paperCorrectYears;
    grandCorrectTypes += paperCorrectTypes;
    grandCorrectEprints += paperCorrectEprints;
    grandCorrectUrls += paperCorrectUrls;

    console.log(`\nPaper: ${pdfFilename}`);
    console.log(`  Citations in GT: ${gt.length}`);
    console.log(`  Matched by LLM:  ${paperMatched} (${((paperMatched / gt.length) * 100).toFixed(1)}%)`);
    if (paperMatched > 0) {
      console.log(`  Author Similarity: ${((paperAuthorSim / paperMatched) * 100).toFixed(1)}%`);
      console.log(`  Title Similarity:  ${((paperTitleSim / paperMatched) * 100).toFixed(1)}%`);
      console.log(`  Venue Similarity:  ${((paperVenueSim / paperMatched) * 100).toFixed(1)}%`);
      console.log(`  Year Accuracy:     ${((paperCorrectYears / paperMatched) * 100).toFixed(1)}%`);
    }
  }

  console.log("\n=========================================");
  console.log("GEMINI 2.5 FLASH OVERALL SUMMARY STATS");
  console.log("=========================================");
  console.log(`Total Citations in GT:      ${grandTotalGt}`);
  console.log(`Successfully Matched:       ${grandTotalMatched} / ${grandTotalGt} (${((grandTotalMatched / grandTotalGt) * 100).toFixed(1)}%)`);
  if (grandTotalMatched > 0) {
    console.log(`Average Author Similarity:  ${((grandTotalAuthorSim / grandTotalMatched) * 100).toFixed(1)}%`);
    console.log(`Average Title Similarity:   ${((grandTotalTitleSim / grandTotalMatched) * 100).toFixed(1)}%`);
    console.log(`Average Venue Similarity:   ${((grandTotalVenueSim / grandTotalMatched) * 100).toFixed(1)}%`);
    console.log(`Year Accuracy:              ${((grandCorrectYears / grandTotalMatched) * 100).toFixed(1)}%`);
    console.log(`Type Accuracy:              ${((grandCorrectTypes / grandTotalMatched) * 100).toFixed(1)}%`);
    console.log(`Eprint Match Accuracy:      ${((grandCorrectEprints / grandTotalMatched) * 100).toFixed(1)}%`);
    console.log(`Url Match Accuracy:         ${((grandCorrectUrls / grandTotalMatched) * 100).toFixed(1)}%`);
  }
  console.log("=========================================");
}

main().catch(console.error);
