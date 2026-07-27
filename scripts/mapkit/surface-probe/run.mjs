#!/usr/bin/env node
/**
 * Drive `surface-probe/index.html` in a real Chromium and print what it measured. (MAP-03)
 *
 * ## Why a driver rather than just opening the page
 *
 * Two reasons, both learned the hard way:
 *
 * 1. **`requestAnimationFrame` never fires in a hidden document**, and a hidden document is what an agent
 *    browser pane usually is. The P-M1 probe — "does `map.center` track an animation or jump to the
 *    destination" — then hangs forever with no error, which reads exactly like MapKit being slow. Playwright
 *    gives a foreground page with a real frame loop. (Same family as the trap
 *    `imagery-compare/index.html` records: Mapbox GL stops painting entirely in a hidden document.)
 * 2. **Nothing can read back what MapKit painted** — neither `getImageData` on `canvas.rt-root` nor
 *    `gl.readPixels` on `canvas.syrup-canvas` sees overlays. So the visual probes have to be settled by a
 *    screenshot, and a screenshot needs a driver.
 *
 * Usage:
 *   MAPKIT_KEY_ID=9UN97VBZR8 MAPKIT_TEAM_ID=9LVCB72DT8 node scripts/mapkit/imagery-compare/tokens.mjs
 *   node scripts/mapkit/surface-probe/run.mjs                 # all probes
 *   node scripts/mapkit/surface-probe/run.mjs m1 m2           # named probes
 *   node scripts/mapkit/surface-probe/run.mjs --shots /tmp/p   # also write <probe>.png
 *
 * Serves the parent directory itself so `../imagery-compare/tokens.js` resolves and no preview server is
 * required. Origin is `http://localhost:<port>`, which the minted token's `localhost` origin claim covers
 * (the port is not part of the claim — measured, see mintToken.mjs).
 */

import { createServer } from 'node:http';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');            // scripts/mapkit — so /imagery-compare/tokens.js resolves

const ALL = ['ready', 'attrib', 'm1', 'm2', 'm3', 'camera', 'halo', 'interrupt', 'anchor'];
const argv = process.argv.slice(2);
const shotsAt = argv.includes('--shots') ? argv[argv.indexOf('--shots') + 1] : null;
const probes = argv.filter(a => ALL.includes(a));
const wanted = probes.length ? probes : ALL;

if (!existsSync(join(ROOT, 'imagery-compare', 'tokens.js'))) {
    console.error('no imagery-compare/tokens.js — run tokens.mjs first (see this file\'s header)');
    process.exit(2);
}

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css' };
const server = createServer((req, res) => {
    const rel = normalize(decodeURIComponent(req.url.split('?')[0])).replace(/^(\.\.[/\\])+/, '');
    let path = join(ROOT, rel);
    if (!path.startsWith(ROOT)) return res.writeHead(403).end();
    if (existsSync(path) && !extname(path)) path = join(path, 'index.html');
    if (!existsSync(path)) return res.writeHead(404).end('not found');
    res.writeHead(200, { 'content-type': MIME[extname(path)] ?? 'application/octet-stream' });
    res.end(readFileSync(path));
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

if (shotsAt) mkdirSync(shotsAt, { recursive: true });

const browser = await chromium.launch();
const results = {};
for (const probe of wanted) {
    const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
    const consoleErrors = [];
    page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
    page.on('pageerror', e => consoleErrors.push(`pageerror: ${e.message}`));
    await page.goto(`http://localhost:${port}/surface-probe/?probe=${probe}`);
    try {
        await page.waitForFunction('window.PROBE && window.PROBE.done', null, { timeout: 60_000 });
    } catch {
        console.error(`  ! ${probe}: never finished within 60 s`);
    }
    // A probe that says SCREENSHOT NOW wants a settled camera; give the tiles a moment either way.
    await page.waitForTimeout(2500);
    results[probe] = await page.evaluate('window.PROBE.result');
    if (consoleErrors.length) results[probe]._consoleErrors = consoleErrors;
    if (shotsAt) await page.screenshot({ path: join(shotsAt, `${probe}.png`) });
    // P-ATTRIB is a before/after pair — take the "after" shot too.
    if (probe === 'attrib' && shotsAt) {
        await page.evaluate('window.setPad(80)');
        await page.waitForTimeout(1500);
        await page.screenshot({ path: join(shotsAt, 'attrib-padded.png') });
    }
    await page.close();
    console.error(`  ${probe} ok`);
}
await browser.close();
server.close();

process.stdout.write(JSON.stringify(results, null, 2) + '\n');
