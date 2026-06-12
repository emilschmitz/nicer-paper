import fs from 'fs';
import path from 'path';
import { loadPdfDocument, extractPageTextAndLinks } from '../src/extractor/pdfParser';

const WORKER_SRC = path.resolve('node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs');
const PDF_FILE = './pdfs/2018_BERT_Pre-training_of_Deep_Bidirectional_Transformers_for_Language_Understanding.pdf';

async function main() {
  const fileBuffer = fs.readFileSync(PDF_FILE);
  const doc = await loadPdfDocument(new Uint8Array(fileBuffer), { workerSrc: WORKER_SRC });
  const numPages = doc.numPages;
  console.log(`Total Pages: ${numPages}`);

  for (let p = 1; p <= numPages; p++) {
    const { textItems } = await extractPageTextAndLinks(doc, p);
    const text = textItems.map(it => it.text).join(' ');
    console.log(`Page ${p}: char count = ${text.length}`);
    
    // Find text items matching reference keywords
    const matches = textItems.filter(it => 
      /references|bibliography/i.test(it.text)
    );
    if (matches.length > 0) {
      console.log(`  Matches on page ${p}:`);
      matches.forEach(m => console.log(`    - "${m.text}" at x=${m.x.toFixed(1)}, y=${m.y.toFixed(1)}`));
    }
  }
}

main().catch(console.error);
