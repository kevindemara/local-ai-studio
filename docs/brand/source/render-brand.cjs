const fs = require('node:fs/promises');
const path = require('node:path');
const sharp = require(process.argv[2] || 'sharp');

const root = path.resolve(__dirname, '..');
const svg = path.join(root, 'svg');
const png = path.join(root, 'png');

async function render(name, width, outputName = name) {
  const output = path.join(png, `${outputName}.png`);
  await sharp(path.join(svg, `${name}.svg`), { density: 300 })
    .resize({ width })
    .png()
    .toFile(output);
  const metadata = await sharp(output).metadata();
  if (metadata.width !== width || !metadata.hasAlpha) {
    throw new Error(`Unexpected export format: ${output}`);
  }
  return `${outputName}.png (${metadata.width} x ${metadata.height})`;
}

async function main() {
  await fs.mkdir(png, { recursive: true });
  const specs = [
    ['local-ai-studio-logo-dark', 1600],
    ['local-ai-studio-logo-light', 1600],
    ['local-ai-studio-logo-mono', 1600],
    ['local-ai-studio-logo-white', 1600],
    ['local-ai-studio-mark', 1024],
    ['local-ai-studio-mark-light', 1024],
    ['local-ai-studio-mark-mono', 1024],
    ['local-ai-studio-mark-white', 1024],
    ['local-ai-studio-app-icon', 512],
    ['local-ai-studio-app-icon', 256, 'local-ai-studio-app-icon-256'],
    ['local-ai-studio-favicon', 32],
    ['local-ai-studio-favicon', 16, 'local-ai-studio-favicon-16'],
  ];
  const results = await Promise.all(specs.map(args => render(...args)));
  await sharp(path.join(svg, 'brand-preview.svg'), { density: 150 })
    .resize({ width: 1600 })
    .png()
    .toFile(path.join(root, 'brand-preview.png'));
  console.log(results.join('\n'));
  console.log('brand-preview.png (1600 x 1050)');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
