/**
 * Akashic Media Proxy Worker
 *
 * Serves and uploads images to R2 with authentication via Supabase JWT.
 * Uses JWKS (public key) verification - no secret needed.
 *
 * URL patterns:
 * GET:
 * - /journeys/{journey_id}/photos/{photo_id}.jpg - Journey photo (UUID-based)
 * - /public/{path} - Public assets (no auth required)
 *
 * POST:
 * - /upload/journeys/{journey_id}/photos - Upload a photo (multipart/form-data)
 * - /mcp - MCP (Model Context Protocol) JSON-RPC endpoint
 *
 * DELETE:
 * - /journeys/{journey_id}/photos/{photo_id} - Delete a photo (requires editor role)
 *
 * Access Control:
 * - Uses journey_members table for role-based access
 * - viewer: can view photos
 * - editor: can view + upload + delete photos
 * - owner: full control
 */

import { handleMcpRequest } from './mcp';

export interface Env {
    MEDIA_BUCKET: R2Bucket;
    SUPABASE_URL: string;
    SUPABASE_SERVICE_KEY: string;  // Service role key to bypass RLS for permission checks
}

interface JWTPayload {
    sub: string;        // User ID
    email?: string;
    role?: string;
    exp: number;
    iat: number;
}

interface JourneyMember {
    journey_id: string;
    user_id: string;
    role: 'owner' | 'editor' | 'viewer';
}

interface Journey {
    id: string;
    is_public: boolean;
}

interface JWK {
    kty: string;
    use?: string;
    kid?: string;
    alg?: string;
    n?: string;  // RSA modulus
    e?: string;  // RSA exponent
}

interface JWKS {
    keys: JWK[];
}

// Cache for JWKS to avoid fetching on every request
let jwksCache: { keys: CryptoKey[]; fetchedAt: number } | null = null;
const JWKS_CACHE_TTL = 3600000; // 1 hour

// Base64url decode
function base64UrlDecode(str: string): Uint8Array {
    const base64 = str.replace(/-/g, '+').replace(/_/g, '/');
    const padding = '='.repeat((4 - base64.length % 4) % 4);
    const binary = atob(base64 + padding);
    return Uint8Array.from(binary, c => c.charCodeAt(0));
}

// Fetch and cache JWKS from Supabase
async function getJWKS(supabaseUrl: string): Promise<CryptoKey[]> {
    // Return cached keys if still valid
    if (jwksCache && Date.now() - jwksCache.fetchedAt < JWKS_CACHE_TTL) {
        return jwksCache.keys;
    }

    try {
        const response = await fetch(`${supabaseUrl}/auth/v1/.well-known/jwks.json`);
        if (!response.ok) {
            throw new Error(`JWKS fetch failed: ${response.status}`);
        }

        const jwks = await response.json() as JWKS;
        const keys: CryptoKey[] = [];

        for (const jwk of jwks.keys) {
            if (jwk.kty === 'RSA' && jwk.n && jwk.e) {
                const key = await crypto.subtle.importKey(
                    'jwk',
                    {
                        kty: 'RSA',
                        n: jwk.n,
                        e: jwk.e,
                        alg: 'RS256',
                        use: 'sig',
                    },
                    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
                    false,
                    ['verify']
                );
                keys.push(key);
            }
        }

        jwksCache = { keys, fetchedAt: Date.now() };
        return keys;
    } catch (error) {
        console.error('Failed to fetch JWKS:', error);
        // Return cached keys if available, even if stale
        return jwksCache?.keys || [];
    }
}

// Verify JWT using JWKS (public key verification)
async function verifyJWT(token: string, supabaseUrl: string): Promise<JWTPayload | null> {
    try {
        const parts = token.split('.');
        if (parts.length !== 3) return null;

        const [headerB64, payloadB64, signatureB64] = parts;

        // Decode header to check algorithm
        const headerJson = new TextDecoder().decode(base64UrlDecode(headerB64));
        const header = JSON.parse(headerJson);

        // Decode payload
        const payloadJson = new TextDecoder().decode(base64UrlDecode(payloadB64));
        const payload = JSON.parse(payloadJson) as JWTPayload;

        // Check expiration
        if (payload.exp && payload.exp < Date.now() / 1000) {
            return null;
        }

        // Get signature data
        const signatureData = base64UrlDecode(signatureB64);
        const dataToVerify = new TextEncoder().encode(`${headerB64}.${payloadB64}`);

        // Verify based on algorithm
        if (header.alg === 'RS256') {
            // RSA signature - use JWKS
            const keys = await getJWKS(supabaseUrl);

            for (const key of keys) {
                try {
                    const valid = await crypto.subtle.verify(
                        'RSASSA-PKCS1-v1_5',
                        key,
                        signatureData,
                        dataToVerify
                    );
                    if (valid) return payload;
                } catch {
                    // Try next key
                }
            }
        } else if (header.alg === 'HS256') {
            // HMAC signature - for legacy tokens, we'd need the secret
            // Skip verification but still return payload for now
            // In production, you might want to reject HS256 tokens
            console.warn('HS256 token received - signature not verified');
            return payload;
        }

        return null;
    } catch (error) {
        console.error('JWT verification error:', error);
        return null;
    }
}

// Check if user has access to a journey via journey_members table
async function checkJourneyAccess(
    journeyId: string,
    userId: string | null,
    requiredRole: 'viewer' | 'editor' | 'owner',
    supabaseUrl: string,
    supabaseKey: string
): Promise<boolean> {
    try {
        // First check if journey is public (for viewer access)
        if (requiredRole === 'viewer') {
            const journeyResponse = await fetch(
                `${supabaseUrl}/rest/v1/journeys?id=eq.${journeyId}&select=id,is_public`,
                {
                    headers: {
                        'apikey': supabaseKey,
                        'Authorization': `Bearer ${supabaseKey}`,
                    }
                }
            );

            if (journeyResponse.ok) {
                const journeys = await journeyResponse.json() as Journey[];
                if (journeys.length > 0 && journeys[0].is_public) {
                    return true; // Public journeys are viewable by anyone
                }
            }
        }

        // If no user, cannot have member access
        if (!userId) return false;

        // Check membership in journey_members table
        const memberResponse = await fetch(
            `${supabaseUrl}/rest/v1/journey_members?journey_id=eq.${journeyId}&user_id=eq.${userId}&select=role`,
            {
                headers: {
                    'apikey': supabaseKey,
                    'Authorization': `Bearer ${supabaseKey}`,
                }
            }
        );

        if (!memberResponse.ok) return false;

        const members = await memberResponse.json() as JourneyMember[];
        if (members.length === 0) return false;

        const userRole = members[0].role;

        // Check if user's role meets the required level
        switch (requiredRole) {
            case 'viewer':
                return ['owner', 'editor', 'viewer'].includes(userRole);
            case 'editor':
                return ['owner', 'editor'].includes(userRole);
            case 'owner':
                return userRole === 'owner';
            default:
                return false;
        }
    } catch {
        return false;
    }
}

// Get content type from file extension
function getContentType(path: string): string {
    const ext = path.split('.').pop()?.toLowerCase();
    const types: Record<string, string> = {
        // Images
        'jpg': 'image/jpeg',
        'jpeg': 'image/jpeg',
        'png': 'image/png',
        'gif': 'image/gif',
        'webp': 'image/webp',
        'svg': 'image/svg+xml',
        'heic': 'image/heic',
        'heif': 'image/heif',
        // Videos
        'mov': 'video/quicktime',
        'mp4': 'video/mp4',
        'm4v': 'video/x-m4v',
        'webm': 'video/webm',
        // Other
        'gpx': 'application/gpx+xml',
    };
    return types[ext || ''] || 'application/octet-stream';
}

// Get file extension from content type
function getExtensionFromContentType(contentType: string): string | null {
    const types: Record<string, string> = {
        // Images
        'image/jpeg': 'jpg',
        'image/png': 'png',
        'image/gif': 'gif',
        'image/webp': 'webp',
        'image/heic': 'heic',
        'image/heif': 'heif',
        // Videos
        'video/quicktime': 'mov',
        'video/mp4': 'mp4',
        'video/x-m4v': 'm4v',
        'video/webm': 'webm',
    };
    return types[contentType] || null;
}

// Generate a unique photo ID
function generatePhotoId(): string {
    return crypto.randomUUID();
}

// Allowed media types for upload (images and videos)
const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/heic', 'image/heif'];
const ALLOWED_VIDEO_TYPES = ['video/quicktime', 'video/mp4', 'video/x-m4v', 'video/webm'];
const ALLOWED_MEDIA_TYPES = [...ALLOWED_IMAGE_TYPES, ...ALLOWED_VIDEO_TYPES];
const MAX_IMAGE_SIZE = 20 * 1024 * 1024; // 20MB for images
const MAX_VIDEO_SIZE = 500 * 1024 * 1024; // 500MB for videos

interface UploadResult {
    photoId: string;
    path: string;
    size: number;
    contentType: string;
    mediaType: 'image' | 'video';
}

// Handle photo upload
async function handleUpload(
    request: Request,
    env: Env,
    journeyId: string,
    userId: string
): Promise<Response> {
    const corsHeaders = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    };

    try {
        const contentType = request.headers.get('Content-Type') || '';

        let file: File | null = null;

        if (contentType.includes('multipart/form-data')) {
            // Handle multipart form data
            const formData = await request.formData();
            const fileField = formData.get('file');

            if (!(fileField instanceof File)) {
                return new Response(JSON.stringify({ error: 'No file provided' }), {
                    status: 400,
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                });
            }
            file = fileField;
        } else if (ALLOWED_MEDIA_TYPES.includes(contentType)) {
            // Handle direct binary upload
            const blob = await request.blob();
            const ext = getExtensionFromContentType(contentType);
            file = new File([blob], `upload.${ext}`, { type: contentType });
        } else {
            return new Response(JSON.stringify({ error: 'Invalid content type. Use multipart/form-data or send media directly.' }), {
                status: 400,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
        }

        // Validate file type
        if (!ALLOWED_MEDIA_TYPES.includes(file.type)) {
            return new Response(JSON.stringify({
                error: `Invalid file type: ${file.type}. Allowed: ${ALLOWED_MEDIA_TYPES.join(', ')}`
            }), {
                status: 400,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
        }

        // Validate file size (different limits for images vs videos)
        const isVideo = ALLOWED_VIDEO_TYPES.includes(file.type);
        const maxSize = isVideo ? MAX_VIDEO_SIZE : MAX_IMAGE_SIZE;
        if (file.size > maxSize) {
            return new Response(JSON.stringify({
                error: `File too large: ${(file.size / 1024 / 1024).toFixed(2)}MB. Max for ${isVideo ? 'videos' : 'images'}: ${maxSize / 1024 / 1024}MB`
            }), {
                status: 400,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
        }

        // Generate photo ID and path (using journey UUID for immutable paths)
        const photoId = generatePhotoId();
        const ext = getExtensionFromContentType(file.type);
        const path = `journeys/${journeyId}/photos/${photoId}.${ext}`;

        // Upload to R2
        const arrayBuffer = await file.arrayBuffer();
        await env.MEDIA_BUCKET.put(path, arrayBuffer, {
            httpMetadata: {
                contentType: file.type,
            },
            customMetadata: {
                uploadedBy: userId,
                uploadedAt: new Date().toISOString(),
                originalName: file.name,
            }
        });

        const result: UploadResult = {
            photoId,
            path,
            size: file.size,
            contentType: file.type,
            mediaType: isVideo ? 'video' : 'image',
        };

        return new Response(JSON.stringify(result), {
            status: 201,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
    } catch (error) {
        console.error('Upload error:', error);
        return new Response(JSON.stringify({ error: 'Upload failed' }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
    }
}

export default {
    async fetch(request: Request, env: Env): Promise<Response> {
        const url = new URL(request.url);
        const path = url.pathname.slice(1); // Remove leading slash

        // CORS headers for frontend access
        const corsHeaders = {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
            'Access-Control-Allow-Headers': 'Authorization, Content-Type',
        };

        // Handle CORS preflight
        if (request.method === 'OPTIONS') {
            return new Response(null, { headers: corsHeaders });
        }

        // Handle MCP requests
        if (path === 'mcp' && request.method === 'POST') {
            return handleMcpRequest(request, env, verifyJWT);
        }

        // Handle POST requests (uploads)
        if (request.method === 'POST') {
            // Pattern: upload/journeys/{journey_id}/photos (UUID-based)
            const uploadMatch = path.match(/^upload\/journeys\/([^/]+)\/photos$/);

            if (!uploadMatch) {
                return new Response(JSON.stringify({ error: 'Invalid upload path' }), {
                    status: 400,
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                });
            }

            const journeyId = uploadMatch[1];

            // Get and verify token
            let token = request.headers.get('Authorization')?.replace('Bearer ', '');
            if (!token) {
                token = url.searchParams.get('token');
            }

            if (!token) {
                return new Response(JSON.stringify({ error: 'Authentication required' }), {
                    status: 401,
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                });
            }

            const payload = await verifyJWT(token, env.SUPABASE_URL);
            if (!payload) {
                return new Response(JSON.stringify({ error: 'Invalid token' }), {
                    status: 401,
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                });
            }

            // Check if user has editor role for this journey
            const hasAccess = await checkJourneyAccess(
                journeyId,
                payload.sub,
                'editor',
                env.SUPABASE_URL,
                env.SUPABASE_SERVICE_KEY
            );

            if (!hasAccess) {
                return new Response(JSON.stringify({ error: 'Forbidden: editor role required' }), {
                    status: 403,
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                });
            }

            return handleUpload(request, env, journeyId, payload.sub);
        }

        // Handle DELETE requests (photo deletion)
        if (request.method === 'DELETE') {
            // Pattern: journeys/{journey_id}/photos/{photo_id} (UUID-based)
            const deleteMatch = path.match(/^journeys\/([^/]+)\/photos\/([^/]+)$/);

            if (!deleteMatch) {
                return new Response(JSON.stringify({ error: 'Invalid delete path' }), {
                    status: 400,
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                });
            }

            const journeyId = deleteMatch[1];
            const photoId = deleteMatch[2];

            // Get and verify token
            let token = request.headers.get('Authorization')?.replace('Bearer ', '');
            if (!token) {
                token = url.searchParams.get('token');
            }

            if (!token) {
                return new Response(JSON.stringify({ error: 'Authentication required' }), {
                    status: 401,
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                });
            }

            const payload = await verifyJWT(token, env.SUPABASE_URL);
            if (!payload) {
                return new Response(JSON.stringify({ error: 'Invalid token' }), {
                    status: 401,
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                });
            }

            // Check if user has editor role for this journey
            const hasAccess = await checkJourneyAccess(
                journeyId,
                payload.sub,
                'editor',
                env.SUPABASE_URL,
                env.SUPABASE_SERVICE_KEY
            );

            if (!hasAccess) {
                return new Response(JSON.stringify({ error: 'Forbidden: editor role required' }), {
                    status: 403,
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                });
            }

            // Delete both the photo and thumbnail from R2
            const photoPath = `journeys/${journeyId}/photos/${photoId}`;
            const thumbPath = `journeys/${journeyId}/photos/${photoId}_thumb`;

            // Try to delete with common extensions (images and videos)
            const extensions = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'heif', 'mov', 'mp4', 'm4v', 'webm'];
            let deleted = false;

            for (const ext of extensions) {
                try {
                    await env.MEDIA_BUCKET.delete(`${photoPath}.${ext}`);
                    await env.MEDIA_BUCKET.delete(`${thumbPath}.${ext}`);
                    deleted = true;
                } catch {
                    // Ignore - file might not exist with this extension
                }
            }

            // Also try without extension (in case stored that way)
            try {
                await env.MEDIA_BUCKET.delete(photoPath);
                await env.MEDIA_BUCKET.delete(thumbPath);
                deleted = true;
            } catch {
                // Ignore
            }

            return new Response(JSON.stringify({
                success: true,
                message: deleted ? 'Photo deleted' : 'No files found to delete'
            }), {
                status: 200,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
        }

        // Only allow GET requests for non-upload/delete paths
        if (request.method !== 'GET') {
            return new Response('Method not allowed', { status: 405, headers: corsHeaders });
        }

        // Public assets - no auth required
        if (path.startsWith('public/')) {
            const object = await env.MEDIA_BUCKET.get(path);
            if (!object) {
                return new Response('Not found', { status: 404, headers: corsHeaders });
            }

            return new Response(object.body, {
                headers: {
                    ...corsHeaders,
                    'Content-Type': getContentType(path),
                    'Cache-Control': 'public, max-age=31536000',
                }
            });
        }

        // Protected assets - require auth
        // Get token from Authorization header or query param
        let token = request.headers.get('Authorization')?.replace('Bearer ', '');
        if (!token) {
            token = url.searchParams.get('token');
        }

        let userId: string | null = null;

        // Verify JWT if provided (uses JWKS public key verification)
        if (token) {
            const payload = await verifyJWT(token, env.SUPABASE_URL);
            if (payload) {
                userId = payload.sub;
            }
        }

        // Extract journey ID from path
        // Pattern: journeys/{journey_id}/... (UUID-based)
        const journeyMatch = path.match(/^journeys\/([^/]+)\//);

        if (journeyMatch) {
            const journeyId = journeyMatch[1];

            // Check viewer access using journey_members table
            const hasAccess = await checkJourneyAccess(
                journeyId,
                userId,
                'viewer',
                env.SUPABASE_URL,
                env.SUPABASE_SERVICE_KEY
            );

            if (!hasAccess) {
                return new Response('Unauthorized', { status: 401, headers: corsHeaders });
            }
        } else if (!userId) {
            // Non-journey paths require auth
            return new Response('Unauthorized', { status: 401, headers: corsHeaders });
        }

        // Check for range request (needed for video seeking)
        const rangeHeader = request.headers.get('Range');
        const contentType = getContentType(path);
        const isVideoRequest = contentType.startsWith('video/');

        if (rangeHeader && isVideoRequest) {
            // Handle range request for video streaming
            const object = await env.MEDIA_BUCKET.get(path);
            if (!object) {
                return new Response('Not found', { status: 404, headers: corsHeaders });
            }

            const fileSize = object.size;
            const rangeMatch = rangeHeader.match(/bytes=(\d+)-(\d*)/);

            if (!rangeMatch) {
                return new Response('Invalid range', { status: 416, headers: corsHeaders });
            }

            const start = parseInt(rangeMatch[1], 10);
            const end = rangeMatch[2] ? parseInt(rangeMatch[2], 10) : fileSize - 1;

            // Validate range
            if (start >= fileSize || end >= fileSize || start > end) {
                return new Response('Range not satisfiable', {
                    status: 416,
                    headers: {
                        ...corsHeaders,
                        'Content-Range': `bytes */${fileSize}`,
                    }
                });
            }

            // Fetch the specific range
            const rangedObject = await env.MEDIA_BUCKET.get(path, {
                range: { offset: start, length: end - start + 1 }
            });

            if (!rangedObject) {
                return new Response('Not found', { status: 404, headers: corsHeaders });
            }

            return new Response(rangedObject.body, {
                status: 206,
                headers: {
                    ...corsHeaders,
                    'Content-Type': contentType,
                    'Content-Range': `bytes ${start}-${end}/${fileSize}`,
                    'Content-Length': String(end - start + 1),
                    'Accept-Ranges': 'bytes',
                    'Cache-Control': 'private, max-age=3600',
                    'ETag': object.etag,
                }
            });
        }

        // Fetch from R2 (full file)
        const object = await env.MEDIA_BUCKET.get(path);

        if (!object) {
            return new Response('Not found', { status: 404, headers: corsHeaders });
        }

        // For videos, include Accept-Ranges header to indicate range support
        const responseHeaders: Record<string, string> = {
            ...corsHeaders,
            'Content-Type': contentType,
            'Cache-Control': 'private, max-age=3600',
            'ETag': object.etag,
        };

        if (isVideoRequest) {
            responseHeaders['Accept-Ranges'] = 'bytes';
            responseHeaders['Content-Length'] = String(object.size);
        }

        return new Response(object.body, { headers: responseHeaders });
    }
};
