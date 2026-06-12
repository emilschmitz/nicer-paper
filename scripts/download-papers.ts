import fs from 'fs';
import path from 'path';

const PDF_DIR = path.resolve('pdfs');

// 10 diverse categories across Computer Science, Mathematics, Physics, Biology, and Statistics
const CATEGORIES = [
  'cs.OS',    // Operating Systems
  'cs.PL',    // Programming Languages
  'math.NT',  // Number Theory
  'astro-ph', // Astrophysics
  'q-bio.NC', // Neurons and Cognition
  'cs.DB',    // Databases
  'cs.SE',    // Software Engineering
  'math.CO',  // Combinatorics
  'hep-th',   // High Energy Physics - Theory
  'stat.AP'   // Applied Statistics
];

// Helper: Clean title for filename
function cleanTitleForFilename(title: string): string {
  return title
    .replace(/\s+/g, '_')
    .replace(/[^a-zA-Z0-9_]/g, '')
    .substring(0, 60); // Limit length
}

// Helper: XML text extractor (simple regex since we don't want heavy dependencies)
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
  // Find href in <link title="pdf" ...> or similar
  const match = entryXml.match(/<link[^>]*title="pdf"[^>]*href="([^"]+)"/i) ||
                entryXml.match(/<link[^>]*href="([^"]+)"[^>]*title="pdf"/i);
  if (match) {
    return match[1];
  }
  // Fallback: look for any link pointing to pdf
  const fallbackMatch = entryXml.match(/<link[^>]*href="([^"]+)"[^>]*type="application\/pdf"/i);
  if (fallbackMatch) {
    return fallbackMatch[1];
  }
  // Fallback 2: look for id tag which contains the abstract page and convert it to pdf url
  const idMatch = entryXml.match(/<id>([^<]+)<\/id>/i);
  if (idMatch) {
    const idUrl = idMatch[1].trim();
    if (idUrl.includes('/abs/')) {
      return idUrl.replace('/abs/', '/pdf/');
    }
  }
  return null;
}

async function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function downloadFile(url: string, destPath: string): Promise<boolean> {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      console.error(`Failed to download ${url}: ${response.statusText}`);
      return false;
    }
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    fs.writeFileSync(destPath, buffer);
    return true;
  } catch (err) {
    console.error(`Error downloading ${url}:`, err);
    return false;
  }
}

async function main() {
  if (!fs.existsSync(PDF_DIR)) {
    fs.mkdirSync(PDF_DIR, { recursive: true });
  }

  const startYear = 2015;
  const endYear = 2024;

  console.log(`Starting bulk download of diverse papers from ${startYear} to ${endYear}...`);

  for (let year = startYear; year <= endYear; year++) {
    console.log(`\n=== Year ${year} ===`);

    for (let i = 0; i < CATEGORIES.length; i++) {
      const cat = CATEGORIES[i];
      console.log(`Querying arXiv for category "${cat}" in ${year}...`);

      const queryUrl = `http://export.arxiv.org/api/query?search_query=cat:${cat}+AND+submittedDate:[${year}01010000+TO+${year}12312359]&max_results=1`;

      try {
        const response = await fetch(queryUrl);
        if (!response.ok) {
          console.error(`ArXiv API error: ${response.statusText}`);
          await delay(3000);
          continue;
        }

        const xml = await response.text();
        const entries = extractTagContent(xml, 'entry');

        if (entries.length === 0) {
          console.warn(`No entries found for ${cat} in ${year}.`);
          await delay(3000);
          continue;
        }

        const entry = entries[0];
        const rawTitle = extractTagContent(entry, 'title')[0] || `paper_${cat}_${year}`;
        const cleanTitle = cleanTitleForFilename(rawTitle.replace(/\n/g, ' '));
        const pdfUrl = extractPdfLink(entry);

        if (!pdfUrl) {
          console.warn(`Could not find PDF link for ${rawTitle}`);
          await delay(3000);
          continue;
        }

        const filename = `${year}_${cleanTitle}.pdf`;
        const destPath = path.join(PDF_DIR, filename);

        // Check if already downloaded
        if (fs.existsSync(destPath)) {
          console.log(`✓ Already exists: ${filename}`);
          await delay(1000); // Small delay
          continue;
        }

        console.log(`Downloading: ${filename} from ${pdfUrl}...`);
        const success = await downloadFile(pdfUrl, destPath);
        if (success) {
          console.log(`✓ Saved ${filename}`);
        }

      } catch (err) {
        console.error(`Error processing ${cat} in ${year}:`, err);
      }

      // ArXiv API guidelines request at least a 3-second delay between requests
      await delay(3000);
    }
  }

  console.log('\nBulk paper download complete!');
}

main().catch(console.error);
