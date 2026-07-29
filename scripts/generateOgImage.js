/**
 * Builds public/og-image.png — the 1200x630 preview card that iMessage, WhatsApp, Slack and
 * Twitter/X render when someone shares an akashic.no link.
 *
 *   npm run generate-og-image
 *
 * Exists so the card stays a reproducible source-controlled artefact rather than a mystery
 * binary, the same reason the app icon has generate.mjs beside it.
 *
 * 1200x630 is the size every scraper agrees on: it is Facebook/Open Graph's recommended
 * large-card size, satisfies Twitter's `summary_large_image` (which wants >=300x157 and 2:1-ish),
 * and is what iMessage and Slack crop from.
 *
 * JPEG rather than PNG: the card is a photograph, and the PNG encoding of this same crop came out
 * at 918 KB — under Twitter's 1 MB ceiling, but only just, and it is a needless 900 KB on a page
 * whose whole job is to load fast on a phone. Quality 82 lands about 15x smaller with no visible
 * difference at card size.
 *
 * NOTE ON FONTS: the overlay uses SVG <text>, which sharp renders through librsvg using fonts
 * installed on *this* machine. The output PNG is committed, so nothing in CI or the Vite build
 * re-renders it — font availability only matters when a person regenerates the card. If the
 * wordmark ever looks wrong after a regeneration, that is why; check the rendered PNG by eye
 * before committing it.
 */

import sharp from 'sharp';
import { statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const publicDir = join(__dirname, '..', 'public');

const WIDTH = 1200;
const HEIGHT = 630;
const GROUND = '#0B0B19';
const ACCENT = '#A9B4FF';

// The source hero is a 1024x1024 square; `cover` crops it to the card's 1.905 aspect ratio.
// Centre, not top: cropping to the top gave 400px of empty sky with the peaks squeezed against
// the bottom edge, right where the wordmark sits. Centre puts the skyline through the middle.
//
// QUA-74: the source lives under scripts/og/, NOT public/ — it is a build-time INPUT, and
// public/ is the publish dir: parked there it rode the service worker's precache glob, and a
// first-time visitor on mobile data paid ~900 KB (plus ~3.5 MB of three sibling heroes no code
// referenced at all, deleted the same day) for zero rendered pixels.
const source = join(__dirname, 'og', 'landing-hero.png');

/**
 * Scrim + mark + wordmark. The scrim is the load-bearing part: the photo's sky is bright, and
 * white text over an unmodified photo is unreadable on whichever crop a given client picks.
 */
const overlay = Buffer.from(`
<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}">
  <defs>
    <linearGradient id="scrim" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0"    stop-color="${GROUND}" stop-opacity="0.05"/>
      <stop offset="0.55" stop-color="${GROUND}" stop-opacity="0.22"/>
      <stop offset="1"    stop-color="${GROUND}" stop-opacity="0.92"/>
    </linearGradient>
    <linearGradient id="sphere" x1="0.18" y1="0.06" x2="0.82" y2="0.94">
      <stop offset="0" stop-color="#A9B4FF"/>
      <stop offset="1" stop-color="#7F8FFA"/>
    </linearGradient>
    <clipPath id="sphereClip"><circle cx="94" cy="516" r="34"/></clipPath>
  </defs>

  <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#scrim)"/>

  <!-- The same three-ellipse globe as favicon.svg and the app icon, at r=34. -->
  <circle cx="94" cy="516" r="34" fill="url(#sphere)"/>
  <g clip-path="url(#sphereClip)" fill="none" stroke="${GROUND}" stroke-width="3.3">
    <ellipse cx="94" cy="516" rx="34" ry="11.3"/>
    <ellipse cx="94" cy="516" rx="11.3" ry="34"/>
  </g>

  <text x="146" y="505" font-family="Georgia, 'Playfair Display', serif" font-size="58"
        font-weight="700" fill="#FFFFFF">Akashic</text>
  <!-- The App Store subtitle verbatim (docs/store/app-store-listing.md §2), so the share card,
       the listing and index.html's og:title all say the same thing. Note the open owner decision
       recorded there about whether this line should stay trek-specific; if it changes, this and
       index.html's og:/twitter: titles change with it. -->
  <text x="149" y="545" font-family="Helvetica, Roboto, Arial, sans-serif" font-size="21"
        letter-spacing="2.6" fill="${ACCENT}">YOUR TREKS ON A LIVING GLOBE</text>
</svg>
`);

const out = join(publicDir, 'og-image.jpg');

await sharp(source)
    .resize(WIDTH, HEIGHT, { fit: 'cover', position: 'center' })
    .composite([{ input: overlay, top: 0, left: 0 }])
    // Scrapers do not want alpha; JPEG has none anyway, but flatten makes that explicit.
    .flatten({ background: GROUND })
    .jpeg({ quality: 82, mozjpeg: true })
    .toFile(out);

const meta = await sharp(out).metadata();
const stats = await sharp(out).stats();
// sharp's metadata().size is only populated for Buffer inputs, not for a path — stat the file.
const bytes = statSync(out).size;
const kb = (bytes / 1024).toFixed(0);
const ok = meta.width === WIDTH && meta.height === HEIGHT && !meta.hasAlpha
    && stats.isOpaque && bytes < 1024 * 1024;

console.log(
    `  ${ok ? 'ok ' : 'FAIL'} og-image.jpg  ${meta.width}x${meta.height}` +
    `  channels=${meta.channels} hasAlpha=${meta.hasAlpha} isOpaque=${stats.isOpaque}  ${kb} KB`
);
if (!ok) {
    console.error('  expected an opaque 1200x630 JPEG under 1 MB (Twitter rejects larger)');
    process.exitCode = 1;
}
