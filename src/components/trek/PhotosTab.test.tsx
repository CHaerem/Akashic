import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PhotosTab } from './PhotosTab';
import type { TrekData, Photo } from '../../types/trek';

// Mock useMedia hook
vi.mock('../../hooks/useMedia', () => ({
    useMedia: () => ({
        getMediaUrl: (path: string) => `https://media.test/${path}`,
        loading: false,
    }),
}));

// Mock usePhotoDay hook
vi.mock('../../hooks/usePhotoDay', () => ({
    usePhotoDay: (_trekData: TrekData, photos: Photo[]) => ({
        photosByDay: {
            1: photos.filter(p => p.waypoint_id === 'wp-1'),
            2: photos.filter(p => p.waypoint_id === 'wp-2'),
            unassigned: photos.filter(p => !p.waypoint_id),
        },
        getPhotosForDay: (day: number) => photos.filter(p =>
            (day === 1 && p.waypoint_id === 'wp-1') ||
            (day === 2 && p.waypoint_id === 'wp-2')
        ),
    }),
}));

// Mock journeys lib
const mockFetchPhotos = vi.fn();
const mockGetJourneyIdBySlug = vi.fn();

vi.mock('../../lib/journeys', () => ({
    fetchPhotos: (...args: unknown[]) => mockFetchPhotos(...args),
    getJourneyIdBySlug: (...args: unknown[]) => mockGetJourneyIdBySlug(...args),
    createPhoto: vi.fn(),
    deletePhoto: vi.fn(),
    updatePhoto: vi.fn(),
}));

// Mock PhotoLightbox - simplified for testing
vi.mock('../common/PhotoLightbox', () => ({
    PhotoLightbox: ({ isOpen, photos, initialIndex }: { isOpen: boolean; photos: Photo[]; initialIndex: number }) => {
        if (!isOpen) return null;
        return (
            <div data-testid="lightbox" data-photo-count={photos.length} data-index={initialIndex}>
                Lightbox Open
            </div>
        );
    },
}));

// Mock other components
vi.mock('./PhotoUpload', () => ({
    PhotoUpload: () => <div data-testid="photo-upload">Upload Component</div>,
}));

vi.mock('./PhotoEditModal', () => ({
    PhotoEditModal: () => null,
}));

vi.mock('@/components/ui/skeleton', () => ({
    SkeletonPhotoGrid: () => <div data-testid="skeleton">Loading...</div>,
}));

// Mock tanstack virtual
vi.mock('@tanstack/react-virtual', () => ({
    useVirtualizer: () => ({
        getVirtualItems: () => [{
            key: 'row-0',
            index: 0,
            start: 0,
            size: 150,
        }],
        getTotalSize: () => 150,
    }),
}));

// Mock ResizeObserver
class MockResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
}
global.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver;

const mockTrekData: TrekData = {
    id: 'test-trek',
    name: 'Test Trek',
    country: 'Test Country',
    description: 'Test Description',
    stats: {
        duration: 3,
        totalDistance: 30,
        totalElevationGain: 2000,
        highestPoint: { name: 'Summit', elevation: 4000 },
    },
    camps: [
        {
            id: 'wp-1',
            name: 'Camp 1',
            dayNumber: 1,
            elevation: 2000,
            coordinates: [1, 1],
            elevationGainFromPrevious: 0,
        },
        {
            id: 'wp-2',
            name: 'Camp 2',
            dayNumber: 2,
            elevation: 3000,
            coordinates: [2, 2],
            elevationGainFromPrevious: 1000,
        },
    ],
    route: { type: 'LineString', coordinates: [] },
};

const mockPhotos: Photo[] = [
    {
        id: 'photo-1',
        journey_id: 'journey-1',
        waypoint_id: 'wp-1',
        url: 'photos/photo1.jpg',
        thumbnail_url: 'photos/photo1_thumb.jpg',
        caption: 'Photo 1',
        coordinates: [1, 1],
        taken_at: '2024-01-01T10:00:00Z',
        sort_order: 0,
    },
    {
        id: 'photo-2',
        journey_id: 'journey-1',
        waypoint_id: 'wp-1',
        url: 'photos/photo2.jpg',
        caption: 'Photo 2',
        coordinates: [1.1, 1.1],
        taken_at: '2024-01-01T12:00:00Z',
        sort_order: 1,
    },
    {
        id: 'photo-3',
        journey_id: 'journey-1',
        waypoint_id: 'wp-2',
        url: 'photos/photo3.jpg',
        coordinates: [2, 2],
        taken_at: '2024-01-02T10:00:00Z',
        sort_order: 2,
    },
];

describe('PhotosTab', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockGetJourneyIdBySlug.mockResolvedValue('journey-uuid-123');
        mockFetchPhotos.mockResolvedValue(mockPhotos);
    });

    it('shows loading skeleton initially', async () => {
        mockFetchPhotos.mockImplementation(() => new Promise(() => {})); // Never resolves

        render(<PhotosTab trekData={mockTrekData} isMobile={false} />);

        await waitFor(() => {
            expect(screen.getByTestId('skeleton')).toBeInTheDocument();
        });
    });

    it('renders photo count in header', async () => {
        render(<PhotosTab trekData={mockTrekData} isMobile={false} />);

        await waitFor(() => {
            expect(screen.getByText(/Journey Media \(3\)/)).toBeInTheDocument();
        });
    });

    it('renders day filter tabs', async () => {
        render(<PhotosTab trekData={mockTrekData} isMobile={false} />);

        await waitFor(() => {
            expect(screen.getByText(/All \(3\)/)).toBeInTheDocument();
            expect(screen.getByText(/Day 1/)).toBeInTheDocument();
            expect(screen.getByText(/Day 2/)).toBeInTheDocument();
        });
    });

    it('shows empty state when no photos', async () => {
        mockFetchPhotos.mockResolvedValue([]);

        render(<PhotosTab trekData={mockTrekData} isMobile={false} />);

        await waitFor(() => {
            expect(screen.getByText('No photos yet')).toBeInTheDocument();
        });
    });

    it('shows upload component in edit mode', async () => {
        render(<PhotosTab trekData={mockTrekData} isMobile={false} editMode={true} />);

        await waitFor(() => {
            expect(screen.getByTestId('photo-upload')).toBeInTheDocument();
        });
    });

    it('hides upload component when not in edit mode', async () => {
        render(<PhotosTab trekData={mockTrekData} isMobile={false} editMode={false} />);

        await waitFor(() => {
            expect(screen.queryByTestId('photo-upload')).not.toBeInTheDocument();
        });
    });

    it('opens lightbox when photo is clicked', async () => {
        const user = userEvent.setup();

        render(<PhotosTab trekData={mockTrekData} isMobile={false} />);

        // Wait for photos to load
        await waitFor(() => {
            expect(screen.getByText(/Journey Media/)).toBeInTheDocument();
        });

        // Find and click a photo
        const photoButtons = screen.getAllByRole('button', { name: /Photo \d/ });
        expect(photoButtons.length).toBeGreaterThan(0);

        await user.click(photoButtons[0]);

        // Lightbox should open
        await waitFor(() => {
            expect(screen.getByTestId('lightbox')).toBeInTheDocument();
        });
    });

    it('fetches photos with correct journey ID', async () => {
        render(<PhotosTab trekData={mockTrekData} isMobile={false} />);

        await waitFor(() => {
            expect(mockGetJourneyIdBySlug).toHaveBeenCalledWith('test-trek');
            expect(mockFetchPhotos).toHaveBeenCalledWith('journey-uuid-123');
        });
    });

    it('handles photo fetch error gracefully', async () => {
        mockFetchPhotos.mockRejectedValue(new Error('Network error'));

        render(<PhotosTab trekData={mockTrekData} isMobile={false} />);

        await waitFor(() => {
            expect(screen.getByText('Failed to load photos')).toBeInTheDocument();
        });
    });

    it('shows drag to reorder hint in edit mode with multiple photos', async () => {
        render(<PhotosTab trekData={mockTrekData} isMobile={false} editMode={true} />);

        await waitFor(() => {
            expect(screen.getByText('Drag to reorder')).toBeInTheDocument();
        });
    });

    describe('video support', () => {
        const mockMediaWithVideos: Photo[] = [
            {
                id: 'photo-1',
                journey_id: 'journey-1',
                waypoint_id: 'wp-1',
                url: 'photos/photo1.jpg',
                caption: 'Photo 1',
                media_type: 'image',
                sort_order: 0,
            },
            {
                id: 'video-1',
                journey_id: 'journey-1',
                waypoint_id: 'wp-1',
                url: 'videos/video1.mov',
                thumbnail_url: 'videos/video1_thumb.jpg',
                caption: 'Summit Video',
                media_type: 'video',
                duration: 30,
                sort_order: 1,
            },
        ];

        beforeEach(() => {
            mockFetchPhotos.mockResolvedValue(mockMediaWithVideos);
        });

        it('renders videos with correct aria-label', async () => {
            render(<PhotosTab trekData={mockTrekData} isMobile={false} />);

            await waitFor(() => {
                // Photo should have "Photo N" label
                const photoButton = screen.getByRole('button', { name: /Photo 1: Photo 1/ });
                expect(photoButton).toBeInTheDocument();

                // Video should have "Video N" label
                const videoButton = screen.getByRole('button', { name: /Video 2: Summit Video/ });
                expect(videoButton).toBeInTheDocument();
            });
        });

        it('shows play icon overlay for videos in grid', async () => {
            render(<PhotosTab trekData={mockTrekData} isMobile={false} />);

            await waitFor(() => {
                expect(screen.getByText(/Journey Media/)).toBeInTheDocument();
            });

            // Check for play icon (SVG with play path) - should exist for video
            const playIcons = document.querySelectorAll('svg path[d="M8 5v14l11-7z"]');
            expect(playIcons.length).toBeGreaterThan(0);
        });

        it('filters media by type', async () => {
            const user = userEvent.setup();

            render(<PhotosTab trekData={mockTrekData} isMobile={false} />);

            await waitFor(() => {
                expect(screen.getByText(/Journey Media/)).toBeInTheDocument();
            });

            await user.click(screen.getByRole('button', { name: 'Videos' }));

            await waitFor(() => {
                expect(screen.queryByRole('button', { name: /Photo 1/ })).not.toBeInTheDocument();
                expect(screen.getByRole('button', { name: /Video 1: Summit Video/ })).toBeInTheDocument();
            });
        });

        it('filters by caption search', async () => {
            const user = userEvent.setup();

            render(<PhotosTab trekData={mockTrekData} isMobile={false} />);

            await waitFor(() => {
                expect(screen.getByText(/Journey Media/)).toBeInTheDocument();
            });

            await user.type(screen.getByRole('searchbox', { name: /search media/i }), 'Summit');

            await waitFor(() => {
                expect(screen.queryByRole('button', { name: /Photo 1/ })).not.toBeInTheDocument();
                expect(screen.getByRole('button', { name: /Video 1: Summit Video/ })).toBeInTheDocument();
            });
        });
    });
});
