import fs from 'fs';
import path from 'path';
import exifParser from 'exif-parser';
import sizeOf from 'image-size';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const IMAGES_DIR = path.join(__dirname, '../public/images');
const OUTPUT_FILE = path.join(__dirname, '../src/data/photoMetadata.json');

const treks = ['kilimanjaro', 'mount-kenya', 'inca-trail'];
const result = {
  kilimanjaro: [],
  mountKenya: [],
  incaTrail: []
};

// Map folder names to JSON keys
const trekKeyMap = {
  'kilimanjaro': 'kilimanjaro',
  'mount-kenya': 'mountKenya',
  'inca-trail': 'incaTrail'
};

function getFiles(dir) {
  const dirents = fs.readdirSync(dir, { withFileTypes: true });
  const files = dirents.map((dirent) => {
    const res = path.resolve(dir, dirent.name);
    return dirent.isDirectory() ? getFiles(res) : res;
  });
  return Array.prototype.concat(...files);
}

function processPhotos() {
  console.log('Starting photo processing...');

  treks.forEach(trekFolder => {
    const trekPath = path.join(IMAGES_DIR, trekFolder);
    if (!fs.existsSync(trekPath)) {
      console.warn(`Warning: Directory not found: ${trekPath}`);
      return;
    }

    const files = getFiles(trekPath);
    const imageFiles = files.filter(file => /\.(jpg|jpeg|png)$/i.test(file));

    console.log(`Found ${imageFiles.length} images in ${trekFolder}`);

    imageFiles.forEach(filePath => {
      try {
        const buffer = fs.readFileSync(filePath);
        let tags = {};
        
        // Try parsing EXIF
        try {
          const parser = exifParser.create(buffer);
          const resultObj = parser.parse();
          tags = resultObj.tags;
        } catch (e) {
          // Ignore EXIF errors, might be PNG or stripped
        }

        // Get dimensions
        const dimensions = sizeOf(filePath);
        
        const relativePath = path.relative(path.join(__dirname, '../public'), filePath);
        const filename = relativePath.split(path.sep).join('/'); // Ensure forward slashes

        const photoData = {
          filename: filename,
          width: dimensions.width,
          height: dimensions.height,
          coordinates: (tags.GPSLatitude && tags.GPSLongitude) 
            ? [tags.GPSLongitude, tags.GPSLatitude] 
            : null,
          elevation: tags.GPSAltitude || null,
          timestamp: tags.DateTimeOriginal ? new Date(tags.DateTimeOriginal * 1000).toISOString() : null,
          campId: null, 
          dayNumber: null 
        };

        const jsonKey = trekKeyMap[trekFolder];
        if (jsonKey) {
          result[jsonKey].push(photoData);
        }

      } catch (err) {
        console.error(`Error processing ${filePath}:`, err.message);
      }
    });
  });

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(result, null, 2));
  console.log(`Successfully wrote metadata to ${OUTPUT_FILE}`);
}

processPhotos();
