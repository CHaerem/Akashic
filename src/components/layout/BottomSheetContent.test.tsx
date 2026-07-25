import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { AuthContext, type AuthState } from '../../contexts/AuthContext';
import { BottomSheetContent } from './BottomSheetContent';
import type { TrekConfig, TrekData } from '../../types/trek';

/**
 * qg-web finding #1: the canonical shared link akashic.no/?journey=<slug> jumps
 * straight to view='trek' (useTrekData), skipping the globe overview. The Report
 * affordance must therefore be present on the trek view itself — the page the
 * public actually lands on — not only in the globe JourneyOverview. These tests
 * pin the affordance on that deep-link landing view.
 */

const trek = {
    id: 'kilimanjaro',
    name: 'Kilimanjaro',
    country: 'Tanzania',
    elevation: '5895m',
} as unknown as TrekConfig;

const trekData = {
    description: 'A test trek used to render the trek overview.',
    stats: {
        duration: 7,
        totalDistance: 70,
        totalElevationGain: 4000,
        highestPoint: { elevation: 5895 },
    },
    camps: [],
} as unknown as TrekData;

function renderTrekView(auth: AuthState) {
    return render(
        <AuthContext.Provider value={auth}>
            <BottomSheetContent
                view="trek"
                selectedTrek={trek}
                selectedCamp={null}
                activeMode="day"
                trekData={trekData}
                extendedStats={null}
                elevationProfile={null}
                photos={[]}
                getMediaUrl={(p) => p}
                onExplore={() => {}}
                onCampSelect={() => {}}
                onViewPhotoOnMap={() => {}}
                onOpenDayGallery={() => {}}
            />
        </AuthContext.Provider>
    );
}

describe('BottomSheetContent — Report affordance on the deep-link trek view', () => {
    it('renders the Report content link for a signed-out visitor landing on ?journey=', () => {
        renderTrekView({ signedIn: false, loading: false });

        const link = screen.getByRole('link', { name: /report this content/i });
        const href = link.getAttribute('href') ?? '';
        expect(href.startsWith('mailto:')).toBe(true);
        expect(decodeURIComponent(href)).toContain('Report content: kilimanjaro');
    });

    it('hides the Report link for signed-in family members on the trek view', () => {
        renderTrekView({ signedIn: true, loading: false });

        expect(screen.queryByRole('link', { name: /report this content/i })).toBeNull();
    });
});
