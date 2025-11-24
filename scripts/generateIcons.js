import sharp from 'sharp';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const publicDir = join(__dirname, '..', 'public');

const svgBuffer = readFileSync(join(publicDir, 'favicon.svg'));

const sizes = [
    { name: 'favicon-16x16.png', size: 16 },
    { name: 'favicon-32x32.png', size: 32 },
    { name: 'apple-touch-icon.png', size: 180 },
    { name: 'pwa-192x192.png', size: 192 },
    { name: 'pwa-512x512.png', size: 512 },
];

async function generateIcons() {
    console.log('Generating icons...');

    for (const { name, size } of sizes) {
        await sharp(svgBuffer)
            .resize(size, size)
            .png()
            .toFile(join(publicDir, name));
        console.log(`  ✓ ${name}`);
    }

    // Also create favicon.ico (just copy 32x32 as png - browsers handle it)
    await sharp(svgBuffer)
        .resize(32, 32)
        .png()
        .toFile(join(publicDir, 'favicon.ico'));
    console.log('  ✓ favicon.ico');

    console.log('Done!');
}

generateIcons().catch(console.error);
