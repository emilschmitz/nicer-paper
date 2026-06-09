import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import path from 'path';
import fs from 'fs';

pdfjsLib.GlobalWorkerOptions.workerSrc = path.resolve('node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs');

try {
  const fileBuffer = fs.readFileSync('pdfs/2019_EfficientNet_Rethinking_Model_Scaling_for_Convolutional_Neural_Networks.pdf');
  const data = new Uint8Array(fileBuffer);
  const doc = await pdfjsLib.getDocument({ data }).promise;

  const page = await doc.getPage(10); // Page 10 (1-based)
  const textContent = await page.getTextContent();
  
  console.log('First 30 text items on page 10 of EfficientNet:');
  const items = textContent.items.slice(0, 30);
  items.forEach((it: any, index: number) => {
    console.log(`[${index}] x=${it.transform[4].toFixed(2)}, y=${it.transform[5].toFixed(2)}, text="${it.str}"`);
  });
} catch (err) {
  console.error(err);
}
