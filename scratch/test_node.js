const { pipeline } = require('@huggingface/transformers');

async function main() {
  console.log('Loading text generation pipeline (Qwen2.5-0.5B-Instruct) using Node.js...');
  try {
    const pipe = await pipeline('text-generation', 'onnx-community/Qwen2.5-0.5B-Instruct');
    console.log('Qwen pipeline loaded successfully!');
    
    const text = "[1] Y. Bengio, P. Simard, and P. Frasconi. Learning long-term dependencies with gradient descent is difficult. IEEE Transactions on Neural Networks, 5(2):157-166, 1994.";
    const messages = [
      { role: 'user', content: `Parse the following academic citation into JSON with keys "author", "title", "year", "venue".\nCitation: "${text}"` }
    ];
    
    console.log('Generating response...');
    const results = await pipe(messages, { max_new_tokens: 150 });
    console.log('Response:', JSON.stringify(results, null, 2));
  } catch (err) {
    console.error('Failed to load/run Qwen:', err.message || err);
  }
}

main().catch(console.error);
