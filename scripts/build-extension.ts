import fs from 'fs';
import path from 'path';

console.log('Building Chrome Extension assets...');

// Ensure output directory exists
const extensionDir = path.resolve('chrome-extension');
if (!fs.existsSync(extensionDir)) {
  fs.mkdirSync(extensionDir, { recursive: true });
}

// 1. Copy the legacy PDF.js worker
const workerSrc = path.resolve('node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs');
const workerDest = path.join(extensionDir, 'pdf.worker.js');

if (fs.existsSync(workerSrc)) {
  fs.copyFileSync(workerSrc, workerDest);
  console.log(`✓ Copied pdf.worker.js to ${workerDest}`);
} else {
  console.error(`✗ Error: PDF.js worker file not found at ${workerSrc}`);
  process.exit(1);
}

// 2. Bundle the extractor code using Bun's native bundler
const result = await Bun.build({
  entrypoints: [path.resolve('src/extractor/index.ts')],
  outdir: extensionDir,
  naming: '[name].js', // outputs extractor.js based on entrypoint directory or file name
  target: 'browser',
  minify: false, // Keep readable for inspection, can set to true for production minification
});

if (result.success) {
  // Rename index.js to extractor.js to match imports
  const oldPath = path.join(extensionDir, 'index.js');
  const newPath = path.join(extensionDir, 'extractor.js');
  if (fs.existsSync(oldPath)) {
    if (fs.existsSync(newPath)) {
      fs.unlinkSync(newPath);
    }
    fs.renameSync(oldPath, newPath);
  }

  // Post-process to remove absolute paths and avoid local path leaks (e.g. /home/emil/...)
  if (fs.existsSync(newPath)) {
    let content = fs.readFileSync(newPath, 'utf8');
    const absolutePathPattern = new RegExp(path.resolve('.'), 'g');
    content = content.replace(absolutePathPattern, '.');
    // Also strip generic home directories if present
    content = content.replace(/\/home\/[a-zA-Z0-9_-]+\/projects\/nicer-paper/g, '.');
    content = content.replace(/\/home\/[a-zA-Z0-9_-]+\/projects\/cit-tooltips/g, '.');
    fs.writeFileSync(newPath, content, 'utf8');
    console.log(`✓ Cleaned absolute path leaks from ${newPath}`);
  }

  console.log(`✓ Successfully bundled extractor.js to ${newPath}`);
} else {
  console.error('✗ Bundling failed:', result.logs);
  process.exit(1);
}

console.log('Chrome Extension assets successfully built!');
