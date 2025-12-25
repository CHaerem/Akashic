-- Add location_source column to track origin of photo coordinates
-- Values: 'exif' (original from photo), 'estimated' (based on timestamp), 'manual' (user adjusted)

ALTER TABLE photos ADD COLUMN location_source TEXT CHECK (location_source IN ('exif', 'estimated', 'manual'));

-- Set existing photos with coordinates to 'exif' as default (most were from EXIF)
-- Photos that were interpolated should be updated via script
UPDATE photos SET location_source = 'exif' WHERE coordinates IS NOT NULL AND location_source IS NULL;

-- Add index for filtering by source
CREATE INDEX idx_photos_location_source ON photos(location_source) WHERE location_source IS NOT NULL;

COMMENT ON COLUMN photos.location_source IS 'Origin of coordinates: exif=from photo metadata, estimated=interpolated from timestamp, manual=user adjusted';
