import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import path from 'path';
import fs from 'fs';

pdfjsLib.GlobalWorkerOptions.workerSrc = path.resolve('node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs');

interface TextItem {
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Line {
  y: number;
  x: number;
  text: string;
}

async function testSegment() {
  const fileBuffer = fs.readFileSync('pdfs/2021_Learning_Transferable_Visual_Models_from_Natural_Language_Supervision.pdf');
  const data = new Uint8Array(fileBuffer);
  const doc = await pdfjsLib.getDocument({ data }).promise;

  // Let's look at page 27 (references start page)
  const pageNum = 27;
  const page = await doc.getPage(pageNum);
  const textContent = await page.getTextContent();
  
  const items: TextItem[] = textContent.items.map((item: any) => ({
    text: item.str,
    x: item.transform[4],
    y: item.transform[5],
    w: item.width,
    h: item.height,
  })).filter(it => it.y > 50 && it.y < 730); // Filter headers/footers

  // 1. Group items into lines
  const lineGroups: { [yKey: number]: TextItem[] } = {};
  for (const it of items) {
    let foundY = Object.keys(lineGroups).map(Number).find(y => Math.abs(y - it.y) < 3);
    if (foundY !== undefined) {
      lineGroups[foundY].push(it);
    } else {
      lineGroups[it.y] = [it];
    }
  }

  const lines: Line[] = [];
  for (const yKey of Object.keys(lineGroups).map(Number)) {
    const group = lineGroups[yKey];
    group.sort((a, b) => a.x - b.x);
    const text = group.map(i => i.text).join(' ').replace(/\s+/g, ' ').trim();
    const x = group[0].x;
    lines.push({ y: yKey, x, text });
  }

  // Sort lines top-to-bottom
  lines.sort((a, b) => b.y - a.y);

  // Group lines into left and right columns
  const leftLines = lines.filter(l => l.x < 250);
  const rightLines = lines.filter(l => l.x >= 250);

  // Dynamic Margin Detection:
  // Find the minimum X start coordinate of lines in each column (filtering out noise/indented peaks)
  const getColumnMargin = (colLines: Line[], defaultMargin: number) => {
    if (colLines.length === 0) return defaultMargin;
    
    // Get all start X values and sort them
    const xs = colLines.map(l => Math.round(l.x)).sort((a, b) => a - b);
    
    // Find the smallest X that appears at least 2 times (to avoid single-word/outlier noise)
    const counts: { [x: number]: number } = {};
    xs.forEach(x => counts[x] = (counts[x] || 0) + 1);
    
    const margin = xs.find(x => counts[x] >= 2);
    return margin !== undefined ? margin : defaultMargin;
  };

  const leftMargin = getColumnMargin(leftLines, 54);
  const rightMargin = getColumnMargin(rightLines, 307);

  console.log(`Detected margins: Left Column=${leftMargin}, Right Column=${rightMargin}`);

  // 3. Segment into blocks per column
  const segmentColumn = (colLines: Line[], margin: number) => {
    const blocks: string[] = [];
    let currentBlock = '';
    
    colLines.forEach(l => {
      // Ignore section titles or acknowledgments
      if (/^(references|bibliography|acknowledgments)/i.test(l.text.trim())) return;
      if (l.text.trim().length < 2) return;
      
      // A line is a reference start if it is flush-left (i.e. close to the minimum margin)
      // Any line indented further (e.g. x >= margin + 6) is a continuation line
      const isStart = l.x <= margin + 3;
      
      if (isStart) {
        if (currentBlock) {
          blocks.push(currentBlock.replace(/\s+/g, ' ').trim());
        }
        currentBlock = l.text;
      } else {
        if (currentBlock) {
          if (currentBlock.endsWith('-')) {
            currentBlock = currentBlock.slice(0, -1) + l.text;
          } else {
            currentBlock += ' ' + l.text;
          }
        } else {
          // If no active block, start one (handles text that doesn't start exactly at margin on page breaks)
          currentBlock = l.text;
        }
      }
    });
    if (currentBlock) {
      blocks.push(currentBlock.replace(/\s+/g, ' ').trim());
    }
    return blocks;
  };

  const leftBlocks = segmentColumn(leftLines, leftMargin);
  const rightBlocks = segmentColumn(rightLines, rightMargin);

  console.log(`\n--- Extracted ${leftBlocks.length} blocks from Left Column (Body/Conclusion) ---`);
  leftBlocks.slice(0, 3).forEach((b, i) => console.log(`[Left ${i+1}] ${b.substring(0, 150)}...`));

  console.log(`\n--- Extracted ${rightBlocks.length} blocks from Right Column (References) ---`);
  rightBlocks.slice(0, 5).forEach((b, i) => console.log(`[Right ${i+1}] ${b.substring(0, 150)}...`));
}

testSegment().catch(console.error);
