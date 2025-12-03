/**
 * MCP Tool Registry and Implementations
 *
 * Defines available tools and their handlers for the Akashic MCP server.
 */

import type { Env } from '../../index';
import type {
    MCPToolDefinition,
    MCPToolResult,
    MCPContent,
    JourneyListItem,
    JourneyDetails,
    Camp,
    Route,
    TrekStats,
    ExtendedStats,
    Photo,
} from '../types';
import { MCP_ERRORS } from '../types';

// Tool definitions for tools/list
export const toolDefinitions: MCPToolDefinition[] = [
    {
        name: 'list_journeys',
        description: 'List all journeys accessible to the authenticated user. Returns journey metadata including name, country, duration, and distance.',
        inputSchema: {
            type: 'object',
            properties: {
                limit: {
                    type: 'number',
                    description: 'Maximum number of journeys to return (default: 20, max: 100)',
                },
                offset: {
                    type: 'number',
                    description: 'Number of journeys to skip for pagination',
                },
                country: {
                    type: 'string',
                    description: 'Filter by country name (case-insensitive)',
                },
            },
        },
    },
    {
        name: 'get_journey_details',
        description: 'Get full details of a specific journey including camps/waypoints, route coordinates, and statistics.',
        inputSchema: {
            type: 'object',
            properties: {
                journey_id: {
                    type: 'string',
                    description: 'Journey ID (UUID) or slug',
                },
            },
            required: ['journey_id'],
        },
    },
    {
        name: 'search_journeys',
        description: 'Search journeys by name, country, or description. Returns matching journeys.',
        inputSchema: {
            type: 'object',
            properties: {
                query: {
                    type: 'string',
                    description: 'Search query to match against journey name, country, or description',
                },
                limit: {
                    type: 'number',
                    description: 'Maximum number of results (default: 10, max: 50)',
                },
            },
            required: ['query'],
        },
    },
    {
        name: 'get_journey_stats',
        description: 'Get computed statistics for a journey including difficulty rating, estimated hiking time, elevation analysis, and daily stats.',
        inputSchema: {
            type: 'object',
            properties: {
                journey_id: {
                    type: 'string',
                    description: 'Journey ID (UUID) or slug',
                },
            },
            required: ['journey_id'],
        },
    },
    {
        name: 'get_journey_photos',
        description: 'Get photos for a journey with metadata including GPS coordinates and capture date.',
        inputSchema: {
            type: 'object',
            properties: {
                journey_id: {
                    type: 'string',
                    description: 'Journey ID (UUID) or slug',
                },
                waypoint_id: {
                    type: 'string',
                    description: 'Filter photos by specific waypoint/day',
                },
                limit: {
                    type: 'number',
                    description: 'Maximum number of photos (default: 50, max: 200)',
                },
            },
            required: ['journey_id'],
        },
    },
];

// Helper to create text content
function textContent(text: string): MCPContent {
    return { type: 'text', text };
}

// Helper to create tool result
function toolResult(content: MCPContent[], isError = false): MCPToolResult {
    return { content, isError };
}

// Helper to create error result
function errorResult(message: string): MCPToolResult {
    return toolResult([textContent(message)], true);
}

// Supabase REST API helper
async function supabaseQuery<T>(
    env: Env,
    endpoint: string,
    options: { method?: string; body?: unknown } = {}
): Promise<T> {
    const response = await fetch(`${env.SUPABASE_URL}/rest/v1/${endpoint}`, {
        method: options.method || 'GET',
        headers: {
            'apikey': env.SUPABASE_SERVICE_KEY,
            'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}`,
            'Content-Type': 'application/json',
        },
        body: options.body ? JSON.stringify(options.body) : undefined,
    });

    if (!response.ok) {
        throw new Error(`Supabase query failed: ${response.status}`);
    }

    return response.json() as Promise<T>;
}

// Get journey ID from UUID or slug
async function resolveJourneyId(journeyIdOrSlug: string, env: Env): Promise<string | null> {
    // If it looks like a UUID, use it directly
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(journeyIdOrSlug)) {
        return journeyIdOrSlug;
    }

    // Otherwise, look up by slug
    const journeys = await supabaseQuery<{ id: string }[]>(
        env,
        `journeys?slug=eq.${encodeURIComponent(journeyIdOrSlug)}&select=id`
    );

    return journeys.length > 0 ? journeys[0].id : null;
}

// Check if user has access to a journey
async function checkAccess(journeyId: string, userId: string, env: Env): Promise<boolean> {
    const members = await supabaseQuery<{ role: string }[]>(
        env,
        `journey_members?journey_id=eq.${journeyId}&user_id=eq.${userId}&select=role`
    );
    return members.length > 0;
}

// Get user's accessible journey IDs
async function getUserJourneyIds(userId: string, env: Env): Promise<string[]> {
    const members = await supabaseQuery<{ journey_id: string }[]>(
        env,
        `journey_members?user_id=eq.${userId}&select=journey_id`
    );
    return members.map(m => m.journey_id);
}

// ============================================================================
// Tool Implementations
// ============================================================================

interface ListJourneysArgs {
    limit?: number;
    offset?: number;
    country?: string;
}

async function listJourneys(args: ListJourneysArgs, userId: string, env: Env): Promise<MCPToolResult> {
    const limit = Math.min(args.limit || 20, 100);
    const offset = args.offset || 0;

    // Get user's accessible journeys
    const journeyIds = await getUserJourneyIds(userId, env);
    if (journeyIds.length === 0) {
        return toolResult([textContent(JSON.stringify({ journeys: [], total: 0, hasMore: false }))]);
    }

    // Build query
    let query = `journeys?id=in.(${journeyIds.join(',')})&select=id,slug,name,country,total_days,total_distance,summit_elevation,date_started&order=name`;

    if (args.country) {
        query += `&country=ilike.*${encodeURIComponent(args.country)}*`;
    }

    query += `&limit=${limit}&offset=${offset}`;

    const journeys = await supabaseQuery<JourneyListItem[]>(env, query);

    // Get total count
    const countQuery = `journeys?id=in.(${journeyIds.join(',')})&select=id`;
    const allJourneys = await supabaseQuery<{ id: string }[]>(env, countQuery);
    const total = allJourneys.length;

    const result = {
        journeys,
        total,
        hasMore: offset + journeys.length < total,
    };

    return toolResult([textContent(JSON.stringify(result, null, 2))]);
}

interface GetJourneyDetailsArgs {
    journey_id: string;
}

async function getJourneyDetails(args: GetJourneyDetailsArgs, userId: string, env: Env): Promise<MCPToolResult> {
    if (!args.journey_id) {
        return errorResult('journey_id is required');
    }

    const journeyId = await resolveJourneyId(args.journey_id, env);
    if (!journeyId) {
        return errorResult(`Journey not found: ${args.journey_id}`);
    }

    // Check access
    const hasAccess = await checkAccess(journeyId, userId, env);
    if (!hasAccess) {
        return errorResult('Access denied');
    }

    // Fetch journey with route and stats
    const journeys = await supabaseQuery<{
        id: string;
        slug: string;
        name: string;
        country: string | null;
        description: string | null;
        date_started: string | null;
        route: Route | null;
        stats: TrekStats | null;
    }[]>(env, `journeys?id=eq.${journeyId}&select=id,slug,name,country,description,date_started,route,stats`);

    if (journeys.length === 0) {
        return errorResult(`Journey not found: ${args.journey_id}`);
    }

    const journey = journeys[0];

    // Fetch waypoints
    const waypoints = await supabaseQuery<{
        id: string;
        name: string;
        day_number: number;
        elevation: number;
        coordinates: [number, number];
        description: string | null;
        highlights: string[] | null;
        route_distance_km: number | null;
        route_point_index: number | null;
    }[]>(env, `waypoints?journey_id=eq.${journeyId}&select=*&order=sort_order,day_number`);

    // Transform to camps
    const camps: Camp[] = waypoints.map(w => ({
        id: w.id,
        name: w.name,
        dayNumber: w.day_number,
        elevation: w.elevation,
        coordinates: w.coordinates,
        notes: w.description || '',
        highlights: w.highlights || undefined,
        routeDistanceKm: w.route_distance_km,
        routePointIndex: w.route_point_index,
    }));

    const result: JourneyDetails = {
        id: journey.id,
        slug: journey.slug,
        name: journey.name,
        country: journey.country,
        description: journey.description,
        date_started: journey.date_started,
        stats: journey.stats,
        camps,
        route: journey.route,
    };

    return toolResult([textContent(JSON.stringify(result, null, 2))]);
}

interface SearchJourneysArgs {
    query: string;
    limit?: number;
}

async function searchJourneys(args: SearchJourneysArgs, userId: string, env: Env): Promise<MCPToolResult> {
    if (!args.query) {
        return errorResult('query is required');
    }

    const limit = Math.min(args.limit || 10, 50);
    const searchTerm = encodeURIComponent(args.query);

    // Get user's accessible journeys
    const journeyIds = await getUserJourneyIds(userId, env);
    if (journeyIds.length === 0) {
        return toolResult([textContent(JSON.stringify({ journeys: [], total: 0 }))]);
    }

    // Search across name, country, description
    // Using or filter for multiple fields
    const query = `journeys?id=in.(${journeyIds.join(',')})&or=(name.ilike.*${searchTerm}*,country.ilike.*${searchTerm}*,description.ilike.*${searchTerm}*)&select=id,slug,name,country,total_days,total_distance,summit_elevation,date_started&limit=${limit}`;

    const journeys = await supabaseQuery<JourneyListItem[]>(env, query);

    return toolResult([textContent(JSON.stringify({ journeys, total: journeys.length }, null, 2))]);
}

interface GetJourneyStatsArgs {
    journey_id: string;
}

async function getJourneyStats(args: GetJourneyStatsArgs, userId: string, env: Env): Promise<MCPToolResult> {
    if (!args.journey_id) {
        return errorResult('journey_id is required');
    }

    const journeyId = await resolveJourneyId(args.journey_id, env);
    if (!journeyId) {
        return errorResult(`Journey not found: ${args.journey_id}`);
    }

    // Check access
    const hasAccess = await checkAccess(journeyId, userId, env);
    if (!hasAccess) {
        return errorResult('Access denied');
    }

    // Fetch journey with route and stats
    const journeys = await supabaseQuery<{
        id: string;
        name: string;
        route: Route | null;
        stats: TrekStats | null;
    }[]>(env, `journeys?id=eq.${journeyId}&select=id,name,route,stats`);

    if (journeys.length === 0) {
        return errorResult(`Journey not found: ${args.journey_id}`);
    }

    const journey = journeys[0];

    if (!journey.route || !journey.stats) {
        return errorResult('Journey has no route or stats data');
    }

    // Fetch waypoints for detailed stats
    const waypoints = await supabaseQuery<{
        id: string;
        name: string;
        day_number: number;
        elevation: number;
        coordinates: [number, number];
        route_distance_km: number | null;
        route_point_index: number | null;
    }[]>(env, `waypoints?journey_id=eq.${journeyId}&select=*&order=sort_order,day_number`);

    // Calculate extended stats
    const extendedStats = calculateExtendedStats(journey.route, journey.stats, waypoints);

    const result = {
        journeyName: journey.name,
        basicStats: journey.stats,
        extendedStats,
    };

    return toolResult([textContent(JSON.stringify(result, null, 2))]);
}

interface GetJourneyPhotosArgs {
    journey_id: string;
    waypoint_id?: string;
    limit?: number;
}

async function getJourneyPhotos(args: GetJourneyPhotosArgs, userId: string, env: Env): Promise<MCPToolResult> {
    if (!args.journey_id) {
        return errorResult('journey_id is required');
    }

    const journeyId = await resolveJourneyId(args.journey_id, env);
    if (!journeyId) {
        return errorResult(`Journey not found: ${args.journey_id}`);
    }

    // Check access
    const hasAccess = await checkAccess(journeyId, userId, env);
    if (!hasAccess) {
        return errorResult('Access denied');
    }

    const limit = Math.min(args.limit || 50, 200);

    let query = `photos?journey_id=eq.${journeyId}&select=id,journey_id,waypoint_id,url,thumbnail_url,caption,coordinates,taken_at,is_hero,sort_order&order=sort_order,taken_at&limit=${limit}`;

    if (args.waypoint_id) {
        query += `&waypoint_id=eq.${args.waypoint_id}`;
    }

    const photos = await supabaseQuery<Photo[]>(env, query);

    return toolResult([textContent(JSON.stringify({ photos, total: photos.length }, null, 2))]);
}

// ============================================================================
// Stats Calculation (ported from src/utils/stats.ts)
// ============================================================================

function getDistanceFromLatLonInKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371; // Radius of the earth in km
    const dLat = deg2rad(lat2 - lat1);
    const dLon = deg2rad(lon2 - lon1);
    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(deg2rad(lat1)) * Math.cos(deg2rad(lat2)) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

function deg2rad(deg: number): number {
    return deg * (Math.PI / 180);
}

function calculateSegmentElevation(
    coords: [number, number, number][],
    startIdx: number,
    endIdx: number
): { gain: number; loss: number } {
    let gain = 0;
    let loss = 0;
    for (let i = startIdx + 1; i <= endIdx && i < coords.length; i++) {
        const diff = coords[i][2] - coords[i - 1][2];
        if (diff > 0) gain += diff;
        else loss += Math.abs(diff);
    }
    return { gain: Math.round(gain), loss: Math.round(loss) };
}

function findRoutePointIndex(point: [number, number], coords: [number, number, number][]): number {
    let minDist = Infinity;
    let closestIdx = 0;
    for (let i = 0; i < coords.length; i++) {
        const dx = coords[i][0] - point[0];
        const dy = coords[i][1] - point[1];
        const dist = dx * dx + dy * dy;
        if (dist < minDist) {
            minDist = dist;
            closestIdx = i;
        }
    }
    return closestIdx;
}

function calculateRouteDistance(coords: [number, number, number][], startIdx: number, endIdx: number): number {
    let dist = 0;
    for (let i = startIdx + 1; i <= endIdx && i < coords.length; i++) {
        dist += getDistanceFromLatLonInKm(
            coords[i - 1][1], coords[i - 1][0],
            coords[i][1], coords[i][0]
        );
    }
    return dist;
}

function formatHikingTime(totalMinutes: number): string {
    const hours = Math.floor(totalMinutes / 60);
    const minutes = Math.round(totalMinutes % 60);
    if (hours === 0) return `${minutes}min`;
    if (minutes === 0) return `${hours}h`;
    return `${hours}h ${minutes}min`;
}

function estimateHikingTimeMinutes(distanceKm: number, elevGain: number, elevLoss: number): number {
    const baseTime = (distanceKm / 5) * 60;
    const ascentTime = elevGain / 10;
    const descentTime = elevLoss / 20;
    return baseTime + ascentTime + descentTime;
}

function calculateDifficultyRating(
    totalDistance: number,
    totalGain: number,
    totalLoss: number,
    avgDailyDist: number,
    maxDayGain: number
): string {
    let score = 0;

    if (avgDailyDist > 20) score += 3;
    else if (avgDailyDist > 15) score += 2;
    else if (avgDailyDist > 10) score += 1;

    if (maxDayGain > 1500) score += 3;
    else if (maxDayGain > 1000) score += 2;
    else if (maxDayGain > 600) score += 1;

    const totalElev = totalGain + totalLoss;
    if (totalElev > 8000) score += 2;
    else if (totalElev > 5000) score += 1;

    if (score >= 6) return 'Extreme';
    if (score >= 4) return 'Hard';
    if (score >= 2) return 'Moderate';
    return 'Easy';
}

interface WaypointData {
    id: string;
    name: string;
    day_number: number;
    elevation: number;
    coordinates: [number, number];
    route_distance_km: number | null;
    route_point_index: number | null;
}

function calculateExtendedStats(
    route: Route,
    stats: TrekStats,
    waypoints: WaypointData[]
): ExtendedStats {
    const duration = stats.duration;
    const distance = stats.totalDistance;
    const coords = route.coordinates;

    const safeDuration = duration > 0 ? duration : 1;
    const avgDailyDistance = (distance / safeDuration).toFixed(1);

    let maxDailyGain = 0;
    let maxDailyLoss = 0;
    let longestDayDistance = 0;
    let longestDayNumber = 1;
    let steepestDayGradient = 0;
    let steepestDayNumber = 1;

    const sortedWaypoints = [...waypoints].sort((a, b) => a.day_number - b.day_number);

    const waypointIndices = sortedWaypoints.map(wp => {
        if (wp.route_point_index != null) {
            return Math.min(wp.route_point_index, coords.length - 1);
        }
        return findRoutePointIndex(wp.coordinates, coords);
    });

    let totalGain = 0;
    let totalLoss = 0;

    for (let i = 0; i < sortedWaypoints.length; i++) {
        const startIdx = i === 0 ? 0 : waypointIndices[i - 1];
        const endIdx = waypointIndices[i];

        const { gain, loss } = calculateSegmentElevation(coords, startIdx, endIdx);
        const segmentDist = calculateRouteDistance(coords, startIdx, endIdx);

        totalGain += gain;
        totalLoss += loss;

        if (gain > maxDailyGain) maxDailyGain = gain;
        if (loss > maxDailyLoss) maxDailyLoss = loss;
        if (segmentDist > longestDayDistance) {
            longestDayDistance = segmentDist;
            longestDayNumber = sortedWaypoints[i].day_number;
        }

        if (segmentDist > 0) {
            const gradient = (gain + loss) / segmentDist;
            if (gradient > steepestDayGradient) {
                steepestDayGradient = gradient;
                steepestDayNumber = sortedWaypoints[i].day_number;
            }
        }
    }

    const avgAltitude = coords.length > 0
        ? Math.round(coords.reduce((sum, c) => sum + c[2], 0) / coords.length)
        : 0;

    const totalTimeMinutes = estimateHikingTimeMinutes(distance, totalGain, totalLoss);
    const estimatedTotalTime = formatHikingTime(totalTimeMinutes);

    const startElevation = coords.length > 0 ? Math.round(coords[0][2]) : 0;
    const endElevation = coords.length > 0 ? Math.round(coords[coords.length - 1][2]) : 0;

    const difficulty = calculateDifficultyRating(
        distance,
        totalGain,
        totalLoss,
        parseFloat(avgDailyDistance),
        maxDailyGain
    );

    return {
        avgDailyDistance,
        maxDailyGain,
        maxDailyLoss,
        totalElevationGain: totalGain,
        totalElevationLoss: totalLoss,
        difficulty,
        startElevation,
        endElevation,
        avgAltitude,
        longestDayDistance: Math.round(longestDayDistance * 10) / 10,
        longestDayNumber,
        estimatedTotalTime,
        steepestDayGradient: Math.round(steepestDayGradient),
        steepestDayNumber,
    };
}

// ============================================================================
// Tool Executor
// ============================================================================

export async function executeTool(
    name: string,
    args: Record<string, unknown>,
    userId: string,
    env: Env
): Promise<MCPToolResult> {
    switch (name) {
        case 'list_journeys':
            return listJourneys(args as ListJourneysArgs, userId, env);
        case 'get_journey_details':
            return getJourneyDetails(args as GetJourneyDetailsArgs, userId, env);
        case 'search_journeys':
            return searchJourneys(args as SearchJourneysArgs, userId, env);
        case 'get_journey_stats':
            return getJourneyStats(args as GetJourneyStatsArgs, userId, env);
        case 'get_journey_photos':
            return getJourneyPhotos(args as GetJourneyPhotosArgs, userId, env);
        default:
            return errorResult(`Unknown tool: ${name}`);
    }
}
