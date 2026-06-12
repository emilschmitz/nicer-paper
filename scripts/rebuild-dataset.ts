import fs from 'fs';
import path from 'path';

const DATASET_PATH = '/home/emil/.cache/kagglehub/datasets/mathurinache/citation-network-dataset/versions/1/dblp.v12.json';
const PDF_DIR = path.resolve('pdfs');
const ANNOTATIONS_DIR = path.resolve('annotations');

// Helper: Clean title for filename
function cleanTitleForFilename(title: string): string {
  return title
    .replace(/\s+/g, '_')
    .replace(/[^a-zA-Z0-9_]/g, '')
    .substring(0, 60);
}

// Sørensen-Dice text similarity
function getBigrams(str: string): Set<string> {
  const s = str.toLowerCase().replace(/\s+/g, '');
  const bigrams = new Set<string>();
  for (let i = 0; i < s.length - 1; i++) {
    bigrams.add(s.substring(i, i + 2));
  }
  return bigrams;
}

function getDiceSimilarity(s1: string, s2: string): number {
  const b1 = getBigrams(s1);
  const b2 = getBigrams(s2);
  if (b1.size === 0 && b2.size === 0) return 1;
  if (b1.size === 0 || b2.size === 0) return 0;
  
  let intersection = 0;
  for (const val of b1) {
    if (b2.has(val)) {
      intersection++;
    }
  }
  return (2 * intersection) / (b1.size + b2.size);
}

// XML parser helpers
function extractTagContent(xml: string, tag: string): string[] {
  const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'g');
  const matches: string[] = [];
  let match;
  while ((match = regex.exec(xml)) !== null) {
    matches.push(match[1].trim());
  }
  return matches;
}

function extractPdfLink(entryXml: string): string | null {
  const match = entryXml.match(/<link[^>]*title="pdf"[^>]*href="([^"]+)"/i) ||
                entryXml.match(/<link[^>]*href="([^"]+)"[^>]*title="pdf"/i);
  if (match) return match[1];
  const idMatch = entryXml.match(/<id>([^<]+)<\/id>/i);
  if (idMatch) {
    const idUrl = idMatch[1].trim();
    if (idUrl.includes('/abs/')) {
      return idUrl.replace('/abs/', '/pdf/') + '.pdf';
    }
  }
  return null;
}

function extractArxivIdFromUrl(url: string): string | null {
  const match = url.match(/\/pdf\/(\d{4}\.\d{4,5}(?:v\d+)?)(?:\.pdf)?/i) ||
                url.match(/\/abs\/(\d{4}\.\d{4,5}(?:v\d+)?)/i) ||
                url.match(/(\d{4}\.\d{4,5}(?:v\d+)?)/);
  return match ? match[1] : null;
}

// Reverse read lines generator
function* reverseReadLines(filePath: string, bufSize = 1024 * 1024) {
  const fd = fs.openSync(filePath, 'r');
  const stat = fs.fstatSync(fd);
  let fileSize = stat.size;
  let remainingSize = fileSize;
  let segment: string | null = null;
  let buffer = Buffer.alloc(bufSize);

  let offset = 0;
  while (remainingSize > 0) {
    const readSize = Math.min(remainingSize, bufSize);
    offset += readSize;
    fs.readSync(fd, buffer, 0, readSize, fileSize - offset);
    remainingSize -= readSize;

    const chunk = buffer.toString('utf8', 0, readSize);
    
    // Level 1 Optimization: Skip splitting blocks that don't even mention 'arxiv' in their venue raw string
    const lower = chunk.toLowerCase();
    const hasArxivVenue = lower.includes('"raw":"arxiv') || lower.includes('"raw": "arxiv') || lower.includes('venue":{"raw":"arxiv') || lower.includes('venue": {"raw": "arxiv');
    if (!hasArxivVenue) {
      const firstNewline = chunk.indexOf('\n');
      if (firstNewline !== -1) {
        segment = chunk.substring(0, firstNewline);
      } else {
        segment = chunk + (segment || '');
      }
      continue;
    }

    const lines = chunk.split('\n');

    if (segment !== null) {
      lines[lines.length - 1] += segment;
    }
    segment = lines[0];

    for (let i = lines.length - 1; i > 0; i--) {
      if (lines[i]) {
        yield lines[i];
      }
    }
  }

  if (segment !== null && segment) {
    yield segment;
  }
  fs.closeSync(fd);
}

async function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function isPdfDownloadable(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { method: 'HEAD' });
    return res.status === 200;
  } catch {
    return false;
  }
}

interface DBLPPaper {
  id: number;
  title: string;
  year: number;
  references?: number[];
  venue?: { raw: string };
  authors?: { name: string }[];
  doi?: string;
}

interface VerifiedPaper extends DBLPPaper {
  arxivId: string;
  pdfUrl: string;
}

async function main() {
  console.log('========================================================================');
  console.log('REBUILDING CITATION DATASET (200 VERIFIED papers, 2010-2024)');
  console.log('========================================================================');

  // 1. Gather candidates from DBLP (reading backwards)
  console.log('Scanning DBLP backwards for candidate arXiv papers...');
  
  const targetPerYear = 20; // Try to verify up to 20 per year to have buffer
  const yearCounts: Record<number, number> = {};
  const candidates: DBLPPaper[] = [];

  for (let year = 2010; year <= 2024; year++) {
    yearCounts[year] = 0;
  }

  let scannedLines = 0;
  for (const line of reverseReadLines(DATASET_PATH)) {
    scannedLines++;
    if (scannedLines % 200000 === 0) {
      console.log(`Scanned ${scannedLines} lines... Collected ${candidates.length} candidates.`);
    }

    if (!line.toLowerCase().includes('arxiv')) continue;

    let cleanLine = line.trim();
    if (cleanLine.startsWith(',')) cleanLine = cleanLine.substring(1);
    if (cleanLine.startsWith('[') || cleanLine.startsWith(']')) continue;
    if (!cleanLine) continue;

    try {
      const paper = JSON.parse(cleanLine) as DBLPPaper;
      const year = paper.year;
      if (year >= 2010 && year <= 2024) {
        if (yearCounts[year] < targetPerYear * 2) { // get extra candidates to verify
          const venueRaw = paper.venue?.raw || '';
          const refs = paper.references || [];
          
          // Must be an arXiv paper and have a reasonable number of citations (references list)
          if (venueRaw.toLowerCase().includes('arxiv') && refs.length >= 8 && refs.length <= 100) {
            candidates.push(paper);
            yearCounts[year]++;
          }
        }
      }
    } catch {
      // skip corrupted json lines
    }

    // Stop scanning DBLP if we have plenty of candidates for all years or enough total candidates
    const gotEnough = Object.values(yearCounts).every(count => count >= targetPerYear * 1.5);
    if (gotEnough || candidates.length >= 400 || scannedLines > 2000000) {
      break;
    }
  }

  console.log(`\nGathered ${candidates.length} candidate papers from DBLP. Year distribution of candidates:`);
  console.log(yearCounts);

  // 2. Verify candidates against arXiv API (batch query with rate limiting)
  console.log('\nVerifying candidates on arXiv API to prevent title mismatches (Optimized Batch Mode)...');
  const verifiedPapers: VerifiedPaper[] = [];
  const targetCount = 200;
  const verifiedYearCounts: Record<number, number> = {};
  for (let y = 2010; y <= 2024; y++) verifiedYearCounts[y] = 0;

  // Shuffle candidates to avoid clustering in a single year
  candidates.sort(() => Math.random() - 0.5);

  const batchSize = 15;
  let candidateIndex = 0;

  while (verifiedPapers.length < targetCount && candidateIndex < candidates.length) {
    // Collect up to batchSize candidates that still need verification (considering year caps)
    const batch: DBLPPaper[] = [];
    while (batch.length < batchSize && candidateIndex < candidates.length) {
      const c = candidates[candidateIndex++];
      const year = c.year;
      if (verifiedYearCounts[year] < 16) {
        batch.push(c);
      }
    }

    if (batch.length === 0) {
      break;
    }

    console.log(`\nQuerying arXiv batch of ${batch.length} papers (Verified: ${verifiedPapers.length}/${targetCount})...`);

    // Clean titles and construct search query OR-joined
    const titleQueries = batch.map(c => {
      const cleanTitle = c.title.replace(/["'()\[\]:;]/g, ' ').replace(/\s+/g, ' ').trim();
      return `ti:"${cleanTitle}"`;
    }).join(' OR ');

    const queryUrl = `http://export.arxiv.org/api/query?search_query=${encodeURIComponent(titleQueries)}&max_results=${batch.length * 2}`;

    try {
      const res = await fetch(queryUrl);
      if (!res.ok) {
        console.warn(`  arXiv API batch error: ${res.statusText}. Waiting 3s...`);
        candidateIndex -= batch.length; // retry candidates in next batch
        await delay(3000);
        continue;
      }

      const xml = await res.text();
      const entries = extractTagContent(xml, 'entry');
      console.log(`  Found ${entries.length} matching entries from arXiv.`);

      for (const entry of entries) {
        const arxivTitle = (extractTagContent(entry, 'title')[0] || '').replace(/\n/g, ' ').trim();
        
        let bestCandidate: DBLPPaper | null = null;
        let bestSimilarity = -1;

        for (const candidate of batch) {
          const sim = getDiceSimilarity(candidate.title, arxivTitle);
          if (sim > bestSimilarity) {
            bestSimilarity = sim;
            bestCandidate = candidate;
          }
        }

        if (bestCandidate && bestSimilarity >= 0.85) {
          const year = bestCandidate.year;
          if (verifiedYearCounts[year] >= 16) {
            continue;
          }

          const pdfUrl = extractPdfLink(entry);
          if (!pdfUrl) continue;

          const arxivId = extractArxivIdFromUrl(pdfUrl);
          if (!arxivId) continue;

          if (verifiedPapers.some(p => p.arxivId === arxivId)) {
            continue;
          }

          const downloadable = await isPdfDownloadable(pdfUrl);
          if (!downloadable) {
            console.log(`  Paper "${bestCandidate.title}" found but PDF is not downloadable.`);
            continue;
          }

          verifiedPapers.push({
            ...bestCandidate,
            arxivId,
            pdfUrl
          });
          verifiedYearCounts[year]++;
          console.log(`  ✓ Verified: "${bestCandidate.title}" (${year}) | arXiv: ${arxivId} (Year counts: ${verifiedYearCounts[year]}/16)`);
          
          if (verifiedPapers.length >= targetCount) {
            break;
          }
        }
      }

    } catch (err) {
      console.error(`  Error in batch verification:`, err);
    }

    await delay(3000); // Respect arXiv API rate limit
  }

  console.log(`\nVerified ${verifiedPapers.length} papers successfully!`);
  console.log('Verified year distribution:', verifiedYearCounts);

  if (verifiedPapers.length < 50) {
    console.error('Too few papers verified. Aborting.');
    return;
  }

  // 3. Resolve references (Pass 2: Scanning DBLP forwards)
  const referenceIds = new Set<number>();
  for (const paper of verifiedPapers) {
    for (const refId of paper.references || []) {
      referenceIds.add(refId);
    }
  }

  console.log(`\nResolving ${referenceIds.size} unique reference IDs in DBLP forwards...`);
  const resolvedReferences: Record<number, DBLPPaper> = {};

  let scannedLinesForward = 0;
  const fd = fs.openSync(DATASET_PATH, 'r');
  const stat = fs.fstatSync(fd);
  const fileSize = stat.size;
  
  // Using a line-by-line streaming parser for memory efficiency
  const readline = require('readline');
  const fileStream = fs.createReadStream(DATASET_PATH);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity
  });

  for await (const line of rl) {
    scannedLinesForward++;
    if (scannedLinesForward % 1000000 === 0) {
      const progressPercent = ((fileStream.bytesRead / fileSize) * 100).toFixed(1);
      console.log(`Scanned ${scannedLinesForward} lines (${progressPercent}%) | Resolved ${Object.keys(resolvedReferences).length}/${referenceIds.size} references...`);
    }

    let cleanLine = line.trim();
    if (cleanLine.startsWith(',')) cleanLine = cleanLine.substring(1);
    if (cleanLine.startsWith('[') || cleanLine.startsWith(']')) continue;
    if (!cleanLine) continue;

    const match = cleanLine.match(/^\{"id":\s*(\d+)/);
    if (match) {
      const pid = parseInt(match[1]);
      if (referenceIds.has(pid)) {
        try {
          const refPaper = JSON.parse(cleanLine) as DBLPPaper;
          resolvedReferences[pid] = refPaper;
        } catch {}
      }
    }
  }

  console.log(`\nResolved DBLP metadata for ${Object.keys(resolvedReferences).length} of ${referenceIds.size} references.`);

  // 4. Enrich references with DOI and arXiv ID via Semantic Scholar Batch API
  console.log('\nEnriching resolved reference metadata using Semantic Scholar Batch API...');
  const referencesWithDoi = Object.values(resolvedReferences).filter(ref => ref.doi);
  console.log(`Found ${referencesWithDoi.length} references with DOIs to query.`);

  const s2BatchSize = 500;
  for (let i = 0; i < referencesWithDoi.length; i += s2BatchSize) {
    const chunk = referencesWithDoi.slice(i, i + s2BatchSize);
    console.log(`Querying Semantic Scholar batch ${Math.floor(i / s2BatchSize) + 1}/${Math.ceil(referencesWithDoi.length / s2BatchSize)} (${chunk.length} papers)...`);
    
    const ids = chunk.map(ref => `DOI:${ref.doi}`);
    const s2Url = 'https://api.semanticscholar.org/graph/v1/paper/batch?fields=title,authors,year,externalIds';
    
    try {
      const res = await fetch(s2Url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Mozilla/5.0'
        },
        body: JSON.stringify({ ids })
      });

      if (!res.ok) {
        console.warn(`  Semantic Scholar API batch error: ${res.statusText}`);
        await delay(1500);
        continue;
      }

      const results = await res.json() as any[];
      for (let j = 0; j < chunk.length; j++) {
        const ref = chunk[j];
        const s2Paper = results[j];
        if (s2Paper && s2Paper.externalIds) {
          const extIds = s2Paper.externalIds;
          const links: string[] = [];
          
          if (extIds.DOI) {
            links.push(`https://doi.org/${extIds.DOI.toLowerCase()}`);
          }
          if (extIds.ArXiv) {
            links.push(`https://arxiv.org/abs/${extIds.ArXiv}`);
          }

          if (links.length > 0) {
            // Update DOI / link in resolved references map
            const originalRef = resolvedReferences[ref.id];
            if (originalRef) {
              originalRef.doi = extIds.DOI ? extIds.DOI.toLowerCase() : originalRef.doi;
              // Save equivalent links joined by ' || '
              (originalRef as any).canonicalLinks = links.join(' || ');
              
              if (s2Paper.authors && s2Paper.authors.length > 0) {
                originalRef.authors = s2Paper.authors.map((a: any) => ({ name: a.name }));
              }
            }
          }
        }
      }
    } catch (err) {
      console.error(`  Error in Semantic Scholar batch query:`, err);
    }

    await delay(1500); // Rate limiting
  }

  // 5. Select final papers with highest resolved references rate
  console.log('\nSelecting final papers with highest resolved references rate...');
  const scoredPapers = verifiedPapers.map(paper => {
    const refs = paper.references || [];
    let resolvedCount = 0;
    for (const refId of refs) {
      if (resolvedReferences[refId]) {
        resolvedCount++;
      }
    }
    const resolvedRate = refs.length > 0 ? resolvedCount / refs.length : 1;
    return { paper, resolvedRate, resolvedCount };
  });

  // Sort by resolved rate descending
  scoredPapers.sort((a, b) => b.resolvedRate - a.resolvedRate);

  // Keep top 200
  const finalPapersScored = scoredPapers.slice(0, targetCount);
  console.log(`Selected top ${finalPapersScored.length} target papers. Lowest resolved rate in selected set: ${(finalPapersScored[finalPapersScored.length - 1].resolvedRate * 100).toFixed(1)}%`);

  // 6. Delete old dataset and download new verified dataset
  console.log('\nCleaning up old pdfs and annotations folders...');
  if (fs.existsSync(PDF_DIR)) {
    fs.readdirSync(PDF_DIR).forEach(f => fs.unlinkSync(path.join(PDF_DIR, f)));
  } else {
    fs.mkdirSync(PDF_DIR, { recursive: true });
  }

  if (fs.existsSync(ANNOTATIONS_DIR)) {
    fs.readdirSync(ANNOTATIONS_DIR).forEach(f => fs.unlinkSync(path.join(ANNOTATIONS_DIR, f)));
  } else {
    fs.mkdirSync(ANNOTATIONS_DIR, { recursive: true });
  }

  console.log('\nDownloading PDFs and writing annotations...');
  let downloadedCount = 0;

  for (let i = 0; i < finalPapersScored.length; i++) {
    const { paper } = finalPapersScored[i];
    const cleanT = cleanTitleForFilename(paper.title);
    const filenameBase = `${paper.year}_${cleanT}`;
    
    const pdfFilename = `${filenameBase}.pdf`;
    const jsonFilename = `${filenameBase}.json`;
    
    const pdfPath = path.join(PDF_DIR, pdfFilename);
    const jsonPath = path.join(ANNOTATIONS_DIR, jsonFilename);

    // Build bibliography entries annotation
    const bibEntries: Record<string, any> = {};
    const refs = paper.references || [];
    
    for (let rIdx = 0; rIdx < refs.length; rIdx++) {
      const refId = refs[rIdx];
      const refPaper = resolvedReferences[refId];
      
      if (refPaper) {
        const authors = (refPaper.authors || []).map(a => a.name);
        const venue = refPaper.venue?.raw || '';
        const link = (refPaper as any).canonicalLinks || (refPaper.doi ? `https://doi.org/${refPaper.doi.toLowerCase()}` : '');

        bibEntries[`BIBREF${rIdx}`] = {
          title: refPaper.title || '',
          authors,
          year: refPaper.year ? String(refPaper.year) : null,
          venue,
          link: link || null
        };
      } else {
        // Fallback for unresolved references
        bibEntries[`BIBREF${rIdx}`] = {
          title: `Unknown Reference ${refId}`,
          authors: [],
          year: null,
          venue: '',
          link: null
        };
      }
    }

    const annotation = {
      paper_id: paper.arxivId,
      title: paper.title,
      bib_entries: bibEntries
    };

    // Save annotation
    fs.writeFileSync(jsonPath, JSON.stringify(annotation, null, 2), 'utf8');

    // Download PDF
    console.log(`[${i + 1}/${finalPapersScored.length}] Downloading PDF for "${paper.title}" from ${paper.pdfUrl}...`);
    try {
      const pdfRes = await fetch(paper.pdfUrl);
      if (!pdfRes.ok) {
        throw new Error(`HTTP ${pdfRes.status}`);
      }
      const arrayBuffer = await pdfRes.arrayBuffer();
      fs.writeFileSync(pdfPath, Buffer.from(arrayBuffer));
      downloadedCount++;
      console.log(`  ✓ Saved ${pdfFilename}`);
    } catch (err) {
      console.error(`  ✕ Failed to download PDF for "${paper.title}":`, err);
      // Remove corresponding annotation if PDF download failed to keep dataset consistent
      if (fs.existsSync(jsonPath)) {
        fs.unlinkSync(jsonPath);
      }
    }

    await delay(1000); // Be polite to arXiv downloads
  }

  console.log('\n========================================================================');
  console.log(`DATASET REBUILD COMPLETE!`);
  console.log(`Successfully downloaded ${downloadedCount} PDFs and wrote corresponding annotations.`);
  console.log(`PDFs stored in:         ${PDF_DIR}`);
  console.log(`Annotations stored in:  ${ANNOTATIONS_DIR}`);
  console.log('========================================================================');
}

main().catch(console.error);
