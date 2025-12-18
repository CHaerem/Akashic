-- Add fun facts, points of interest, and historical sites to waypoints
-- These are stored as JSONB arrays for flexible content

-- Fun facts for each day (educational trivia)
ALTER TABLE waypoints
ADD COLUMN IF NOT EXISTS fun_facts JSONB DEFAULT '[]'::jsonb;

-- Points of interest encountered on each day
ALTER TABLE waypoints
ADD COLUMN IF NOT EXISTS points_of_interest JSONB DEFAULT '[]'::jsonb;

-- Historical sites encountered on each day
ALTER TABLE waypoints
ADD COLUMN IF NOT EXISTS historical_sites JSONB DEFAULT '[]'::jsonb;

-- Add comments for documentation
COMMENT ON COLUMN waypoints.fun_facts IS 'Array of fun facts [{id, content, category, source?, learn_more_url?, icon?}]';
COMMENT ON COLUMN waypoints.points_of_interest IS 'Array of POIs [{id, name, category, coordinates, elevation?, description?, route_distance_km?, tips?, time_from_previous?, icon?}]';
COMMENT ON COLUMN waypoints.historical_sites IS 'Array of historical sites [{id, name, coordinates, elevation?, route_distance_km?, summary, description?, period?, significance?, image_urls?, links?, tags?}]';
