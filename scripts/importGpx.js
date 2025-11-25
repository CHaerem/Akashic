/**
 * GPX Import Script
 *
 * Converts GPX track files to route coordinates for trek data.
 *
 * Usage: node scripts/importGpx.js <gpx-file> [--simplify <tolerance>]
 *
 * The script will:
 * 1. Parse the GPX file
 * 2. Extract track points with coordinates and elevation
 * 3. Optionally simplify the track (reduce points while preserving shape)
 * 4. Output JSON coordinates ready to paste into trek data files
 */

import fs from 'fs';
import path from 'path';

// Simple GPX parser (no dependencies)
function parseGpx(gpxContent) {
    const points = [];

    // Match all trkpt elements
    const trkptRegex = /<trkpt[^>]*lat="([^"]+)"[^>]*lon="([^"]+)"[^>]*>([\s\S]*?)<\/trkpt>/g;
    const trkptAltRegex = /<trkpt[^>]*lon="([^"]+)"[^>]*lat="([^"]+)"[^>]*>([\s\S]*?)<\/trkpt>/g;

    let match;

    // Try lat first, then lon
    while ((match = trkptRegex.exec(gpxContent)) !== null) {
        const lat = parseFloat(match[1]);
        const lon = parseFloat(match[2]);
        const eleMatch = match[3].match(/<ele>([^<]+)<\/ele>/);
        const ele = eleMatch ? parseFloat(eleMatch[1]) : null;

        points.push({ lat, lon, ele });
    }

    // If no points found, try alternate attribute order
    if (points.length === 0) {
        while ((match = trkptAltRegex.exec(gpxContent)) !== null) {
            const lon = parseFloat(match[1]);
            const lat = parseFloat(match[2]);
            const eleMatch = match[3].match(/<ele>([^<]+)<\/ele>/);
            const ele = eleMatch ? parseFloat(eleMatch[1]) : null;

            points.push({ lat, lon, ele });
        }
    }

    return points;
}

// Douglas-Peucker simplification algorithm
function simplifyTrack(points, tolerance) {
    if (points.length <= 2) return points;

    // Find point with maximum distance from line between first and last
    let maxDist = 0;
    let maxIndex = 0;

    const first = points[0];
    const last = points[points.length - 1];

    for (let i = 1; i < points.length - 1; i++) {
        const dist = perpendicularDistance(points[i], first, last);
        if (dist > maxDist) {
            maxDist = dist;
            maxIndex = i;
        }
    }

    // If max distance > tolerance, recursively simplify
    if (maxDist > tolerance) {
        const left = simplifyTrack(points.slice(0, maxIndex + 1), tolerance);
        const right = simplifyTrack(points.slice(maxIndex), tolerance);
        return [...left.slice(0, -1), ...right];
    }

    return [first, last];
}

function perpendicularDistance(point, lineStart, lineEnd) {
    const dx = lineEnd.lon - lineStart.lon;
    const dy = lineEnd.lat - lineStart.lat;

    const mag = Math.sqrt(dx * dx + dy * dy);
    if (mag === 0) return Math.sqrt(
        Math.pow(point.lon - lineStart.lon, 2) +
        Math.pow(point.lat - lineStart.lat, 2)
    );

    const u = ((point.lon - lineStart.lon) * dx + (point.lat - lineStart.lat) * dy) / (mag * mag);

    let closestLon, closestLat;
    if (u < 0) {
        closestLon = lineStart.lon;
        closestLat = lineStart.lat;
    } else if (u > 1) {
        closestLon = lineEnd.lon;
        closestLat = lineEnd.lat;
    } else {
        closestLon = lineStart.lon + u * dx;
        closestLat = lineStart.lat + u * dy;
    }

    return Math.sqrt(
        Math.pow(point.lon - closestLon, 2) +
        Math.pow(point.lat - closestLat, 2)
    );
}

// Main
const args = process.argv.slice(2);
if (args.length === 0) {
    console.log(`
GPX Import Script

Usage: node scripts/importGpx.js <gpx-file> [--simplify <tolerance>]

Options:
  --simplify <n>   Simplify track, keeping roughly n points (default: 100)
  --raw            Output all points without simplification

Example:
  node scripts/importGpx.js ~/Downloads/kilimanjaro.gpx --simplify 150
`);
    process.exit(0);
}

const gpxPath = args[0];
let targetPoints = 100;
let raw = false;

for (let i = 1; i < args.length; i++) {
    if (args[i] === '--simplify' && args[i + 1]) {
        targetPoints = parseInt(args[i + 1]);
        i++;
    } else if (args[i] === '--raw') {
        raw = true;
    }
}

if (!fs.existsSync(gpxPath)) {
    console.error(`File not found: ${gpxPath}`);
    process.exit(1);
}

const gpxContent = fs.readFileSync(gpxPath, 'utf-8');
let points = parseGpx(gpxContent);

console.log(`Parsed ${points.length} track points from GPX`);

if (!raw && points.length > targetPoints) {
    // Calculate tolerance to achieve target point count (approximate)
    let tolerance = 0.0001;
    let simplified = simplifyTrack(points, tolerance);

    // Binary search for right tolerance
    let low = 0.00001;
    let high = 0.01;

    for (let i = 0; i < 20; i++) {
        tolerance = (low + high) / 2;
        simplified = simplifyTrack(points, tolerance);

        if (simplified.length > targetPoints) {
            low = tolerance;
        } else {
            high = tolerance;
        }

        if (Math.abs(simplified.length - targetPoints) < 10) break;
    }

    points = simplified;
    console.log(`Simplified to ${points.length} points`);
}

// Convert to GeoJSON coordinate format [lon, lat, ele]
const coordinates = points.map(p => {
    if (p.ele !== null) {
        return [Math.round(p.lon * 10000) / 10000, Math.round(p.lat * 10000) / 10000, Math.round(p.ele)];
    }
    return [Math.round(p.lon * 10000) / 10000, Math.round(p.lat * 10000) / 10000];
});

console.log('\n--- Route coordinates (paste into trek JSON file) ---\n');
console.log('"route": {');
console.log('    "type": "LineString",');
console.log('    "coordinates": ' + JSON.stringify(coordinates, null, 8).split('\n').map((line, i) => i === 0 ? line : '    ' + line).join('\n'));
console.log('}');

// Also output stats
const elevations = points.filter(p => p.ele !== null).map(p => p.ele);
if (elevations.length > 0) {
    console.log('\n--- Stats ---');
    console.log(`Min elevation: ${Math.min(...elevations)}m`);
    console.log(`Max elevation: ${Math.max(...elevations)}m`);
    console.log(`Start: [${coordinates[0].join(', ')}]`);
    console.log(`End: [${coordinates[coordinates.length - 1].join(', ')}]`);
}
