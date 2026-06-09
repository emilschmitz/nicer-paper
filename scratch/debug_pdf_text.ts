import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import path from 'path';
import fs from 'fs';

pdfjsLib.GlobalWorkerOptions.workerSrc = path.resolve('node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs');

async function debugPdf(pdfPath: string) {
  const fileBuffer = fs.readFileSync(pdfPath);
  const data = new Uint8Array(fileBuffer);
  const doc = await pdfjsLib.getDocument({ data }).promise;
  
  console.log(`\n--- Debugging: ${path.basename(pdfPath)} ---`);
  console.log(`Total Pages: ${doc.numPages}`);
  
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const textContent = await page.getTextContent();
    const text = textContent.items.map((i: any) => i.str).join(' ');
    
    // Look for references keyword
    const refMatch = text.match(/references|bibliography/i);
    if (refMatch) {
      console.log(`Page ${p} matches keyword: "${refMatch[0]}"`);
      // Print first 100 characters around match
      const index = text.toLowerCase().indexOf(refMatch[0].toLowerCase());
      const snippet = text.substring(Math.max(0, index - 30), Math.min(text.length, index + 80));
      console.log(`  Snippet: "... ${snippet.trim()} ..."`);
    }
  }
}

try {
  await debugPdf('pdfs/2019_EfficientNet_Rethinking_Model_Scaling_for_Convolutional_Neural_Networks.pdf');
  await debugPdf('pdfs/2021_Learning_Transferable_Visual_Models_from_Natural_Language_Supervision.pdf');
} catch (err) {
  console.error(err);
}
