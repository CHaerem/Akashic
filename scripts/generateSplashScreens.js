/**
 * Generate iOS splash screens for PWA
 * Run with: node scripts/generateSplashScreens.js
 *
 * Requires: npm install sharp
 */

import sharp from 'sharp';
import { mkdir } from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Splash screen sizes for various iOS devices
const splashScreens = [
    { width: 1290, height: 2796, name: 'apple-splash-1290-2796.png' }, // iPhone 15 Pro Max
    { width: 1179, height: 2556, name: 'apple-splash-1179-2556.png' }, // iPhone 15 Pro
    { width: 1284, height: 2778, name: 'apple-splash-1284-2778.png' }, // iPhone 14 Plus
    { width: 1170, height: 2532, name: 'apple-splash-1170-2532.png' }, // iPhone 14
    { width: 1125, height: 2436, name: 'apple-splash-1125-2436.png' }, // iPhone 13 mini
    { width: 1242, height: 2688, name: 'apple-splash-1242-2688.png' }, // iPhone 11 Pro Max
    { width: 828, height: 1792, name: 'apple-splash-828-1792.png' },   // iPhone 11
    { width: 1242, height: 2208, name: 'apple-splash-1242-2208.png' }, // iPhone 8 Plus
    { width: 750, height: 1334, name: 'apple-splash-750-1334.png' },   // iPhone SE
    { width: 2048, height: 2732, name: 'apple-splash-2048-2732.png' }, // iPad Pro 12.9"
    { width: 1668, height: 2388, name: 'apple-splash-1668-2388.png' }, // iPad Pro 11"
    { width: 1620, height: 2160, name: 'apple-splash-1620-2160.png' }, // iPad Air
];

// Colors matching the app theme
const backgroundColor = '#0a0a0f';
const textColor = 'rgba(255, 255, 255, 0.9)';

async function generateSplashScreen({ width, height, name }) {
    // Calculate text size based on screen width
    const fontSize = Math.round(width * 0.06);
    const subtitleSize = Math.round(width * 0.025);

    // Create SVG with centered text
    const svg = `
        <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
            <rect width="100%" height="100%" fill="${backgroundColor}"/>
            <text
                x="50%"
                y="45%"
                text-anchor="middle"
                font-family="system-ui, -apple-system, sans-serif"
                font-size="${fontSize}"
                font-weight="300"
                letter-spacing="0.3em"
                fill="${textColor}"
            >AKASHIC</text>
            <text
                x="50%"
                y="52%"
                text-anchor="middle"
                font-family="system-ui, -apple-system, sans-serif"
                font-size="${subtitleSize}"
                font-weight="400"
                letter-spacing="0.15em"
                fill="rgba(255, 255, 255, 0.4)"
            >TREK EXPLORER</text>
        </svg>
    `;

    const outputPath = join(__dirname, '..', 'public', 'splash', name);

    await sharp(Buffer.from(svg))
        .png()
        .toFile(outputPath);

    console.log(`Generated: ${name} (${width}x${height})`);
}

async function main() {
    // Create splash directory
    const splashDir = join(__dirname, '..', 'public', 'splash');
    await mkdir(splashDir, { recursive: true });

    console.log('Generating iOS splash screens...\n');

    // Generate all splash screens
    for (const screen of splashScreens) {
        await generateSplashScreen(screen);
    }

    console.log('\nDone! Splash screens saved to public/splash/');
}

main().catch(console.error);
