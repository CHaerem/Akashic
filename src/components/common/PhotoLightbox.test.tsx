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

    it('syncs index when reopened with different initialIndex', async () => {
        const { rerender } = render(
            <PhotoLightbox
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
                photos={mockPhotos}
                initialIndex={0}
                isOpen={false}
                onClose={() => {}}
                getMediaUrl={mockGetMediaUrl}
            />
        );

        expect(screen.queryByTestId('yarl-lightbox')).not.toBeInTheDocument();

        // Reopen with different index (simulating click on different photo)
        rerender(
            <PhotoLightbox
                photos={mockPhotos}
                initialIndex={2}
                isOpen={true}
                onClose={() => {}}
                getMediaUrl={mockGetMediaUrl}
            />
        );

        // Should show index 2, not the old index 0
        await waitFor(() => {
            expect(screen.getByTestId('yarl-lightbox')).toHaveAttribute('data-index', '2');
        });
    });

    it('updates index when initialIndex changes while open', async () => {
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

        // Change initialIndex while still open
        rerender(
            <PhotoLightbox
                photos={mockPhotos}
                initialIndex={1}
                isOpen={true}
                onClose={() => {}}
                getMediaUrl={mockGetMediaUrl}
            />
        );

        await waitFor(() => {
            expect(screen.getByTestId('yarl-lightbox')).toHaveAttribute('data-index', '1');
        });
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
});
