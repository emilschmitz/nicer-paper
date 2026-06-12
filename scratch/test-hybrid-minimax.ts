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
  const columnBoundary = 270; // standard column boundary

  for (let p = refStartPage; p <= numPages; p++) {
    const pageItems = (allTextItems[p] || []).filter(it => it.y > 50 && it.y < 730);
    if (pageItems.length === 0) continue;

    // Partition by column boundary
    const leftColumnItems = pageItems.filter(it => it.x < columnBoundary);
    const rightColumnItems = pageItems.filter(it => it.x >= columnBoundary);

    // Group into lines
    const leftLines = groupItemsIntoLines(leftColumnItems);
    const rightLines = groupItemsIntoLines(rightColumnItems);

    // Concatenate left then right column text
    const leftText = leftLines.map(l => l.text).join('\n');
    const rightText = rightLines.map(l => l.text).join('\n');

    bibliographyText += `--- Page ${p} ---\n`;
    bibliographyText += leftText + '\n' + rightText + '\n';
  }

  console.log(`Extracted bibliography text length: ${bibliographyText.length} characters.`);
  console.log("First 500 characters of bibliography text:\n");
  console.log(bibliographyText.substring(0, 500));
  console.log("\n=========================================\n");

  const prompt = `Extract all bibliography references from the following text (which is the references/bibliography section of a paper).
For each reference, extract and return a JSON array containing objects structured exactly like this:
{
  "source_paper": "2015_Deep_Residual_Learning_for_Image_Recognition.pdf",
  "raw": "the full raw citation text as printed",
  "type": "article | book | inproceedings | phdthesis | misc | techreport",
  "author": "BibTeX author format (e.g. 'Bengio, Yoshua and Simard, Patrice and Frasconi, Paolo')",
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
  "provenance": "minimax_m3_extraction"
}

Format the output strictly as a JSON array of objects. Respond with ONLY the valid JSON array inside a \`\`\`json block.

Bibliography text:
${bibliographyText}`;

  console.log("Calling OpenRouter with minimax/minimax-m3...");
  const startTime = Date.now();
  try {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "minimax/minimax-m3",
        messages: [
          {
            role: "user",
            content: prompt
          }
        ]
      })
    });

    const resultData: any = await response.json();
    const duration = Date.now() - startTime;
    console.log(`Request completed in ${(duration / 1000).toFixed(1)}s.`);
    
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
    const outFile = path.join(outDir, `minimax_resnet_hybrid_${Date.now()}.json`);
    fs.writeFileSync(outFile, JSON.stringify(resultData, null, 2));
    console.log(`\nSaved response to: ${outFile}`);

  } catch (err) {
    console.error("Request failed:", err);
  }
}

main().catch(console.error);
