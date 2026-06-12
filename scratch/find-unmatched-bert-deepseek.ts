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
const WORKER_SRC = path.resolve('node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs');
const PDF_FILE = './pdfs/2018_BERT_Pre-training_of_Deep_Bidirectional_Transformers_for_Language_Understanding.pdf';
const GT_FILE = './annotations/2018.json';

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

async function main() {
  const gt = JSON.parse(fs.readFileSync(GT_FILE, 'utf8'));
  const fileBuffer = fs.readFileSync(PDF_FILE);
  
  console.log("Parsing BERT PDF locally...");
  const doc = await loadPdfDocument(new Uint8Array(fileBuffer), { workerSrc: WORKER_SRC });
  const numPages = doc.numPages;

  const allTextItems: { [pageNum: number]: TextItem[] } = {};
  for (let p = 1; p <= numPages; p++) {
    allTextItems[p] = (await extractPageTextAndLinks(doc, p)).textItems;
  }

  const refStartPage = findReferencesStartPage(allTextItems, numPages);
  let bibliographyText = '';
  const columnBoundary = 270;

  for (let p = refStartPage; p <= numPages; p++) {
    const pageItems = (allTextItems[p] || []).filter(it => it.y > 50 && it.y < 730);
    if (pageItems.length === 0) continue;

    const leftColumnItems = pageItems.filter(it => it.x < columnBoundary);
    const rightColumnItems = pageItems.filter(it => it.x >= columnBoundary);

    const leftLines = groupItemsIntoLines(leftColumnItems);
    const rightLines = groupItemsIntoLines(rightColumnItems);

    bibliographyText += `--- Page ${p} ---\n`;
    bibliographyText += leftLines.map(l => l.text).join('\n') + '\n';
    bibliographyText += rightLines.map(l => l.text).join('\n') + '\n';
  }

  const prompt = `Extract all bibliography references from the following text.
For each reference, extract and return a JSON array containing objects structured exactly like this:
{
  "source_paper": "2018_BERT_Pre-training_of_Deep_Bidirectional_Transformers_for_Language_Understanding.pdf",
  "raw": "the full raw citation text as printed",
  "type": "article | book | inproceedings | phdthesis | misc | techreport",
  "author": "BibTeX format author string, separated by ' and '. Keep names EXACTLY as spelled in the raw citation text. Do NOT expand initials/abbreviations to full names.",
  "title": "Title of the work",
  "year": "Publication year",
  "journal": "Journal name or null",
  "booktitle": "Booktitle/Conference name or null",
  "volume": "Volume or null",
  "number": "Number or null",
  "pages": "Pages (e.g. '157--166') or null",
  "publisher": "Publisher or null",
  "doi": "DOI if any or null",
  "url": "URL if any or null",
  "eprint": "arXiv ID if any or null",
  "provenance": "deepseek_v4_flash_extraction"
}

Format the output strictly as a JSON array of objects. Respond with ONLY the valid JSON array inside a \`\`\`json block.

Bibliography text:
${bibliographyText}`;

  console.log("Calling OpenRouter deepseek/deepseek-v4-flash...");
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "deepseek/deepseek-v4-flash",
      messages: [{ role: "user", content: prompt }],
      max_tokens: 4096
    })
  });

  const resultData: any = await response.json();
  console.log("Raw resultData:", JSON.stringify(resultData, null, 2));
  if (resultData.error) {
    console.error("API Error:", resultData.error);
    process.exit(1);
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
    console.error("JSON parse error on response:", err);
    console.log("Raw content:", content);
    process.exit(1);
  }

  console.log(`Loaded GT: ${gt.length} entries`);
  console.log(`Loaded LLM: ${llmEntries.length} entries`);

  console.log("\n--- UNMATCHED ENTRIES ---");
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

    if (bestScore < 0.7) {
      console.log(`\nUnmatched GT Entry:`);
      console.log(`  Raw: "${gtEntry.raw}"`);
      console.log(`  Best similarity score was: ${bestScore.toFixed(2)}`);
    } else {
      console.log(`✓ Matched GT Entry: "${gtEntry.raw.substring(0, 40)}..." (score: ${bestScore.toFixed(2)})`);
    }
  }
}

main().catch(console.error);
