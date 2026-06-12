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

const PDF_FILE = 'pdfs/2015_Deep_Residual_Learning_for_Image_Recognition.pdf';
const PDF_PATH = path.resolve(PDF_FILE);
const WORKER_SRC = path.resolve('node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs');

async function main() {
  console.log(`Loading PDF: ${PDF_FILE}...`);
  const fileBuffer = fs.readFileSync(PDF_PATH);
  const data = new Uint8Array(fileBuffer);
  
  const doc = await loadPdfDocument(data, { workerSrc: WORKER_SRC });
  const numPages = doc.numPages;
  console.log(`PDF loaded. Total pages: ${numPages}`);

  const allTextItems: { [pageNum: number]: TextItem[] } = {};
  
  // Extract text items page by page
  for (let p = 1; p <= numPages; p++) {
    const pageData = await extractPageTextAndLinks(doc, p);
    allTextItems[p] = pageData.textItems;
  }

  // Find references start page
  const refStartPage = findReferencesStartPage(allTextItems, numPages);
  console.log(`References start page: ${refStartPage}`);

  // Extract raw bibliography text preserving columns
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
        console.log(`Found references header on start page ${p}, x=${headerItem.x.toFixed(1)}, y=${headerItem.y.toFixed(1)}`);
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

  console.log(`Extracted bibliography text length: ${bibliographyText.length} characters.`);

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

  console.log("Calling OpenRouter with deepseek/deepseek-v4-flash...");
  const startTime = Date.now();
  try {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "deepseek/deepseek-v4-flash",
        messages: [
          {
            role: "user",
            content: prompt
          }
        ],
        max_tokens: 4096
      })
    });

    const resultData: any = await response.json();
    const duration = Date.now() - startTime;
    console.log(`Request completed in ${(duration / 1000).toFixed(1)}s.`);
    console.log("Full raw API response JSON:\n", JSON.stringify(resultData, null, 2));
    
    if (resultData.error) {
      console.error("API Error:", resultData.error);
      return;
    }

    const usage = resultData.usage;
    console.log("Usage stats:", usage);
    
    const content = resultData.choices?.[0]?.message?.content;
    console.log("\nResponse Content:\n");
    console.log(content);

    // Save to temp file
    const outDir = path.resolve('tmp');
    if (!fs.existsSync(outDir)) {
      fs.mkdirSync(outDir, { recursive: true });
    }
    const outFile = path.join(outDir, `deepseek_resnet_hybrid_${Date.now()}.json`);
    fs.writeFileSync(outFile, JSON.stringify(resultData, null, 2));
    console.log(`\nSaved response to: ${outFile}`);

  } catch (err) {
    console.error("Request failed:", err);
  }
}

main().catch(console.error);
