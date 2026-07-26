/**
 * Rasterises public/favicon.svg into every PNG the web app and PWA manifest reference.
 *
 *   npm run generate-icons
 *
 * Mirrors apple/Akashic/Resources/Assets.xcassets/AppIcon.appiconset/generate.mjs so the web and
 * the app icon stay in step — same mark, same ground, same flatten-and-strip-alpha treatment.
 *
 * Why flatten + removeAlpha (QUA-21): the previous version of this script did neither, and
 * favicon.svg had no background element, so every output measured channels=4, hasAlpha=true,
 * isOpaque=false. An Add-to-Home-Screen tile with alpha gets composited onto whatever ground the
 * OS picks, which turned a near-black wireframe into a smudge. Baking the #0B0B19 ground in
 * makes the ground part of the identity instead of the platform's choice.
 *
 * Every output is verified before the script exits: opaque, right size, and mark-vs-ground
 * contrast at or above the 4.5:1 the icon tasks require. A regression fails the command rather
 * than quietly shipping a broken tile.
 */

import sharp from 'sharp';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const publicDir = join(__dirname, '..', 'public');

const svgBuffer = readFileSync(join(publicDir, 'favicon.svg'));

/** The ground baked into favicon.svg's <rect>. Outputs are flattened onto the same colour. */
const GROUND = '#0B0B19';
/** The two gradient stops of the sphere. The darker one is the worst case for contrast. */
const MARK_STOPS = ['#A9B4FF', '#7F8FFA'];
/** Icon tasks QUA-19/QUA-21 both require the mark to clear this against its own ground. */
const MIN_CONTRAST = 4.5;

const sizes = [
    { name: 'favicon-16x16.png', size: 16 },
    { name: 'favicon-32x32.png', size: 32 },
    { name: 'apple-touch-icon.png', size: 180 },
    { name: 'pwa-192x192.png', size: 192 },
    { name: 'pwa-512x512.png', size: 512 },
    // Browsers accept a PNG payload under a .ico name; this is a 32x32 PNG, not a real ICO.
    { name: 'favicon.ico', size: 32 },
];

/** WCAG relative luminance of a #rrggbb string. */
function luminance(hex) {
    const [r, g, b] = [1, 3, 5].map((i) => {
        const c = parseInt(hex.slice(i, i + 2), 16) / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two #rrggbb strings. */
function contrast(a, b) {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
}

async function generateIcons() {
    console.log(`Generating icons from favicon.svg (ground ${GROUND})\n`);

    const failures = [];

    for (const { name, size } of sizes) {
        const out = join(publicDir, name);
        await sharp(svgBuffer, { density: 72 })
            .resize(size, size)
            // Bake the ground in and drop the alpha channel, so the OS never gets to choose
            // what sits behind the mark.
            .flatten({ background: GROUND })
            .removeAlpha()
            .png({ compressionLevel: 9 })
            .toFile(out);

        const meta = await sharp(out).metadata();
        const stats = await sharp(out).stats();
        const ok = meta.channels === 3 && !meta.hasAlpha && stats.isOpaque
            && meta.width === size && meta.height === size;
        console.log(
            `  ${ok ? 'ok ' : 'FAIL'} ${name.padEnd(22)} ${`${meta.width}x${meta.height}`.padEnd(9)}` +
            ` channels=${meta.channels} hasAlpha=${meta.hasAlpha} isOpaque=${stats.isOpaque}`
        );
        if (!ok) failures.push(`${name}: expected an opaque 3-channel ${size}x${size} PNG`);
    }

    console.log(`\nMeasured contrast against the ${GROUND} ground:`);
    for (const stop of MARK_STOPS) {
        const ratio = contrast(stop, GROUND);
        const ok = ratio >= MIN_CONTRAST;
        console.log(`  ${ok ? 'ok ' : 'FAIL'} ${stop} vs ${GROUND}  ${ratio.toFixed(2)}:1`);
        if (!ok) failures.push(`${stop} vs ${GROUND} is ${ratio.toFixed(2)}:1, below ${MIN_CONTRAST}:1`);
    }

    if (failures.length) {
        console.error(`\n${failures.length} problem(s):`);
        failures.forEach((f) => console.error(`  - ${f}`));
        process.exitCode = 1;
        return;
    }
    console.log('\nDone — every asset is opaque and clears 4.5:1.');
}

generateIcons().catch((err) => {
    console.error(err);
    process.exitCode = 1;
});
