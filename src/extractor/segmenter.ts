import { TextItem, Line } from './types';

/**
 * Groups raw text items on a page into sorted lines based on their vertical Y coordinate.
 */
export function groupItemsIntoLines(items: TextItem[]): Line[] {
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
    const text = group.map(i => i.text).join(' ');
    const x = group[0].x;
    lines.push({ y: yKey, x, text, items: group });
  }
  lines.sort((a, b) => b.y - a.y);
  return lines;
}

/**
 * Dynamically detects the left margin of a column by finding the minimum X coordinate that appears repeatedly.
 */
export function getColumnMargin(colLines: Line[], defaultMargin: number): number {
  if (colLines.length === 0) return defaultMargin;
  const xs = colLines.map(l => Math.round(l.x)).sort((a, b) => a - b);
  const counts: { [x: number]: number } = {};
  xs.forEach(x => counts[x] = (counts[x] || 0) + 1);
  // Find the smallest X that appears at least 2 times to filter out outliers
  const margin = xs.find(x => counts[x] >= 2);
  return margin !== undefined ? margin : defaultMargin;
}

interface SegmentedBlock {
  startY: number;
  text: string;
  items: TextItem[];
}

/**
 * Segments lines of a column into reference blocks based on flush-left start margins and numbering regexes.
 */
export function segmentColumnIntoBlocks(
  colLines: Line[], 
  margin: number, 
  isNumberedStyle = false
): SegmentedBlock[] {
  const colBlocks: SegmentedBlock[] = [];
  let currentStartY = 0;
  let currentText = '';
  let currentItems: TextItem[] = [];
  
  colLines.forEach(l => {
    // Ignore common sections
    if (/^(references|bibliography|acknowledgments)/i.test(l.text.trim())) return;
    if (l.text.trim().length < 2) return;
    
    // Check if line is a start of a reference entry:
    // 1. Starts flush-left (within tolerance of column margin)
    // 2. Starts with a bracket number like [1] or dot list like 1.
    const isFlushLeft = l.x <= margin + 8;
    const isNumbered = /^\[\d+\]/.test(l.text.trim()) || /^\d+\.(\s+|$)/.test(l.text.trim());
    
    const isStart = isNumberedStyle ? isNumbered : (isFlushLeft || isNumbered);
    
    if (isStart) {
      if (currentText) {
        colBlocks.push({
          startY: currentStartY,
          text: currentText.replace(/\s+/g, ' ').trim(),
          items: currentItems,
        });
      }
      currentStartY = l.y;
      currentText = l.text;
      currentItems = [...l.items];
    } else {
      if (currentText) {
        if (currentText.endsWith('-')) {
          currentText = currentText.slice(0, -1) + l.text;
        } else {
          currentText += ' ' + l.text;
        }
        currentItems.push(...l.items);
      } else {
        currentStartY = l.y;
        currentText = l.text;
        currentItems = [...l.items];
      }
    }
  });

  if (currentText) {
    colBlocks.push({
      startY: currentStartY,
      text: currentText.replace(/\s+/g, ' ').trim(),
      items: currentItems,
    });
  }
  return colBlocks;
}
