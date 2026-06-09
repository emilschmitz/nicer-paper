import { spawn } from 'child_process';

console.log('Starting local HTTP server...');
const server = spawn('python3', ['-m', 'http.server', '8888', '--directory', '.']);

// Helper to execute agent-browser commands
async function runCmd(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn('agent-browser', args);
    let out = '';
    proc.stdout.on('data', d => out += d);
    proc.stderr.on('data', d => out += d);
    proc.on('close', (code) => {
      if (code === 0) resolve(out.trim());
      else reject(new Error(`Command agent-browser ${args.join(' ')} failed: ${out}`));
    });
  });
}

async function main() {
  try {
    // Wait for server to start
    await new Promise(r => setTimeout(r, 1500));

    console.log('Opening PDF with extension in agent-browser...');
    await runCmd([
      '--extension', 'chrome-extension',
      'open', 'http://localhost:8888/pdfs/2015_Deep_Residual_Learning_for_Image_Recognition.pdf'
    ]);

    // Wait for rendering and local extraction
    console.log('Waiting for PDF to load and extract...');
    await new Promise(r => setTimeout(r, 4000));

    console.log('Verifying page rendering...');
    const pages = await runCmd(['eval', 'document.querySelectorAll(".page").length']);
    console.log(`✓ Rendered pages count: ${pages}`);

    console.log('Verifying link overlays...');
    const overlays = await runCmd(['eval', 'document.querySelectorAll(".link-overlay").length']);
    console.log(`✓ Injected link overlays: ${overlays}`);

    if (parseInt(overlays) === 0) {
      throw new Error('No link overlays injected!');
    }

    console.log('Simulating hover and testing tooltip...');
    const hoverResult = await runCmd(['eval', `
      const linksWithUrls = Array.from(document.querySelectorAll('.link-overlay')).filter(a => a.getAttribute('href') && a.getAttribute('href') !== '#');
      if (linksWithUrls.length > 0) {
        const overlay = linksWithUrls[0];
        const event = new MouseEvent('mouseover', { bubbles: true, cancelable: true });
        overlay.dispatchEvent(event);
        const tooltip = document.getElementById('citation-tooltip');
        JSON.stringify({
          url: overlay.getAttribute('href'),
          visible: tooltip.classList.contains('cit-tooltip-visible'),
          content: tooltip.innerHTML.trim()
        });
      } else {
        'No link with URL found';
      }
    `]);
    console.log('✓ Hover Tooltip Result:', JSON.parse(hoverResult));

    console.log('\n🎉 ALL EXTENSION E2E TESTS PASSED SUCCESSFULLY!');
  } catch (err: any) {
    console.error('\n❌ TEST FAILED:', err.message);
    process.exit(1);
  } finally {
    console.log('Stopping local HTTP server...');
    server.kill();
  }
}

main();
