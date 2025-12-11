-- Add video support columns to photos table
ALTER TABLE photos ADD COLUMN IF NOT EXISTS media_type TEXT DEFAULT 'image';
ALTER TABLE photos ADD COLUMN IF NOT EXISTS duration INTEGER;

-- Add comment for clarity
COMMENT ON COLUMN photos.media_type IS 'Media type: image (default) or video';
COMMENT ON COLUMN photos.duration IS 'Duration in seconds for videos';
