import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import path from 'path';
import fs from 'fs';

pdfjsLib.GlobalWorkerOptions.workerSrc = path.resolve('node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs');

try {
  const fileBuffer = fs.readFileSync('pdfs/2015_Deep_Residual_Learning_for_Image_Recognition.pdf');
  const data = new Uint8Array(fileBuffer);
  const doc = await pdfjsLib.getDocument({ data }).promise;

  const page = await doc.getPage(9); // 1-based page 9
  const textContent = await page.getTextContent();
  
  console.log('All text items on page 9:');
  const items = textContent.items.map(item => {
    return {
      text: item.str,
      x: item.transform[4],
      y: item.transform[5],
      width: item.width,
      height: item.height
    };
  });

  // Sort items top-to-bottom (Y descending), then left-to-right (X ascending)
  // Let's filter for items near x=308.862 and y around 413
  const targetX = 308.862;
  const targetY = 413.418;

  console.log(`\nItems close to target: x=${targetX}, y=${targetY}`);
  
  // Find items where X is in the same column (e.g. 300 to 320) and Y is within 50 points of targetY
  const nearby = items.filter(it => {
    return Math.abs(it.x - targetX) < 40 && Math.abs(it.y - targetY) < 100;
  });

  // Sort by Y descending
  nearby.sort((a, b) => b.y - a.y);

  nearby.forEach(it => {
    console.log(`x=${it.x.toFixed(3)}, y=${it.y.toFixed(3)}, text="${it.text}"`);
  });

} catch (err) {
  console.error('Error:', err);
}
