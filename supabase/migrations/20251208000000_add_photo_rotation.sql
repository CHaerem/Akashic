-- Add rotation column to photos table
-- Stores rotation angle in degrees (0, 90, 180, 270)
ALTER TABLE photos ADD COLUMN IF NOT EXISTS rotation INTEGER DEFAULT 0;

-- Add constraint to ensure valid rotation values
ALTER TABLE photos ADD CONSTRAINT photos_rotation_check
  CHECK (rotation IS NULL OR rotation IN (0, 90, 180, 270));

-- Comment for documentation
COMMENT ON COLUMN photos.rotation IS 'Rotation angle in degrees (0, 90, 180, 270). Applied as CSS transform on display.';
