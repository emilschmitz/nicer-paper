import fs from 'fs';
import path from 'path';

// Load environment variables manually
const envPath = path.resolve('.env');
const envContent = fs.readFileSync(envPath, 'utf8');
const env: { [key: string]: string } = {};
envContent.split('\n').forEach(line => {
  const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
  if (match) {
    let value = match[2] ? match[2].trim() : '';
    if (value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1);
    }
    env[match[1]] = value;
  }
});

const API_KEY = env['OPENROUTER_API_KEY'];
if (!API_KEY) {
  console.error("No OPENROUTER_API_KEY found in .env");
  process.exit(1);
}

const PDF_FILE = 'pdfs/2015_Deep_Residual_Learning_for_Image_Recognition.pdf';
const PDF_PATH = path.resolve(PDF_FILE);

async function runTest() {
  console.log(`Reading PDF: ${PDF_PATH}...`);
  const fileBuffer = fs.readFileSync(PDF_PATH);
  const base64Data = fileBuffer.toString('base64');
  console.log(`Base64 encoded, length: ${base64Data.length} characters.`);

  const prompt = `Extract all bibliography references from this PDF. For each reference, extract and return a JSON array containing objects structured exactly like this:
{
  "source_paper": "2015_Deep_Residual_Learning_for_Image_Recognition.pdf",
  "raw": "the full raw citation text as printed",
  "type": "article | book | inproceedings | phdthesis | misc | techreport",
  "author": "BibTeX author format (e.g. 'Bengio, Yoshua and Simard, Patrice and Frasconi, Paolo')",
  "title": "Title of the work",
  "year": "Publication year",
  "journal": "Journal name or null",
  "booktitle": "Booktitle/Conference name or null",
  "volume": "Volume or null",
  "number": "Number or null",
  "pages": "Pages (e.g. '157--166') or null",
  "publisher": "Publisher or null",
  "doi": "DOI if any or null",
  "url": "URL if any or null",
  "eprint": "arXiv ID if any or null",
  "provenance": "minimax_m3_extraction"
}

Format the output strictly as a JSON array of objects. Respond with ONLY the valid JSON array.`;

  console.log("Calling OpenRouter with minimax/minimax-m3...");
  const startTime = Date.now();
  try {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "minimax/minimax-m3",
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: prompt
              },
              {
                type: "file",
                file: {
                  filename: "2015_Deep_Residual_Learning_for_Image_Recognition.pdf",
                  file_data: `data:application/pdf;base64,${base64Data}`
                }
              }
            ]
          }
        ],
        response_format: { type: "json_object" }
      })
    });

    const data: any = await response.json();
    const duration = Date.now() - startTime;
    console.log(`Request completed in ${(duration / 1000).toFixed(1)}s.`);
    
    if (data.error) {
      console.error("API Error:", data.error);
      return;
    }

    const usage = data.usage;
    console.log("Usage stats:", usage);
    
    const content = data.choices?.[0]?.message?.content;
    console.log("\nResponse Content:\n");
    console.log(content);

    // Save to temp file
    const outDir = path.resolve('tmp');
    if (!fs.existsSync(outDir)) {
      fs.mkdirSync(outDir, { recursive: true });
    }
    const outFile = path.join(outDir, `minimax_resnet_output_${Date.now()}.json`);
    fs.writeFileSync(outFile, JSON.stringify(data, null, 2));
    console.log(`\nSaved raw response to: ${outFile}`);

  } catch (err) {
    console.error("Request failed:", err);
  }
}

runTest();
