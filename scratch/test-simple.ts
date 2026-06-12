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

async function runSimpleTest() {
  console.log("Calling OpenRouter with simple text prompt using minimax/minimax-m3...");
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
            content: "Hello, are you minimax-m3? Please say yes or no."
          }
        ]
      })
    });

    const data: any = await response.json();
    console.log("API Response:", JSON.stringify(data, null, 2));
  } catch (err) {
    console.error("Simple test failed:", err);
  }
}

runSimpleTest();
