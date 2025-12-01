/**
 * MCP (Model Context Protocol) type definitions
 * Implements JSON-RPC 2.0 for MCP communication
 */

// JSON-RPC 2.0 Types
export interface JsonRpcRequest {
    jsonrpc: '2.0';
    id: string | number;
    method: string;
    params?: Record<string, unknown>;
}

export interface JsonRpcResponse {
    jsonrpc: '2.0';
    id: string | number | null;
    result?: unknown;
    error?: JsonRpcError;
}

export interface JsonRpcError {
    code: number;
    message: string;
    data?: unknown;
}

// Standard JSON-RPC error codes
export const JSON_RPC_ERRORS = {
    PARSE_ERROR: -32700,
    INVALID_REQUEST: -32600,
    METHOD_NOT_FOUND: -32601,
    INVALID_PARAMS: -32602,
    INTERNAL_ERROR: -32603,
} as const;

// MCP-specific error codes
export const MCP_ERRORS = {
    UNAUTHORIZED: -32001,
    FORBIDDEN: -32003,
    NOT_FOUND: -32004,
} as const;

// MCP Protocol Types
export interface MCPServerInfo {
    name: string;
    version: string;
}

export interface MCPCapabilities {
    tools?: Record<string, never>;
}

export interface MCPInitializeResult {
    protocolVersion: string;
    serverInfo: MCPServerInfo;
    capabilities: MCPCapabilities;
}

export interface MCPToolDefinition {
    name: string;
    description: string;
    inputSchema: {
        type: 'object';
        properties: Record<string, unknown>;
        required?: string[];
    };
}

export interface MCPToolsListResult {
    tools: MCPToolDefinition[];
}

export interface MCPToolCallParams {
    name: string;
    arguments: Record<string, unknown>;
}

export interface MCPToolResult {
    content: MCPContent[];
    isError?: boolean;
}

export interface MCPContent {
    type: 'text' | 'image' | 'resource';
    text?: string;
    data?: string;
    mimeType?: string;
}

// Journey-specific types for MCP tools (ported from frontend types)
export interface JourneyListItem {
    id: string;
    slug: string;
    name: string;
    country: string | null;
    total_days: number | null;
    total_distance: number | null;
    summit_elevation: number | null;
    date_started: string | null;
}

export interface JourneyDetails {
    id: string;
    slug: string;
    name: string;
    country: string | null;
    description: string | null;
    date_started: string | null;
    stats: TrekStats | null;
    camps: Camp[];
    route: Route | null;
}

export interface TrekStats {
    duration: number;
    totalDistance: number;
    totalElevationGain: number;
    highestPoint: { name: string; elevation: number };
}

export interface Camp {
    id: string;
    name: string;
    dayNumber: number;
    elevation: number;
    coordinates: [number, number];
    notes: string;
    highlights?: string[];
    routeDistanceKm?: number | null;
    routePointIndex?: number | null;
}

export interface Route {
    type: 'LineString';
    coordinates: [number, number, number][];
}

export interface ExtendedStats {
    avgDailyDistance: string;
    maxDailyGain: number;
    maxDailyLoss: number;
    totalElevationGain: number;
    totalElevationLoss: number;
    difficulty: string;
    startElevation: number;
    endElevation: number;
    avgAltitude: number;
    longestDayDistance: number;
    longestDayNumber: number;
    estimatedTotalTime: string;
    steepestDayGradient: number;
    steepestDayNumber: number;
}

export interface Photo {
    id: string;
    journey_id: string;
    waypoint_id?: string | null;
    url: string;
    thumbnail_url?: string | null;
    caption?: string | null;
    coordinates?: [number, number] | null;
    taken_at?: string | null;
    is_hero?: boolean;
    sort_order?: number;
}
