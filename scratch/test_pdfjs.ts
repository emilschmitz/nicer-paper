import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import path from 'path';
import fs from 'fs';

pdfjsLib.GlobalWorkerOptions.workerSrc = path.resolve('node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs');

try {
  const fileBuffer = fs.readFileSync('pdfs/2015_Deep_Residual_Learning_for_Image_Recognition.pdf');
  const data = new Uint8Array(fileBuffer);
  const doc = await pdfjsLib.getDocument({ data }).promise;
  console.log('Successfully loaded PDF via buffer!');
  console.log('Pages count:', doc.numPages);
} catch (err) {
  console.error('Error loading PDF:', err);
}
