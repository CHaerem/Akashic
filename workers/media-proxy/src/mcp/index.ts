/**
 * MCP (Model Context Protocol) JSON-RPC Router
 *
 * Handles MCP protocol requests and routes them to tool handlers.
 */

import type { Env } from '../index';
import {
    JsonRpcRequest,
    JsonRpcResponse,
    JsonRpcError,
    JSON_RPC_ERRORS,
    MCP_ERRORS,
    MCPInitializeResult,
    MCPToolsListResult,
    MCPToolCallParams,
    MCPToolResult,
} from './types';
import { toolDefinitions, executeTool } from './tools';

const PROTOCOL_VERSION = '2024-11-05';
const SERVER_NAME = 'akashic-mcp';
const SERVER_VERSION = '1.0.0';

// CORS headers for MCP requests
const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
};

/**
 * Create a JSON-RPC error response
 */
function errorResponse(id: string | number | null, code: number, message: string, data?: unknown): JsonRpcResponse {
    return {
        jsonrpc: '2.0',
        id,
        error: { code, message, data },
    };
}

/**
 * Create a JSON-RPC success response
 */
function successResponse(id: string | number, result: unknown): JsonRpcResponse {
    return {
        jsonrpc: '2.0',
        id,
        result,
    };
}

/**
 * Handle the 'initialize' method
 */
function handleInitialize(): MCPInitializeResult {
    return {
        protocolVersion: PROTOCOL_VERSION,
        serverInfo: {
            name: SERVER_NAME,
            version: SERVER_VERSION,
        },
        capabilities: {
            tools: {},
        },
    };
}

/**
 * Handle the 'tools/list' method
 */
function handleToolsList(): MCPToolsListResult {
    return {
        tools: toolDefinitions,
    };
}

/**
 * Handle the 'tools/call' method
 */
async function handleToolsCall(
    params: MCPToolCallParams,
    userId: string,
    env: Env
): Promise<MCPToolResult> {
    const { name, arguments: args } = params;
    return executeTool(name, args, userId, env);
}

/**
 * Main MCP request handler
 */
export async function handleMcpRequest(
    request: Request,
    env: Env,
    verifyJWT: (token: string, supabaseUrl: string) => Promise<{ sub: string } | null>
): Promise<Response> {
    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
        return new Response(null, { headers: corsHeaders });
    }

    // Only accept POST
    if (request.method !== 'POST') {
        return new Response(JSON.stringify(errorResponse(null, JSON_RPC_ERRORS.INVALID_REQUEST, 'Method not allowed')), {
            status: 405,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
    }

    // Parse JSON body
    let body: JsonRpcRequest;
    try {
        body = await request.json() as JsonRpcRequest;
    } catch {
        return new Response(JSON.stringify(errorResponse(null, JSON_RPC_ERRORS.PARSE_ERROR, 'Parse error')), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
    }

    // Validate JSON-RPC request
    if (body.jsonrpc !== '2.0' || !body.method || body.id === undefined) {
        return new Response(JSON.stringify(errorResponse(body?.id ?? null, JSON_RPC_ERRORS.INVALID_REQUEST, 'Invalid Request')), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
    }

    const { id, method, params } = body;

    // Handle methods that don't require auth
    if (method === 'initialize') {
        return new Response(JSON.stringify(successResponse(id, handleInitialize())), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
    }

    if (method === 'ping') {
        return new Response(JSON.stringify(successResponse(id, {})), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
    }

    if (method === 'tools/list') {
        return new Response(JSON.stringify(successResponse(id, handleToolsList())), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
    }

    // All other methods require authentication
    const authHeader = request.headers.get('Authorization');
    const token = authHeader?.replace('Bearer ', '');

    if (!token) {
        return new Response(JSON.stringify(errorResponse(id, MCP_ERRORS.UNAUTHORIZED, 'Authentication required')), {
            status: 401,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
    }

    const payload = await verifyJWT(token, env.SUPABASE_URL);
    if (!payload) {
        return new Response(JSON.stringify(errorResponse(id, MCP_ERRORS.UNAUTHORIZED, 'Invalid token')), {
            status: 401,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
    }

    const userId = payload.sub;

    // Handle authenticated methods
    if (method === 'tools/call') {
        if (!params || typeof params !== 'object' || !('name' in params)) {
            return new Response(JSON.stringify(errorResponse(id, JSON_RPC_ERRORS.INVALID_PARAMS, 'Invalid params: name required')), {
                status: 400,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
        }

        try {
            const toolParams = params as MCPToolCallParams;
            const result = await handleToolsCall(toolParams, userId, env);
            return new Response(JSON.stringify(successResponse(id, result)), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Tool execution failed';
            return new Response(JSON.stringify(errorResponse(id, JSON_RPC_ERRORS.INTERNAL_ERROR, message)), {
                status: 500,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
        }
    }

    // Unknown method
    return new Response(JSON.stringify(errorResponse(id, JSON_RPC_ERRORS.METHOD_NOT_FOUND, `Method not found: ${method}`)), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
}
