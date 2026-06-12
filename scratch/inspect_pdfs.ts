import fs from 'fs';
import path from 'path';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';

pdfjsLib.GlobalWorkerOptions.workerSrc = path.resolve('node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs');

async function main() {
  const pdfDir = './pdfs';
  const files = fs.readdirSync(pdfDir).filter(f => f.endsWith('.pdf'));
  console.log(`Found ${files.length} PDFs in ${pdfDir}:`);
  
  for (const file of files) {
    const filePath = path.join(pdfDir, file);
    const fileBuffer = fs.readFileSync(filePath);
    try {
      const doc = await pdfjsLib.getDocument({ data: new Uint8Array(fileBuffer) }).promise;
      console.log(`- ${file}: ${doc.numPages} pages`);
    } catch (err: any) {
      console.error(`Error reading ${file}:`, err.message || err);
    }
  }
}

main().catch(console.error);
