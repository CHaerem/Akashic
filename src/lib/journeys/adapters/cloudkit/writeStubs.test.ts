import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as ckJourney from './journeyAdapter';
import * as ckPhoto from './photoAdapter';
import * as ckWaypoint from './waypointAdapter';
import * as ckMember from './memberAdapter';
import { CK_UNSUPPORTED } from './journeyAdapter';

/**
 * Every write that isn't a supported "light edit" (caption / comment) must
 * return a safe default and warn with the canonical native-only message,
 * without ever touching CloudKit.
 */
describe('cloudkit adapter — native-only writes return safe defaults', () => {
    let warnSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
        warnSpy.mockRestore();
    });

    it('exposes the canonical native-only message', () => {
        expect(CK_UNSUPPORTED).toBe('[cloudkit] not supported on web — use the iOS app');
    });

    it('journey metadata + route writes return false and warn', async () => {
        expect(await ckJourney.updateJourney('slug', { name: 'x' })).toBe(false);
        expect(await ckJourney.updateJourneyRoute('slug', { type: 'LineString', coordinates: [] })).toBe(false);
        expect(warnSpy).toHaveBeenCalledWith(CK_UNSUPPORTED);
    });

    it('photo create/delete/assign return safe defaults and warn', async () => {
        expect(await ckPhoto.createPhoto({ journey_id: 'j', url: 'u' })).toBeNull();
        expect(await ckPhoto.deletePhoto('p')).toBe(false);
        expect(await ckPhoto.assignPhotoToWaypoint('p', 'w')).toBe(false);
        expect(warnSpy).toHaveBeenCalledWith(CK_UNSUPPORTED);
    });

    it('updatePhoto with a non-caption update is a no-op (null + warn)', async () => {
        expect(await ckPhoto.updatePhoto('p', { is_hero: true })).toBeNull();
        expect(warnSpy).toHaveBeenCalledWith(CK_UNSUPPORTED);
    });

    it('all waypoint writes return safe defaults and warn', async () => {
        expect(await ckWaypoint.updateWaypoint('w', { name: 'x' })).toBe(false);
        expect(await ckWaypoint.updateWaypointPosition('w', [1, 2], 100, 1, 0)).toBe(false);
        expect(await ckWaypoint.createWaypoint({ journey_id: 'j', name: 'n', coordinates: [1, 2] })).toBeNull();
        expect(await ckWaypoint.deleteWaypoint('w')).toBe(false);
        expect(await ckWaypoint.updateWaypointOrder([{ id: 'w', sort_order: 1, day_number: 1 }])).toBe(false);
        expect(warnSpy).toHaveBeenCalledWith(CK_UNSUPPORTED);
    });

    it('member management writes + registered-user list return safe defaults and warn', async () => {
        expect(await ckMember.getRegisteredUsers()).toEqual([]);
        expect(await ckMember.addJourneyMember('j', 'u', 'viewer')).toBeNull();
        expect(await ckMember.removeJourneyMember('j', 'u')).toBe(false);
        expect(await ckMember.updateMemberRole('j', 'u', 'editor')).toBe(false);
        expect(warnSpy).toHaveBeenCalledWith(CK_UNSUPPORTED);
    });
});
