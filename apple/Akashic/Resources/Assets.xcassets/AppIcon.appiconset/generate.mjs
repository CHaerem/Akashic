// Rasterises the three AppIcon SVGs in this directory to the 1024x1024 PNGs that Xcode ships,
// so the icon stays a reproducible source file rather than a mystery binary.
//
//   node apple/Akashic/Resources/Assets.xcassets/AppIcon.appiconset/generate.mjs
//
// Uses `sharp`, already a devDependency of the web side (see scripts/generateIcons.js, which
// does the same job for public/favicon.svg). Every output is flattened onto its own ground
// colour and stripped of alpha: App Store Connect rejects a 1024 marketing icon with an alpha
// channel, and the dark/tinted variants are kept opaque too so the #0B0B19 ground stays part of
// the identity instead of being replaced by the system's neutral backdrop.

import sharp from 'sharp';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

const variants = [
	{ svg: 'AppIcon.svg', png: 'AppIcon-1024.png', ground: '#0B0B19' },
	{ svg: 'AppIcon-dark.svg', png: 'AppIcon-1024-dark.png', ground: '#08080F' },
	{ svg: 'AppIcon-tinted.svg', png: 'AppIcon-1024-tinted.png', ground: '#000000' },
];

for (const { svg, png, ground } of variants) {
	// The SVGs declare width/height 1024, so sharp's SVG renderer rasterises at full size
	// directly — no upscaling from a smaller intrinsic size, which is what would soften the
	// curves. `density: 72` keeps that 1:1 mapping explicit rather than implied.
	await sharp(readFileSync(join(here, svg)), { density: 72 })
		.flatten({ background: ground })
		.removeAlpha()
		.png({ compressionLevel: 9 })
		.toFile(join(here, png));
	console.log(`  ok  ${png}`);
}
