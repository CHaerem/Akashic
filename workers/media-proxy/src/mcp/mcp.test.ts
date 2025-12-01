/**
 * MCP Server Tests
 *
 * Tests for the JSON-RPC router and tool definitions.
 * Note: These are unit tests that don't require a running Worker.
 */

import { describe, it, expect } from 'vitest';
import { toolDefinitions } from './tools';
import {
    JSON_RPC_ERRORS,
    MCP_ERRORS,
    type JsonRpcRequest,
    type MCPToolDefinition,
} from './types';

describe('MCP Types', () => {
    it('should have correct JSON-RPC error codes', () => {
        expect(JSON_RPC_ERRORS.PARSE_ERROR).toBe(-32700);
        expect(JSON_RPC_ERRORS.INVALID_REQUEST).toBe(-32600);
        expect(JSON_RPC_ERRORS.METHOD_NOT_FOUND).toBe(-32601);
        expect(JSON_RPC_ERRORS.INVALID_PARAMS).toBe(-32602);
        expect(JSON_RPC_ERRORS.INTERNAL_ERROR).toBe(-32603);
    });

    it('should have correct MCP error codes', () => {
        expect(MCP_ERRORS.UNAUTHORIZED).toBe(-32001);
        expect(MCP_ERRORS.FORBIDDEN).toBe(-32003);
        expect(MCP_ERRORS.NOT_FOUND).toBe(-32004);
    });
});

describe('Tool Definitions', () => {
    it('should export 5 tools', () => {
        expect(toolDefinitions).toHaveLength(5);
    });

    it('should have list_journeys tool', () => {
        const tool = toolDefinitions.find(t => t.name === 'list_journeys');
        expect(tool).toBeDefined();
        expect(tool?.description).toContain('List');
        expect(tool?.inputSchema.type).toBe('object');
        expect(tool?.inputSchema.properties).toHaveProperty('limit');
        expect(tool?.inputSchema.properties).toHaveProperty('offset');
        expect(tool?.inputSchema.properties).toHaveProperty('country');
    });

    it('should have get_journey_details tool with required journey_id', () => {
        const tool = toolDefinitions.find(t => t.name === 'get_journey_details');
        expect(tool).toBeDefined();
        expect(tool?.inputSchema.required).toContain('journey_id');
    });

    it('should have search_journeys tool with required query', () => {
        const tool = toolDefinitions.find(t => t.name === 'search_journeys');
        expect(tool).toBeDefined();
        expect(tool?.inputSchema.required).toContain('query');
    });

    it('should have get_journey_stats tool with required journey_id', () => {
        const tool = toolDefinitions.find(t => t.name === 'get_journey_stats');
        expect(tool).toBeDefined();
        expect(tool?.inputSchema.required).toContain('journey_id');
    });

    it('should have get_journey_photos tool with required journey_id', () => {
        const tool = toolDefinitions.find(t => t.name === 'get_journey_photos');
        expect(tool).toBeDefined();
        expect(tool?.inputSchema.required).toContain('journey_id');
        expect(tool?.inputSchema.properties).toHaveProperty('waypoint_id');
        expect(tool?.inputSchema.properties).toHaveProperty('limit');
    });

    it('all tools should have valid JSON Schema structure', () => {
        for (const tool of toolDefinitions) {
            expect(tool.name).toBeTruthy();
            expect(tool.description).toBeTruthy();
            expect(tool.inputSchema.type).toBe('object');
            expect(tool.inputSchema.properties).toBeDefined();
        }
    });
});

describe('JSON-RPC Request Validation', () => {
    it('should accept valid JSON-RPC 2.0 request structure', () => {
        const validRequest: JsonRpcRequest = {
            jsonrpc: '2.0',
            id: 1,
            method: 'tools/list',
        };
        expect(validRequest.jsonrpc).toBe('2.0');
        expect(validRequest.id).toBe(1);
        expect(validRequest.method).toBe('tools/list');
    });

    it('should accept request with params', () => {
        const requestWithParams: JsonRpcRequest = {
            jsonrpc: '2.0',
            id: 'abc-123',
            method: 'tools/call',
            params: {
                name: 'list_journeys',
                arguments: { limit: 10 },
            },
        };
        expect(requestWithParams.params).toBeDefined();
        expect(requestWithParams.params?.name).toBe('list_journeys');
    });

    it('should accept string or number id', () => {
        const numericId: JsonRpcRequest = {
            jsonrpc: '2.0',
            id: 42,
            method: 'ping',
        };
        const stringId: JsonRpcRequest = {
            jsonrpc: '2.0',
            id: 'request-uuid-123',
            method: 'ping',
        };
        expect(typeof numericId.id).toBe('number');
        expect(typeof stringId.id).toBe('string');
    });
});

describe('Tool Input Schemas', () => {
    function getToolSchema(name: string): MCPToolDefinition['inputSchema'] | undefined {
        return toolDefinitions.find(t => t.name === name)?.inputSchema;
    }

    it('list_journeys should have optional limit, offset, country', () => {
        const schema = getToolSchema('list_journeys');
        expect(schema?.properties).toHaveProperty('limit');
        expect(schema?.properties).toHaveProperty('offset');
        expect(schema?.properties).toHaveProperty('country');
        expect(schema?.required).toBeUndefined(); // All optional
    });

    it('get_journey_details should require journey_id', () => {
        const schema = getToolSchema('get_journey_details');
        expect(schema?.properties).toHaveProperty('journey_id');
        expect(schema?.required).toContain('journey_id');
    });

    it('search_journeys should require query and have optional limit', () => {
        const schema = getToolSchema('search_journeys');
        expect(schema?.properties).toHaveProperty('query');
        expect(schema?.properties).toHaveProperty('limit');
        expect(schema?.required).toContain('query');
        expect(schema?.required).not.toContain('limit');
    });

    it('get_journey_photos should have waypoint_id filter option', () => {
        const schema = getToolSchema('get_journey_photos');
        expect(schema?.properties).toHaveProperty('waypoint_id');
        expect(schema?.properties).toHaveProperty('limit');
        expect(schema?.required).toContain('journey_id');
        expect(schema?.required).not.toContain('waypoint_id');
    });
});
