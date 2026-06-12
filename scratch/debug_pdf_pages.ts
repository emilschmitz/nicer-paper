import fs from 'fs';
import path from 'path';
import { loadPdfDocument, extractPageTextAndLinks, findReferencesStartPage, findReferencesHeaderY } from '../src/extractor/pdfParser';
import { groupItemsIntoLines } from '../src/extractor/segmenter';
import { TextItem } from '../src/extractor/types';

const WORKER_SRC = path.resolve('node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs');
const PDF_FILE = './pdfs/2018_BERT_Pre-training_of_Deep_Bidirectional_Transformers_for_Language_Understanding.pdf';

async function main() {
  const fileBuffer = fs.readFileSync(PDF_FILE);
  const doc = await loadPdfDocument(new Uint8Array(fileBuffer), { workerSrc: WORKER_SRC });
  const numPages = doc.numPages;
  console.log(`Total PDF Pages: ${numPages}`);

  const allTextItems: { [pageNum: number]: TextItem[] } = {};
  for (let p = 1; p <= numPages; p++) {
    allTextItems[p] = (await extractPageTextAndLinks(doc, p)).textItems;
  }

  const refStartPage = findReferencesStartPage(allTextItems, numPages);
  console.log(`Detected References Start Page: ${refStartPage}`);

  let bibliographyText = '';
  const columnBoundary = 270;

  for (let p = refStartPage; p <= numPages; p++) {
    const pageItems = (allTextItems[p] || []).filter(it => it.y > 50 && it.y < 730);
    if (pageItems.length === 0) continue;

    let leftColumnItems = pageItems.filter(it => it.x < columnBoundary);
    let rightColumnItems = pageItems.filter(it => it.x >= columnBoundary);

    if (p === refStartPage) {
      const headerItem = pageItems.find(it => 
        /^\s*(\d+[\s\.]*)?(references|bibliography|literature citgled)\s*$/i.test(it.text.trim())
      );
      if (headerItem) {
        console.log(`Found references header at page ${p}, x=${headerItem.x.toFixed(1)}, y=${headerItem.y.toFixed(1)}`);
        const isHeaderInLeft = headerItem.x < columnBoundary;
        if (isHeaderInLeft) {
          leftColumnItems = leftColumnItems.filter(it => it.y < headerItem.y - 5);
          // right column is fully references
        } else {
          leftColumnItems = []; // discard completely
          rightColumnItems = rightColumnItems.filter(it => it.y < headerItem.y - 5);
        }
      }
    }

    const leftLines = groupItemsIntoLines(leftColumnItems);
    const rightLines = groupItemsIntoLines(rightColumnItems);

    bibliographyText += `--- Page ${p} ---\n`;
    bibliographyText += leftLines.map(l => l.text).join('\n') + '\n';
    bibliographyText += rightLines.map(l => l.text).join('\n') + '\n';
  }

  console.log(`Bibliography text character count: ${bibliographyText.length}`);
  console.log(`Bibliography text word count: ${bibliographyText.split(/\s+/).length}`);
  
  console.log("\n--- FIRST 500 CHARACTERS ---");
  console.log(bibliographyText.substring(0, 500));
  
  console.log("\n--- LAST 500 CHARACTERS ---");
  console.log(bibliographyText.substring(bibliographyText.length - 500));
}

main().catch(console.error);
