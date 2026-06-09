import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import path from 'path';
import fs from 'fs';

pdfjsLib.GlobalWorkerOptions.workerSrc = path.resolve('node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs');

try {
  const fileBuffer = fs.readFileSync('pdfs/2015_Deep_Residual_Learning_for_Image_Recognition.pdf');
  const data = new Uint8Array(fileBuffer);
  const doc = await pdfjsLib.getDocument({ data }).promise;

  // Let's resolve cite.Simonyan2015
  const destName = 'cite.Simonyan2015';
  console.log(`Resolving destination: ${destName}...`);
  const dest = await doc.getDestination(destName);
  console.log('Resulting destination array:', dest);
  if (dest) {
    const pageRef = dest[0];
    const pageIndex = await doc.getPageIndex(pageRef);
    console.log(`Page Index (0-based): ${pageIndex} -> Page Number: ${pageIndex + 1}`);
    console.log(`Coordinates info:`, dest.slice(1));
  }
} catch (err) {
  console.error('Error:', err);
}
