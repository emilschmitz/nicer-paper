import sharp from 'sharp';
import path from 'path';

const svgPath = path.resolve('scratch/source_assets/paper_reader_icon.svg');
const destDir = path.resolve('chrome-extension');

async function render() {
  const sizes = [16, 48, 128];
  for (const size of sizes) {
    const destPath = path.join(destDir, `icon${size}.png`);
    await sharp(svgPath)
      .resize(size, size)
      .png()
      .toFile(destPath);
    console.log(`✓ Rendered ${size}x${size} icon to ${destPath}`);
  }
  console.log('Icon rendering complete!');
}

render().catch((err) => {
  console.error('Failed to render icons:', err);
  process.exit(1);
});
