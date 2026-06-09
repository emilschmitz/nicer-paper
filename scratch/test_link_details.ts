import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import path from 'path';
import fs from 'fs';

pdfjsLib.GlobalWorkerOptions.workerSrc = path.resolve('node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs');

try {
  const fileBuffer = fs.readFileSync('pdfs/2015_Deep_Residual_Learning_for_Image_Recognition.pdf');
  const data = new Uint8Array(fileBuffer);
  const doc = await pdfjsLib.getDocument({ data }).promise;

  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const annotations = await page.getAnnotations();
    const links = annotations.filter(ann => ann.subtype === 'Link');
    if (links.length > 0) {
      console.log(`Page ${i} has ${links.length} links:`);
      links.slice(0, 3).forEach(l => {
        console.log(`  - rect: ${l.rect}, url: ${l.url}, dest: ${JSON.stringify(l.dest)}`);
      });
    }
  }
} catch (err) {
  console.error('Error:', err);
}
