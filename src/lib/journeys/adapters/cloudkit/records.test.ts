import { describe, it, expect } from 'vitest';
import {
    toLngLat,
    assetUrl,
    parseJsonField,
    referenceName,
    recordToDbJourney,
    recordToDbWaypoint,
    recordToPhoto,
    recordToDayComment,
    participantToMember,
    type CKRecordLike,
} from './records';

describe('cloudkit record mappers', () => {
    describe('toLngLat (both coordinate encodings)', () => {
        it('unwraps a CloudKit LOCATION object to [lng, lat]', () => {
            expect(toLngLat({ latitude: -3.0674, longitude: 37.3556 })).toEqual([37.3556, -3.0674]);
        });

        it('accepts a plain [lng, lat] array', () => {
            expect(toLngLat([37.3556, -3.0674])).toEqual([37.3556, -3.0674]);
        });

        it('accepts a [lng, lat, ele] array (drops elevation)', () => {
            expect(toLngLat([10, 20, 500])).toEqual([10, 20]);
        });

        it('unwraps a GeoJSON-style { coordinates } object', () => {
            expect(toLngLat({ coordinates: [1, 2] })).toEqual([1, 2]);
        });

        it('returns null for missing / malformed values', () => {
            expect(toLngLat(null)).toBeNull();
            expect(toLngLat(undefined)).toBeNull();
            expect(toLngLat({ foo: 'bar' })).toBeNull();
            expect(toLngLat(['a', 'b'])).toBeNull();
        });
    });

    describe('assetUrl (CKAsset -> full https URL passthrough)', () => {
        it('extracts downloadURL from a CKAsset field', () => {
            const url = 'https://cvws.icloud-content.com/B/abc/photo.jpg?o=token';
            expect(assetUrl({ downloadURL: url, fileChecksum: 'x', size: 123 })).toBe(url);
        });

        it('passes through a bare https string', () => {
            expect(assetUrl('https://example.com/x.jpg')).toBe('https://example.com/x.jpg');
        });

        it('returns null for non-asset / relative values', () => {
            expect(assetUrl('journeys/1/x.jpg')).toBeNull();
            expect(assetUrl(null)).toBeNull();
            expect(assetUrl({})).toBeNull();
        });
    });

    describe('parseJsonField (route/stats string-or-asset)', () => {
        it('parses an inline JSON string', () => {
            const route = { type: 'LineString', coordinates: [[1, 2, 3]] };
            expect(parseJsonField(JSON.stringify(route))).toEqual(route);
        });

        it('returns null for an invalid JSON string', () => {
            expect(parseJsonField('{not json')).toBeNull();
        });

        it('passes through an already-structured object', () => {
            const stats = { duration: 5 };
            expect(parseJsonField(stats)).toEqual(stats);
        });

        it('returns null (TODO) for an asset-backed field', () => {
            expect(parseJsonField({ downloadURL: 'https://x/y.json', fileChecksum: 'z' })).toBeNull();
        });

        it('returns null for nullish input', () => {
            expect(parseJsonField(null)).toBeNull();
            expect(parseJsonField(undefined)).toBeNull();
        });
    });

    describe('referenceName', () => {
        it('reads a CKReference recordName', () => {
            expect(referenceName({ recordName: 'journey-1', action: 'NONE' })).toBe('journey-1');
        });
        it('accepts a bare string', () => {
            expect(referenceName('journey-2')).toBe('journey-2');
        });
        it('returns null otherwise', () => {
            expect(referenceName(42)).toBeNull();
        });
    });

    describe('recordToDbJourney', () => {
        it('maps a full Journey record (route JSON parse + LOCATION center)', () => {
            const record: CKRecordLike = {
                recordName: 'uuid-123',
                recordType: 'Journey',
                fields: {
                    slug: { value: 'kilimanjaro' },
                    name: { value: 'Kilimanjaro - Lemosho Route' },
                    description: { value: 'A trek' },
                    country: { value: 'Tanzania' },
                    summitElevation: { value: 5895 },
                    totalDistance: { value: 70 },
                    totalDays: { value: 8 },
                    dateStarted: { value: '2024-10-01' },
                    dateEnded: { value: '2024-10-08' },
                    centerLocation: { value: { latitude: -3.0674, longitude: 37.3556 } },
                    routeJSON: { value: JSON.stringify({ type: 'LineString', coordinates: [[37, -3, 1800]] }) },
                    statsJSON: { value: JSON.stringify({ duration: 8, totalDistance: 70, totalElevationGain: 4000, highestPoint: { name: 'Uhuru', elevation: 5895 } }) },
                    preferredBearing: { value: 45 },
                    preferredPitch: { value: 70 },
                    isPublic: { value: 1 },
                },
            };

            const j = recordToDbJourney(record);

            expect(j.id).toBe('uuid-123');
            expect(j.slug).toBe('kilimanjaro');
            expect(j.name).toBe('Kilimanjaro - Lemosho Route');
            expect(j.country).toBe('Tanzania');
            expect(j.summit_elevation).toBe(5895);
            expect(j.center_coordinates).toEqual([37.3556, -3.0674]);
            expect(j.route).toEqual({ type: 'LineString', coordinates: [[37, -3, 1800]] });
            expect(j.stats?.highestPoint.elevation).toBe(5895);
            expect(j.preferred_bearing).toBe(45);
            expect(j.is_public).toBe(true);
        });

        it('supports the [lng, lat] array encoding for center + null defaults', () => {
            // Legacy `centerCoordinates` name exercises the defensive fallback;
            // the schema name is `centerLocation` (tested above).
            const record: CKRecordLike = {
                recordName: 'uuid-456',
                fields: {
                    slug: { value: 'test' },
                    name: { value: 'Test' },
                    centerCoordinates: { value: [86.925, 27.9881] },
                    isPublic: { value: 0 },
                },
            };

            const j = recordToDbJourney(record);

            expect(j.center_coordinates).toEqual([86.925, 27.9881]);
            expect(j.description).toBeNull();
            expect(j.summit_elevation).toBeNull();
            expect(j.route).toBeNull();
            expect(j.stats).toBeNull();
            expect(j.is_public).toBe(false);
        });
    });

    describe('recordToDbWaypoint', () => {
        it('maps a Waypoint record (reference journey id + LOCATION coords + JSON)', () => {
            const record: CKRecordLike = {
                recordName: 'wp-1',
                recordType: 'Waypoint',
                fields: {
                    journeyRef: { value: { recordName: 'uuid-123', action: 'DELETE_SELF' } },
                    name: { value: 'Base Camp' },
                    waypointType: { value: 'camp' },
                    dayNumber: { value: 1 },
                    coordinates: { value: { latitude: -3.0, longitude: 37.0 } },
                    elevation: { value: 1800 },
                    description: { value: 'Start' },
                    highlights: { value: ['Registration', 'Briefing'] },
                    sortOrder: { value: 0 },
                    routeDistanceKm: { value: 0 },
                    routePointIndex: { value: 0 },
                    weatherJSON: { value: JSON.stringify({ temperature_max: 20, temperature_min: 10, precipitation_sum: 0, wind_speed_max: 5, weather_code: 1, fetched_at: '2024-10-01' }) },
                    funFactsJSON: { value: JSON.stringify([{ id: 'f1', content: 'Fact', category: 'geology' }]) },
                },
            };

            const w = recordToDbWaypoint(record);

            expect(w.id).toBe('wp-1');
            expect(w.journey_id).toBe('uuid-123');
            expect(w.name).toBe('Base Camp');
            expect(w.waypoint_type).toBe('camp');
            expect(w.coordinates).toEqual([37.0, -3.0]);
            expect(w.highlights).toEqual(['Registration', 'Briefing']);
            expect(w.weather?.temperature_max).toBe(20);
            expect(w.fun_facts?.[0].content).toBe('Fact');
            expect(w.points_of_interest).toBeNull();
        });

        it('defaults waypoint_type to camp and coordinates to [0,0]', () => {
            const w = recordToDbWaypoint({ recordName: 'wp-2', fields: { name: { value: 'Camp' } } });
            expect(w.waypoint_type).toBe('camp');
            expect(w.coordinates).toEqual([0, 0]);
            expect(w.journey_id).toBe('');
        });
    });

    describe('recordToPhoto', () => {
        it('maps a Photo record with full asset URLs and unwrapped coordinates', () => {
            const imageUrl = 'https://cvws.icloud-content.com/B/img/photo.jpg?o=t1';
            const thumbUrl = 'https://cvws.icloud-content.com/B/thumb/photo.jpg?o=t2';
            const record: CKRecordLike = {
                recordName: 'photo-1',
                fields: {
                    journeyRef: { value: { recordName: 'journey-1' } },
                    waypointRef: { value: { recordName: 'wp-1' } },
                    original: { value: { downloadURL: imageUrl, fileChecksum: 'a', size: 1 } },
                    thumb: { value: { downloadURL: thumbUrl, fileChecksum: 'b', size: 1 } },
                    caption: { value: 'Summit!' },
                    coordinates: { value: { latitude: -3.07, longitude: 37.35 } },
                    takenAt: { value: '2024-10-08T06:00:00Z' },
                    isHero: { value: 1 },
                },
            };

            const p = recordToPhoto(record);

            expect(p.id).toBe('photo-1');
            expect(p.journey_id).toBe('journey-1');
            expect(p.waypoint_id).toBe('wp-1');
            expect(p.url).toBe(imageUrl);
            expect(p.thumbnail_url).toBe(thumbUrl);
            expect(p.caption).toBe('Summit!');
            expect(p.coordinates).toEqual([37.35, -3.07]);
            expect(p.is_hero).toBe(true);
        });

        it('falls back to a url string field when no asset is present', () => {
            const p = recordToPhoto({
                recordName: 'photo-2',
                fields: { journeyId: { value: 'journey-2' }, url: { value: 'https://x/y.jpg' } },
            });
            expect(p.url).toBe('https://x/y.jpg');
            expect(p.journey_id).toBe('journey-2');
            expect(p.coordinates).toBeNull();
        });

        it('accepts legacy image/thumbnail asset field names as fallbacks', () => {
            const p = recordToPhoto({
                recordName: 'photo-3',
                fields: {
                    journeyRef: { value: { recordName: 'journey-1' } },
                    image: { value: { downloadURL: 'https://cvws.icloud/legacy.jpg' } },
                    thumbnail: { value: { downloadURL: 'https://cvws.icloud/legacy_thumb.jpg' } },
                },
            });
            expect(p.url).toBe('https://cvws.icloud/legacy.jpg');
            expect(p.thumbnail_url).toBe('https://cvws.icloud/legacy_thumb.jpg');
        });
    });

    describe('recordToDayComment (author fallback)', () => {
        const commentRecord: CKRecordLike = {
            recordName: 'comment-1',
            fields: {
                waypointRef: { value: { recordName: 'wp-1' } },
                journeyRef: { value: { recordName: 'journey-1' } },
                userRef: { value: { recordName: 'user-42' } },
                content: { value: 'Great day!' },
                createdAt: { value: '2024-10-08T10:00:00Z' },
                modifiedAt: { value: '2024-10-08T10:00:00Z' },
            },
        };

        it('stitches the author from the identity map when present', () => {
            const authors = new Map([
                ['user-42', { id: 'user-42', display_name: 'Chris', avatar_url: 'https://a/v.png' }],
            ]);
            const c = recordToDayComment(commentRecord, authors);
            expect(c.id).toBe('comment-1');
            expect(c.user_id).toBe('user-42');
            expect(c.content).toBe('Great day!');
            expect(c.author).toEqual({ id: 'user-42', display_name: 'Chris', avatar_url: 'https://a/v.png' });
        });

        it('falls back to a placeholder author keyed by user_id', () => {
            const c = recordToDayComment(commentRecord);
            expect(c.author).toEqual({ id: 'user-42', display_name: null, avatar_url: null });
        });

        it('derives user_id from the record creator when no userRef field', () => {
            const c = recordToDayComment({
                recordName: 'comment-2',
                fields: { content: { value: 'hi' } },
                created: { userRecordName: 'creator-9', timestamp: 1700000000000 },
            });
            expect(c.user_id).toBe('creator-9');
            expect(c.author.id).toBe('creator-9');
            expect(c.created_at).toBe(new Date(1700000000000).toISOString());
        });

        it('prefers authorDisplayName (migrated records) over participant identity', () => {
            const authors = new Map([
                ['owner-1', { id: 'owner-1', display_name: 'Owner', avatar_url: 'https://a/o.png' }],
            ]);
            const c = recordToDayComment(
                {
                    recordName: 'comment-3',
                    fields: {
                        content: { value: 'migrated comment' },
                        authorDisplayName: { value: 'Mormor' },
                        modifiedAt: { value: '2025-01-01T00:00:00Z' },
                    },
                    created: { userRecordName: 'owner-1', timestamp: 1700000000000 },
                },
                authors
            );
            expect(c.author.display_name).toBe('Mormor');
            expect(c.author.avatar_url).toBe('https://a/o.png');
            expect(c.updated_at).toBe('2025-01-01T00:00:00Z');
        });
    });

    describe('participantToMember', () => {
        it('maps an owner participant with a synthesized profile', () => {
            const m = participantToMember(
                {
                    userIdentity: {
                        userRecordName: 'user-1',
                        nameComponents: { givenName: 'Ada', familyName: 'Lovelace' },
                        lookupInfo: { emailAddress: 'ada@example.com' },
                    },
                    role: 1,
                    permission: 3,
                },
                'journey-1'
            );

            expect(m.id).toBe('user-1');
            expect(m.journey_id).toBe('journey-1');
            expect(m.user_id).toBe('user-1');
            expect(m.role).toBe('owner');
            expect(m.profile).toEqual({
                id: 'user-1',
                email: 'ada@example.com',
                display_name: 'Ada Lovelace',
                avatar_url: null,
            });
        });

        it('maps read/write permission to editor and read-only to viewer', () => {
            expect(participantToMember({ userIdentity: { userRecordName: 'u2' }, permission: 3 }, 'j').role).toBe('editor');
            expect(participantToMember({ userIdentity: { userRecordName: 'u3' }, permission: 1 }, 'j').role).toBe('viewer');
        });
    });
});
