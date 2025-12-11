import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, Mock } from 'vitest';
import { PhotoLightbox } from './PhotoLightbox';
import type { Photo } from '../../types/trek';

// Mock YARL and its plugins
vi.mock('yet-another-react-lightbox', () => ({
    default: vi.fn(({ index, open, slides }: { index: number; open: boolean; slides: { src: string }[] }) => {
        if (!open) return null;
        return (
            <div data-testid="yarl-lightbox" data-index={index}>
                <img src={slides[index]?.src} alt="Current photo" data-testid="current-photo" />
            </div>
        );
    })
}));

vi.mock('yet-another-react-lightbox/plugins/zoom', () => ({
    default: {}
}));

vi.mock('yet-another-react-lightbox/plugins/counter', () => ({
    default: {}
}));

vi.mock('yet-another-react-lightbox/plugins/video', () => ({
    default: {}
}));

vi.mock('yet-another-react-lightbox/styles.css', () => ({}));
vi.mock('yet-another-react-lightbox/plugins/counter.css', () => ({}));

const mockPhotos: Photo[] = [
    {
        id: 'photo-1',
        journey_id: 'journey-1',
        url: 'photos/photo1.jpg',
        caption: 'Photo 1',
        coordinates: [1, 1],
        taken_at: '2024-01-01T10:00:00Z',
        sort_order: 0
    },
    {
        id: 'photo-2',
        journey_id: 'journey-1',
        url: 'photos/photo2.jpg',
        caption: 'Photo 2',
        coordinates: [2, 2],
        taken_at: '2024-01-01T11:00:00Z',
        sort_order: 1
    },
    {
        id: 'photo-3',
        journey_id: 'journey-1',
        url: 'photos/photo3.jpg',
        caption: 'Photo 3',
        coordinates: [3, 3],
        taken_at: '2024-01-01T12:00:00Z',
        sort_order: 2
    }
];

const mockGetMediaUrl = (path: string) => `https://media.example.com/${path}`;

describe('PhotoLightbox', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('renders nothing when closed', () => {
        render(
            <PhotoLightbox
                photos={mockPhotos}
                initialIndex={0}
                isOpen={false}
                onClose={() => {}}
                getMediaUrl={mockGetMediaUrl}
            />
        );
        expect(screen.queryByTestId('yarl-lightbox')).not.toBeInTheDocument();
    });

    it('renders lightbox when open', () => {
        render(
            <PhotoLightbox
                photos={mockPhotos}
                initialIndex={0}
                isOpen={true}
                onClose={() => {}}
                getMediaUrl={mockGetMediaUrl}
            />
        );
        expect(screen.getByTestId('yarl-lightbox')).toBeInTheDocument();
    });

    it('opens with correct initial index', () => {
        render(
            <PhotoLightbox
                photos={mockPhotos}
                initialIndex={1}
                isOpen={true}
                onClose={() => {}}
                getMediaUrl={mockGetMediaUrl}
            />
        );
        const lightbox = screen.getByTestId('yarl-lightbox');
        expect(lightbox).toHaveAttribute('data-index', '1');
    });

    it('syncs index when reopened with different initialIndex (via key prop remount)', async () => {
        // In production, AkashicApp uses a key prop to force remount when opening
        // with a different index. This test simulates that behavior.
        const { rerender } = render(
            <PhotoLightbox
                key="lightbox-0"
                photos={mockPhotos}
                initialIndex={0}
                isOpen={true}
                onClose={() => {}}
                getMediaUrl={mockGetMediaUrl}
            />
        );

        // Verify initial state
        expect(screen.getByTestId('yarl-lightbox')).toHaveAttribute('data-index', '0');

        // Close the lightbox
        rerender(
            <PhotoLightbox
                key="lightbox-closed"
                photos={mockPhotos}
                initialIndex={0}
                isOpen={false}
                onClose={() => {}}
                getMediaUrl={mockGetMediaUrl}
            />
        );

        expect(screen.queryByTestId('yarl-lightbox')).not.toBeInTheDocument();

        // Reopen with different index AND different key (forces remount)
        rerender(
            <PhotoLightbox
                key="lightbox-2"
                photos={mockPhotos}
                initialIndex={2}
                isOpen={true}
                onClose={() => {}}
                getMediaUrl={mockGetMediaUrl}
            />
        );

        // Should show index 2 because component was remounted with new key
        await waitFor(() => {
            expect(screen.getByTestId('yarl-lightbox')).toHaveAttribute('data-index', '2');
        });
    });

    it('does NOT update index when initialIndex changes while already open (prevents infinite loop)', async () => {
        // This behavior is intentional - updating index while open caused infinite loops
        // when YARL fires on.view callbacks. The index only syncs on open transition.
        const { rerender } = render(
            <PhotoLightbox
                photos={mockPhotos}
                initialIndex={0}
                isOpen={true}
                onClose={() => {}}
                getMediaUrl={mockGetMediaUrl}
            />
        );

        expect(screen.getByTestId('yarl-lightbox')).toHaveAttribute('data-index', '0');

        // Change initialIndex while still open - should NOT update
        rerender(
            <PhotoLightbox
                photos={mockPhotos}
                initialIndex={1}
                isOpen={true}
                onClose={() => {}}
                getMediaUrl={mockGetMediaUrl}
            />
        );

        // Index should remain at 0 since lightbox was already open
        expect(screen.getByTestId('yarl-lightbox')).toHaveAttribute('data-index', '0');
    });

    it('generates correct media URLs for slides', async () => {
        const Lightbox = (await import('yet-another-react-lightbox')).default as Mock;

        render(
            <PhotoLightbox
                photos={mockPhotos}
                initialIndex={0}
                isOpen={true}
                onClose={() => {}}
                getMediaUrl={mockGetMediaUrl}
            />
        );

        // Check that Lightbox was called with correct slides
        expect(Lightbox).toHaveBeenCalled();
        const lastCall = Lightbox.mock.calls[Lightbox.mock.calls.length - 1][0];
        expect(lastCall.slides).toEqual([
            { src: 'https://media.example.com/photos/photo1.jpg', alt: 'Photo 1' },
            { src: 'https://media.example.com/photos/photo2.jpg', alt: 'Photo 2' },
            { src: 'https://media.example.com/photos/photo3.jpg', alt: 'Photo 3' }
        ]);
    });

    it('returns null when photos array is empty', () => {
        render(
            <PhotoLightbox
                photos={[]}
                initialIndex={0}
                isOpen={true}
                onClose={() => {}}
                getMediaUrl={mockGetMediaUrl}
            />
        );
        expect(screen.queryByTestId('yarl-lightbox')).not.toBeInTheDocument();
    });

    describe('video support', () => {
        const mockVideos: Photo[] = [
            {
                id: 'video-1',
                journey_id: 'journey-1',
                url: 'videos/video1.mov',
                thumbnail_url: 'videos/video1_thumb.jpg',
                caption: 'Summit Video',
                media_type: 'video',
                duration: 30,
                sort_order: 0
            },
            {
                id: 'photo-1',
                journey_id: 'journey-1',
                url: 'photos/photo1.jpg',
                caption: 'Photo 1',
                media_type: 'image',
                sort_order: 1
            },
            {
                id: 'video-2',
                journey_id: 'journey-1',
                url: 'videos/video2.mp4',
                media_type: 'video',
                sort_order: 2
            }
        ];

        it('generates video slides with correct format', async () => {
            const Lightbox = (await import('yet-another-react-lightbox')).default as Mock;

            render(
                <PhotoLightbox
                    photos={mockVideos}
                    initialIndex={0}
                    isOpen={true}
                    onClose={() => {}}
                    getMediaUrl={mockGetMediaUrl}
                />
            );

            expect(Lightbox).toHaveBeenCalled();
            const lastCall = Lightbox.mock.calls[Lightbox.mock.calls.length - 1][0];

            // First slide should be a video
            expect(lastCall.slides[0]).toEqual({
                type: 'video',
                sources: [{ src: 'https://media.example.com/videos/video1.mov', type: 'video/quicktime' }],
                poster: 'https://media.example.com/videos/video1_thumb.jpg'
            });

            // Second slide should be an image
            expect(lastCall.slides[1]).toEqual({
                src: 'https://media.example.com/photos/photo1.jpg',
                alt: 'Photo 1'
            });

            // Third slide should be a video without poster (no thumbnail)
            expect(lastCall.slides[2]).toEqual({
                type: 'video',
                sources: [{ src: 'https://media.example.com/videos/video2.mp4', type: 'video/mp4' }],
                poster: undefined
            });
        });

        it('detects correct MIME type for .mov files', async () => {
            const Lightbox = (await import('yet-another-react-lightbox')).default as Mock;
            const movVideo: Photo[] = [{
                id: 'video-1',
                journey_id: 'journey-1',
                url: 'videos/test.mov',
                media_type: 'video',
                sort_order: 0
            }];

            render(
                <PhotoLightbox
                    photos={movVideo}
                    initialIndex={0}
                    isOpen={true}
                    onClose={() => {}}
                    getMediaUrl={mockGetMediaUrl}
                />
            );

            const lastCall = Lightbox.mock.calls[Lightbox.mock.calls.length - 1][0];
            expect(lastCall.slides[0].sources[0].type).toBe('video/quicktime');
        });

        it('detects correct MIME type for .mp4 files', async () => {
            const Lightbox = (await import('yet-another-react-lightbox')).default as Mock;
            const mp4Video: Photo[] = [{
                id: 'video-1',
                journey_id: 'journey-1',
                url: 'videos/test.mp4',
                media_type: 'video',
                sort_order: 0
            }];

            render(
                <PhotoLightbox
                    photos={mp4Video}
                    initialIndex={0}
                    isOpen={true}
                    onClose={() => {}}
                    getMediaUrl={mockGetMediaUrl}
                />
            );

            const lastCall = Lightbox.mock.calls[Lightbox.mock.calls.length - 1][0];
            expect(lastCall.slides[0].sources[0].type).toBe('video/mp4');
        });

        it('detects correct MIME type for .webm files', async () => {
            const Lightbox = (await import('yet-another-react-lightbox')).default as Mock;
            const webmVideo: Photo[] = [{
                id: 'video-1',
                journey_id: 'journey-1',
                url: 'videos/test.webm',
                media_type: 'video',
                sort_order: 0
            }];

            render(
                <PhotoLightbox
                    photos={webmVideo}
                    initialIndex={0}
                    isOpen={true}
                    onClose={() => {}}
                    getMediaUrl={mockGetMediaUrl}
                />
            );

            const lastCall = Lightbox.mock.calls[Lightbox.mock.calls.length - 1][0];
            expect(lastCall.slides[0].sources[0].type).toBe('video/webm');
        });

        it('defaults to video/mp4 for unknown extensions', async () => {
            const Lightbox = (await import('yet-another-react-lightbox')).default as Mock;
            const unknownVideo: Photo[] = [{
                id: 'video-1',
                journey_id: 'journey-1',
                url: 'videos/test.unknown',
                media_type: 'video',
                sort_order: 0
            }];

            render(
                <PhotoLightbox
                    photos={unknownVideo}
                    initialIndex={0}
                    isOpen={true}
                    onClose={() => {}}
                    getMediaUrl={mockGetMediaUrl}
                />
            );

            const lastCall = Lightbox.mock.calls[Lightbox.mock.calls.length - 1][0];
            expect(lastCall.slides[0].sources[0].type).toBe('video/mp4');
        });

        it('shows compatibility warning for .mov videos', () => {
            const movVideo: Photo[] = [{
                id: 'video-1',
                journey_id: 'journey-1',
                url: 'videos/test.mov',
                media_type: 'video',
                sort_order: 0
            }];

            render(
                <PhotoLightbox
                    photos={movVideo}
                    initialIndex={0}
                    isOpen={true}
                    onClose={() => {}}
                    getMediaUrl={mockGetMediaUrl}
                />
            );

            expect(screen.getByText(/This video format \(\.mov\) may not play in all browsers/)).toBeInTheDocument();
            expect(screen.getByText(/Works best in Safari/)).toBeInTheDocument();
        });

        it('shows compatibility warning for .m4v videos', () => {
            const m4vVideo: Photo[] = [{
                id: 'video-1',
                journey_id: 'journey-1',
                url: 'videos/test.m4v',
                media_type: 'video',
                sort_order: 0
            }];

            render(
                <PhotoLightbox
                    photos={m4vVideo}
                    initialIndex={0}
                    isOpen={true}
                    onClose={() => {}}
                    getMediaUrl={mockGetMediaUrl}
                />
            );

            expect(screen.getByText(/This video format \(\.mov\) may not play in all browsers/)).toBeInTheDocument();
        });

        it('does NOT show compatibility warning for .mp4 videos', () => {
            const mp4Video: Photo[] = [{
                id: 'video-1',
                journey_id: 'journey-1',
                url: 'videos/test.mp4',
                media_type: 'video',
                sort_order: 0
            }];

            render(
                <PhotoLightbox
                    photos={mp4Video}
                    initialIndex={0}
                    isOpen={true}
                    onClose={() => {}}
                    getMediaUrl={mockGetMediaUrl}
                />
            );

            expect(screen.queryByText(/may not play in all browsers/)).not.toBeInTheDocument();
        });

        it('does NOT show compatibility warning for images', () => {
            render(
                <PhotoLightbox
                    photos={mockPhotos}
                    initialIndex={0}
                    isOpen={true}
                    onClose={() => {}}
                    getMediaUrl={mockGetMediaUrl}
                />
            );

            expect(screen.queryByText(/may not play in all browsers/)).not.toBeInTheDocument();
        });
    });
});
