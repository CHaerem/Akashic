/**
 * View Routes Script
 *
 * Opens current trek routes in geojson.io for verification against satellite imagery.
 *
 * Usage: node scripts/viewRoutes.js [trek-id]
 *
 * Examples:
 *   node scripts/viewRoutes.js              # View all treks
 *   node scripts/viewRoutes.js kilimanjaro  # View specific trek
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { exec } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Trek data files
const trekFiles = {
    kilimanjaro: path.join(__dirname, '../src/data/kilimanjaro.json'),
    mountKenya: path.join(__dirname, '../src/data/mountKenya.json'),
    incaTrail: path.join(__dirname, '../src/data/incaTrail.json')
};

function loadTrek(id) {
    const filePath = trekFiles[id];
    if (!filePath || !fs.existsSync(filePath)) {
        return null;
    }
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

function createGeoJSON(treks) {
    const features = [];

    treks.forEach(trek => {
        // Route line
        features.push({
            type: 'Feature',
            properties: {
                name: trek.name,
                type: 'route',
                stroke: '#ff6b6b',
                'stroke-width': 3,
                'stroke-opacity': 0.8
            },
            geometry: trek.route
        });

        // Camp markers
        trek.camps.forEach(camp => {
            features.push({
                type: 'Feature',
                properties: {
                    name: camp.name,
                    type: 'camp',
                    day: camp.dayNumber,
                    elevation: camp.elevation,
                    'marker-color': '#4ecdc4',
                    'marker-size': 'medium',
                    'marker-symbol': 'campsite'
                },
                geometry: {
                    type: 'Point',
                    coordinates: camp.coordinates
                }
            });
        });
    });

    return {
        type: 'FeatureCollection',
        features
    };
}

// Main
const args = process.argv.slice(2);
const trekId = args[0];

let treks = [];

if (trekId) {
    const trek = loadTrek(trekId);
    if (!trek) {
        console.error(`Trek not found: ${trekId}`);
        console.log('Available treks:', Object.keys(trekFiles).join(', '));
        process.exit(1);
    }
    treks = [trek];
} else {
    // Load all treks
    Object.keys(trekFiles).forEach(id => {
        const trek = loadTrek(id);
        if (trek) treks.push(trek);
    });
}

const geojson = createGeoJSON(treks);

// Save to file
const outputPath = path.join(__dirname, '../routes-preview.geojson');
fs.writeFileSync(outputPath, JSON.stringify(geojson, null, 2));
console.log(`Saved GeoJSON to: ${outputPath}`);

// Create geojson.io URL (URL-encoded)
const encoded = encodeURIComponent(JSON.stringify(geojson));
const url = `https://geojson.io/#data=data:application/json,${encoded}`;

// Try to open in browser
console.log('\nOpening in browser...');
console.log('(If it doesn\'t open, the URL may be too long - use the file instead)\n');

const openCommand = process.platform === 'darwin' ? 'open' :
    process.platform === 'win32' ? 'start' : 'xdg-open';

exec(`${openCommand} "${url}"`, (err) => {
    if (err) {
        console.log('Could not open browser automatically.');
        console.log('\nAlternative options:');
        console.log('1. Go to https://geojson.io and drag the routes-preview.geojson file');
        console.log('2. Open in QGIS or similar GIS software');
        console.log('3. View in VS Code with a GeoJSON preview extension');
    }
});

console.log('\n--- Route Summary ---\n');
treks.forEach(trek => {
    console.log(`${trek.name}:`);
    console.log(`  Points in route: ${trek.route.coordinates.length}`);
    console.log(`  Camps: ${trek.camps.length}`);
    trek.camps.forEach(camp => {
        console.log(`    Day ${camp.dayNumber}: ${camp.name} (${camp.elevation}m) [${camp.coordinates.join(', ')}]`);
    });
    console.log('');
});
