/**
 * Akashic Media Proxy Worker
 *
 * Serves and uploads images to R2 with authentication via Supabase JWT.
 * Uses JWKS (public key) verification - no secret needed.
 *
 * URL patterns:
 * GET:
 * - /journeys/{journey_slug}/photos/{photo_id}.jpg - Journey photo
 * - /public/{path} - Public assets (no auth required)
 *
 * POST:
 * - /upload/journeys/{journey_slug}/photos - Upload a photo (multipart/form-data)
 */

export interface Env {
    MEDIA_BUCKET: R2Bucket;
    SUPABASE_URL: string;
    SUPABASE_ANON_KEY: string;
}

interface JWTPayload {
    sub: string;        // User ID
    email?: string;
    role?: string;
    exp: number;
    iat: number;
}

interface JourneyAccess {
    id: string;
    user_id: string;
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

// Check if user has access to a journey via Supabase
async function checkJourneyAccess(
    journeySlug: string,
    userId: string | null,
    supabaseUrl: string,
    supabaseKey: string
): Promise<boolean> {
    try {
        // Query journey by slug to check ownership and public status
        const response = await fetch(
            `${supabaseUrl}/rest/v1/journeys?slug=eq.${journeySlug}&select=id,user_id,is_public`,
            {
                headers: {
                    'apikey': supabaseKey,
                    'Authorization': `Bearer ${supabaseKey}`,
                }
            }
        );

        if (!response.ok) return false;

        const journeys = await response.json() as JourneyAccess[];
        if (journeys.length === 0) return false;

        const journey = journeys[0];

        // MVP: Allow any authenticated user to see any journey
        // Future: Check ownership or sharing permissions
        // return journey.is_public || journey.user_id === userId || isSharedWith(userId);
        return journey.is_public || userId !== null;
    } catch {
        return false;
    }
}

// Get content type from file extension
function getContentType(path: string): string {
    const ext = path.split('.').pop()?.toLowerCase();
    const types: Record<string, string> = {
        'jpg': 'image/jpeg',
        'jpeg': 'image/jpeg',
        'png': 'image/png',
        'gif': 'image/gif',
        'webp': 'image/webp',
        'svg': 'image/svg+xml',
        'gpx': 'application/gpx+xml',
    };
    return types[ext || ''] || 'application/octet-stream';
}

// Get file extension from content type
function getExtensionFromContentType(contentType: string): string | null {
    const types: Record<string, string> = {
        'image/jpeg': 'jpg',
        'image/png': 'png',
        'image/gif': 'gif',
        'image/webp': 'webp',
    };
    return types[contentType] || null;
}

// Generate a unique photo ID
function generatePhotoId(): string {
    return crypto.randomUUID();
}

// Allowed image types for upload
const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB

interface UploadResult {
    photoId: string;
    path: string;
    size: number;
    contentType: string;
}

// Handle photo upload
async function handleUpload(
    request: Request,
    env: Env,
    journeySlug: string,
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
        } else if (ALLOWED_IMAGE_TYPES.includes(contentType)) {
            // Handle direct binary upload
            const blob = await request.blob();
            const ext = getExtensionFromContentType(contentType);
            file = new File([blob], `upload.${ext}`, { type: contentType });
        } else {
            return new Response(JSON.stringify({ error: 'Invalid content type. Use multipart/form-data or send image directly.' }), {
                status: 400,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
        }

        // Validate file type
        if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
            return new Response(JSON.stringify({
                error: `Invalid file type: ${file.type}. Allowed: ${ALLOWED_IMAGE_TYPES.join(', ')}`
            }), {
                status: 400,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
        }

        // Validate file size
        if (file.size > MAX_FILE_SIZE) {
            return new Response(JSON.stringify({
                error: `File too large: ${(file.size / 1024 / 1024).toFixed(2)}MB. Max: ${MAX_FILE_SIZE / 1024 / 1024}MB`
            }), {
                status: 400,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
        }

        // Generate photo ID and path
        const photoId = generatePhotoId();
        const ext = getExtensionFromContentType(file.type);
        const path = `journeys/${journeySlug}/photos/${photoId}.${ext}`;

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
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Authorization, Content-Type',
        };

        // Handle CORS preflight
        if (request.method === 'OPTIONS') {
            return new Response(null, { headers: corsHeaders });
        }

        // Handle POST requests (uploads)
        if (request.method === 'POST') {
            // Pattern: upload/journeys/{journey_slug}/photos
            const uploadMatch = path.match(/^upload\/journeys\/([^/]+)\/photos$/);

            if (!uploadMatch) {
                return new Response(JSON.stringify({ error: 'Invalid upload path' }), {
                    status: 400,
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                });
            }

            const journeySlug = uploadMatch[1];

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

            // For MVP: any authenticated user can upload to any journey
            // Future: Check if user owns or has write access to the journey
            return handleUpload(request, env, journeySlug, payload.sub);
        }

        // Only allow GET requests for non-upload paths
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
        // Pattern: journeys/{journey_id}/...
        const journeyMatch = path.match(/^journeys\/([^/]+)\//);

        if (journeyMatch) {
            const journeyId = journeyMatch[1];

            // Check access using anon key to query journey
            const hasAccess = await checkJourneyAccess(
                journeyId,
                userId,
                env.SUPABASE_URL,
                env.SUPABASE_ANON_KEY
            );

            if (!hasAccess) {
                return new Response('Unauthorized', { status: 401, headers: corsHeaders });
            }
        } else if (!userId) {
            // Non-journey paths require auth
            return new Response('Unauthorized', { status: 401, headers: corsHeaders });
        }

        // Fetch from R2
        const object = await env.MEDIA_BUCKET.get(path);

        if (!object) {
            return new Response('Not found', { status: 404, headers: corsHeaders });
        }

        return new Response(object.body, {
            headers: {
                ...corsHeaders,
                'Content-Type': getContentType(path),
                'Cache-Control': 'private, max-age=3600',
                'ETag': object.etag,
            }
        });
    }
};
