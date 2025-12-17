/**
 * Database types for journeys
 * Maps to Supabase table schemas
 */

import type { Route, TrekStats } from '../../types/trek';

// Database types (from Supabase)
export interface DbJourney {
    id: string;
    slug: string;
    name: string;
    description: string | null;
    country: string | null;
    summit_elevation: number | null;
    total_distance: number | null;
    total_days: number | null;
    date_started: string | null;
    date_ended: string | null;
    hero_image_url: string | null;
    center_coordinates: [number, number] | null;
    route: Route | null;
    stats: TrekStats | null;
    preferred_bearing: number | null;
    preferred_pitch: number | null;
    is_public: boolean;
}

/** Historical weather data from Open-Meteo API */
export interface WeatherData {
    /** Maximum temperature (°C) */
    temperature_max: number;
    /** Minimum temperature (°C) */
    temperature_min: number;
    /** Total precipitation (mm) */
    precipitation_sum: number;
    /** Maximum wind speed (km/h) */
    wind_speed_max: number;
    /** WMO weather code (0-99) */
    weather_code: number;
    /** When the data was fetched */
    fetched_at: string;
}

export interface DbWaypoint {
    id: string;
    journey_id: string;
    name: string;
    waypoint_type: string;
    day_number: number | null;
    coordinates: [number, number];
    elevation: number | null;
    description: string | null;
    highlights: string[] | null;
    sort_order: number | null;
    /** Distance from journey start along route (km) */
    route_distance_km: number | null;
    /** Index in route coordinates array */
    route_point_index: number | null;
    /** Historical weather data for the day */
    weather: WeatherData | null;
}
