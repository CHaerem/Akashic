-- Add route positioning columns to waypoints
-- These track where each waypoint sits along the journey route

-- Distance from the start of the route in kilometers
ALTER TABLE waypoints ADD COLUMN route_distance_km NUMERIC;

-- Index into the route coordinates array (for precise snapping)
ALTER TABLE waypoints ADD COLUMN route_point_index INTEGER;

-- Comment for documentation
COMMENT ON COLUMN waypoints.route_distance_km IS 'Cumulative distance from journey start along the route (km)';
COMMENT ON COLUMN waypoints.route_point_index IS 'Index into the journey route coordinates array for precise positioning';
