import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import path from 'path';
import fs from 'fs';

pdfjsLib.GlobalWorkerOptions.workerSrc = path.resolve('node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs');

try {
  const fileBuffer = fs.readFileSync('pdfs/2021_Learning_Transferable_Visual_Models_from_Natural_Language_Supervision.pdf');
  const data = new Uint8Array(fileBuffer);
  const doc = await pdfjsLib.getDocument({ data }).promise;

  let citeLinksCount = 0;
  let sampleDests: any[] = [];

  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const annotations = await page.getAnnotations();
    const links = annotations.filter((ann: any) => ann.subtype === 'Link');
    for (const link of links) {
      if (link.dest) {
        citeLinksCount++;
        if (sampleDests.length < 5) {
          try {
            const dest = await doc.getDestination(link.dest);
            sampleDests.push({ name: link.dest, dest });
          } catch (e) {}
        }
      }
    }
  }

  console.log(`Total internal links found: ${citeLinksCount}`);
  console.log('Sample resolved destinations:');
  console.log(JSON.stringify(sampleDests, null, 2));

} catch (err) {
  console.error(err);
}
