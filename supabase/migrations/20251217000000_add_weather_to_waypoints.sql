-- Add weather data column to waypoints
-- Stores historical weather data fetched from Open-Meteo API
-- Structure: {
--   temperature_max: number (°C),
--   temperature_min: number (°C),
--   precipitation_sum: number (mm),
--   wind_speed_max: number (km/h),
--   weather_code: number (WMO code),
--   fetched_at: string (ISO date)
-- }

ALTER TABLE waypoints
ADD COLUMN IF NOT EXISTS weather JSONB;

COMMENT ON COLUMN waypoints.weather IS 'Historical weather data for the day (from Open-Meteo API)';
