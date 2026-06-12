import fs from 'fs';
import path from 'path';

const LLM_OUTPUT_PATH = './tmp/minimax_resnet_output.json'; // We will copy our latest file here
const GT_PATH = './annotations/2015.json';

// Find the latest minimax_resnet_hybrid_*.json file
const tmpDir = './tmp';
const files = fs.readdirSync(tmpDir);
const hybridFiles = files.filter(f => f.startsWith('minimax_resnet_hybrid_') && f.endsWith('.json'));
if (hybridFiles.length === 0) {
  console.error("No minimax_resnet_hybrid output files found in tmp/");
  process.exit(1);
}
hybridFiles.sort();
const latestFile = path.join(tmpDir, hybridFiles[hybridFiles.length - 1]);
console.log(`Evaluating latest LLM output file: ${latestFile}`);

// Helper: Sørensen-Dice coefficient for text similarity (character bigrams)
function getBigrams(str: string): Set<string> {
  const s = str.toLowerCase().replace(/\s+/g, '');
  const bigrams = new Set<string>();
  for (let i = 0; i < s.length - 1; i++) {
    bigrams.add(s.substring(i, i + 2));
  }
  return bigrams;
}

function getDiceSimilarity(s1: string, s2: string): number {
  const b1 = getBigrams(s1 || '');
  const b2 = getBigrams(s2 || '');
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

function main() {
  const gt = JSON.parse(fs.readFileSync(GT_PATH, 'utf8'));
  const rawLlmResponse = JSON.parse(fs.readFileSync(latestFile, 'utf8'));
  const llmContentRaw = rawLlmResponse.choices?.[0]?.message?.content || "";
  
  // Extract JSON array from LLM response (handling potential markdown formatting)
  let jsonStr = llmContentRaw;
  const jsonStart = jsonStr.indexOf('[');
  const jsonEnd = jsonStr.lastIndexOf(']');
  if (jsonStart !== -1 && jsonEnd !== -1) {
    jsonStr = jsonStr.substring(jsonStart, jsonEnd + 1);
  }
  
  const llmEntries = JSON.parse(jsonStr);
  console.log(`Loaded Ground Truth: ${gt.length} entries`);
  console.log(`Loaded LLM Output: ${llmEntries.length} entries`);

  let matchedCount = 0;
  let totalAuthorSim = 0;
  let totalTitleSim = 0;
  let totalVenueSim = 0;
  let correctYears = 0;
  let correctTypes = 0;
  let correctEprints = 0;
  let correctUrls = 0;

  for (const gtEntry of gt) {
    // Find matching LLM entry by Dice similarity on raw text
    let bestMatch: any = null;
    let bestScore = 0;

    for (const llmEntry of llmEntries) {
      const score = getDiceSimilarity(gtEntry.raw, llmEntry.raw);
      if (score > bestScore) {
        bestScore = score;
        bestMatch = llmEntry;
      }
    }

    if (bestScore >= 0.7 && bestMatch) {
      matchedCount++;
      
      const authorSim = getDiceSimilarity(gtEntry.author, bestMatch.author);
      const titleSim = getDiceSimilarity(gtEntry.title, bestMatch.title);
      
      const gtVenue = gtEntry.journal || gtEntry.booktitle || "";
      const llmVenue = bestMatch.journal || bestMatch.booktitle || "";
      const venueSim = getDiceSimilarity(gtVenue, llmVenue);

      const yearCorrect = (gtEntry.year || "").trim() === (bestMatch.year || "").trim() ? 1 : 0;
      const typeCorrect = (gtEntry.type || "").trim().toLowerCase() === (bestMatch.type || "").trim().toLowerCase() ? 1 : 0;
      
      const gtEprint = gtEntry.eprint || null;
      const llmEprint = bestMatch.eprint || null;
      const eprintCorrect = gtEprint === llmEprint ? 1 : 0;

      const gtUrl = gtEntry.url || null;
      const llmUrl = bestMatch.url || null;
      const urlCorrect = gtUrl === llmUrl ? 1 : 0;

      totalAuthorSim += authorSim;
      totalTitleSim += titleSim;
      totalVenueSim += venueSim;
      correctYears += yearCorrect;
      correctTypes += typeCorrect;
      correctEprints += eprintCorrect;
      correctUrls += urlCorrect;

      // Print any mismatch for inspection
      if (authorSim < 0.8 || titleSim < 0.8 || yearCorrect === 0) {
        console.log(`\nMismatch in Entry: ${gtEntry.raw.substring(0, 50)}...`);
        if (authorSim < 0.8) console.log(`  Author: "${gtEntry.author}" vs "${bestMatch.author}" (Sim: ${authorSim.toFixed(2)})`);
        if (titleSim < 0.8) console.log(`  Title: "${gtEntry.title}" vs "${bestMatch.title}" (Sim: ${titleSim.toFixed(2)})`);
        if (yearCorrect === 0) console.log(`  Year: "${gtEntry.year}" vs "${bestMatch.year}"`);
      }
    } else {
      console.log(`\nUNMATCHED Ground Truth: "${gtEntry.raw}"`);
    }
  }

  console.log("\n=========================================");
  console.log("LLM CITATION EXTRACTION METRICS");
  console.log("=========================================");
  console.log(`Successfully Matched:       ${matchedCount} / ${gt.length} (${((matchedCount / gt.length) * 100).toFixed(1)}%)`);
  console.log(`Average Author Similarity:  ${((totalAuthorSim / matchedCount) * 100).toFixed(1)}%`);
  console.log(`Average Title Similarity:   ${((totalTitleSim / matchedCount) * 100).toFixed(1)}%`);
  console.log(`Average Venue Similarity:   ${((totalVenueSim / matchedCount) * 100).toFixed(1)}%`);
  console.log(`Year Accuracy:              ${((correctYears / matchedCount) * 100).toFixed(1)}%`);
  console.log(`Type Accuracy:              ${((correctTypes / matchedCount) * 100).toFixed(1)}%`);
  console.log(`Eprint Match Accuracy:      ${((correctEprints / matchedCount) * 100).toFixed(1)}%`);
  console.log(`Url Match Accuracy:         ${((correctUrls / matchedCount) * 100).toFixed(1)}%`);
  console.log("=========================================");
}

main();
