-- Add route column to store GeoJSON LineString data
ALTER TABLE journeys ADD COLUMN route JSONB;

-- Add stats column to store trek statistics
ALTER TABLE journeys ADD COLUMN stats JSONB;

-- Add preferred_bearing and preferred_pitch for map camera settings
ALTER TABLE journeys ADD COLUMN preferred_bearing NUMERIC;
ALTER TABLE journeys ADD COLUMN preferred_pitch NUMERIC DEFAULT 60;

-- Comment for documentation
COMMENT ON COLUMN journeys.route IS 'GeoJSON LineString with coordinates [lng, lat, elevation]';
COMMENT ON COLUMN journeys.stats IS 'Trek statistics: totalDistance, totalElevationGain, duration, highestPoint, etc.';
