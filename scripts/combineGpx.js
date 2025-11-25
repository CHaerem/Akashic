/**
 * Combine multiple GPX files into one
 * Usage: node scripts/combineGpx.js <output-file> <input-files...>
 */

import fs from 'fs';
import path from 'path';

function parseGpxPoints(gpxContent) {
    const points = [];
    const trkptRegex = /<trkpt[^>]*lat="([^"]+)"[^>]*lon="([^"]+)"[^>]*>([\s\S]*?)<\/trkpt>/g;

    let match;
    while ((match = trkptRegex.exec(gpxContent)) !== null) {
        const lat = parseFloat(match[1]);
        const lon = parseFloat(match[2]);
        const eleMatch = match[3].match(/<ele>([^<]+)<\/ele>/);
        const timeMatch = match[3].match(/<time>([^<]+)<\/time>/);

        points.push({
            lat,
            lon,
            ele: eleMatch ? parseFloat(eleMatch[1]) : null,
            time: timeMatch ? new Date(timeMatch[1]) : null
        });
    }

    return points;
}

// Main
const args = process.argv.slice(2);
if (args.length < 2) {
    console.log('Usage: node scripts/combineGpx.js <output-file> <input-files...>');
    console.log('Example: node scripts/combineGpx.js combined.gpx gpx-data/*.gpx');
    process.exit(0);
}

const outputFile = args[0];
const inputFiles = args.slice(1);

let allPoints = [];

inputFiles.forEach(file => {
    if (!fs.existsSync(file)) {
        console.error(`File not found: ${file}`);
        return;
    }
    const content = fs.readFileSync(file, 'utf-8');
    const points = parseGpxPoints(content);
    console.log(`${path.basename(file)}: ${points.length} points`);
    allPoints.push(...points);
});

// Sort by time if available
allPoints.sort((a, b) => {
    if (a.time && b.time) return a.time - b.time;
    return 0;
});

console.log(`\nTotal: ${allPoints.length} points`);

// Generate combined GPX
const gpxContent = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Akashic">
  <trk>
    <name>Combined Track</name>
    <trkseg>
${allPoints.map(p => `      <trkpt lat="${p.lat}" lon="${p.lon}">
        <ele>${p.ele || 0}</ele>
      </trkpt>`).join('\n')}
    </trkseg>
  </trk>
</gpx>`;

fs.writeFileSync(outputFile, gpxContent);
console.log(`\nSaved combined GPX to: ${outputFile}`);
