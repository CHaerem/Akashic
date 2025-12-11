import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { DayPhotos } from './DayPhotos';
import type { Photo } from '../../types/trek';

const createMockPhotos = (count: number): Photo[] =>
    Array.from({ length: count }, (_, i) => ({
        id: `photo-${i + 1}`,
        journey_id: 'journey-1',
        url: `photos/photo${i + 1}.jpg`,
        thumbnail_url: `photos/photo${i + 1}_thumb.jpg`,
        caption: `Photo ${i + 1}`,
        coordinates: [i, i] as [number, number],
        taken_at: `2024-01-0${(i % 9) + 1}T10:00:00Z`,
        sort_order: i,
    }));

const mockGetMediaUrl = (path: string) => `https://media.test/${path}`;

describe('DayPhotos', () => {
    it('returns null when no photos', () => {
        const { container } = render(
            <DayPhotos
                photos={[]}
                getMediaUrl={mockGetMediaUrl}
                isMobile={false}
                onPhotoClick={() => {}}
            />
        );

        expect(container.firstChild).toBeNull();
    });

    it('renders photos in grid', () => {
        const photos = createMockPhotos(4);

        render(
            <DayPhotos
                photos={photos}
                getMediaUrl={mockGetMediaUrl}
                isMobile={false}
                onPhotoClick={() => {}}
            />
        );

        const images = screen.getAllByRole('img');
        expect(images).toHaveLength(4);
    });

    it('shows max 6 photos on mobile', () => {
        const photos = createMockPhotos(10);

        render(
            <DayPhotos
                photos={photos}
                getMediaUrl={mockGetMediaUrl}
                isMobile={true}
                onPhotoClick={() => {}}
            />
        );

        const images = screen.getAllByRole('img');
        expect(images).toHaveLength(6);
    });

    it('shows max 8 photos on desktop', () => {
        const photos = createMockPhotos(12);

        render(
            <DayPhotos
                photos={photos}
                getMediaUrl={mockGetMediaUrl}
                isMobile={false}
                onPhotoClick={() => {}}
            />
        );

        const images = screen.getAllByRole('img');
        expect(images).toHaveLength(8);
    });

    it('shows +N more indicator when exceeds max (mobile)', () => {
        const photos = createMockPhotos(10);

        render(
            <DayPhotos
                photos={photos}
                getMediaUrl={mockGetMediaUrl}
                isMobile={true}
                onPhotoClick={() => {}}
            />
        );

        // 10 photos - 6 visible = 4 more
        expect(screen.getByText('+4')).toBeInTheDocument();
    });

    it('shows +N more indicator when exceeds max (desktop)', () => {
        const photos = createMockPhotos(15);

        render(
            <DayPhotos
                photos={photos}
                getMediaUrl={mockGetMediaUrl}
                isMobile={false}
                onPhotoClick={() => {}}
            />
        );

        // 15 photos - 8 visible = 7 more
        expect(screen.getByText('+7')).toBeInTheDocument();
    });

    it('does not show +N indicator when at or under max', () => {
        const photos = createMockPhotos(8);

        render(
            <DayPhotos
                photos={photos}
                getMediaUrl={mockGetMediaUrl}
                isMobile={false}
                onPhotoClick={() => {}}
            />
        );

        expect(screen.queryByText(/^\+\d+$/)).not.toBeInTheDocument();
    });

    it('calls onPhotoClick with correct index when photo clicked', async () => {
        const user = userEvent.setup();
        const handleClick = vi.fn();
        const photos = createMockPhotos(4);

        render(
            <DayPhotos
                photos={photos}
                getMediaUrl={mockGetMediaUrl}
                isMobile={false}
                onPhotoClick={handleClick}
            />
        );

        const images = screen.getAllByRole('img');
        await user.click(images[2]); // Click third photo

        expect(handleClick).toHaveBeenCalledWith(2);
    });

    it('calls onPhotoClick with maxVisible index when +N clicked', async () => {
        const user = userEvent.setup();
        const handleClick = vi.fn();
        const photos = createMockPhotos(10);

        render(
            <DayPhotos
                photos={photos}
                getMediaUrl={mockGetMediaUrl}
                isMobile={true}
                onPhotoClick={handleClick}
            />
        );

        const moreIndicator = screen.getByText('+4');
        await user.click(moreIndicator);

        // Should call with maxVisible (6) to open lightbox at first hidden photo
        expect(handleClick).toHaveBeenCalledWith(6);
    });

    it('uses thumbnail_url when available', () => {
        const photos = createMockPhotos(1);

        render(
            <DayPhotos
                photos={photos}
                getMediaUrl={mockGetMediaUrl}
                isMobile={false}
                onPhotoClick={() => {}}
            />
        );

        const img = screen.getByRole('img');
        expect(img).toHaveAttribute('src', 'https://media.test/photos/photo1_thumb.jpg');
    });

    it('falls back to url when thumbnail_url missing', () => {
        const photos: Photo[] = [{
            id: 'photo-1',
            journey_id: 'journey-1',
            url: 'photos/photo1.jpg',
            // No thumbnail_url
            sort_order: 0,
        }];

        render(
            <DayPhotos
                photos={photos}
                getMediaUrl={mockGetMediaUrl}
                isMobile={false}
                onPhotoClick={() => {}}
            />
        );

        const img = screen.getByRole('img');
        expect(img).toHaveAttribute('src', 'https://media.test/photos/photo1.jpg');
    });

    it('applies rotation style when photo has rotation', () => {
        const photos: Photo[] = [{
            id: 'photo-1',
            journey_id: 'journey-1',
            url: 'photos/photo1.jpg',
            rotation: 90,
            sort_order: 0,
        }];

        render(
            <DayPhotos
                photos={photos}
                getMediaUrl={mockGetMediaUrl}
                isMobile={false}
                onPhotoClick={() => {}}
            />
        );

        const img = screen.getByRole('img');
        expect(img).toHaveStyle({ transform: 'rotate(90deg)' });
    });

    it('uses caption as alt text when available', () => {
        const photos: Photo[] = [{
            id: 'photo-1',
            journey_id: 'journey-1',
            url: 'photos/photo1.jpg',
            caption: 'Sunset at camp',
            sort_order: 0,
        }];

        render(
            <DayPhotos
                photos={photos}
                getMediaUrl={mockGetMediaUrl}
                isMobile={false}
                onPhotoClick={() => {}}
            />
        );

        expect(screen.getByAltText('Sunset at camp')).toBeInTheDocument();
    });

    it('uses default alt text when no caption', () => {
        const photos: Photo[] = [{
            id: 'photo-1',
            journey_id: 'journey-1',
            url: 'photos/photo1.jpg',
            sort_order: 0,
        }];

        render(
            <DayPhotos
                photos={photos}
                getMediaUrl={mockGetMediaUrl}
                isMobile={false}
                onPhotoClick={() => {}}
            />
        );

        expect(screen.getByAltText('Journey photo')).toBeInTheDocument();
    });

    describe('video support', () => {
        it('shows play icon overlay for videos', () => {
            const photos: Photo[] = [{
                id: 'video-1',
                journey_id: 'journey-1',
                url: 'videos/video1.mov',
                thumbnail_url: 'videos/video1_thumb.jpg',
                media_type: 'video',
                duration: 30,
                sort_order: 0,
            }];

            render(
                <DayPhotos
                    photos={photos}
                    getMediaUrl={mockGetMediaUrl}
                    isMobile={false}
                    onPhotoClick={() => {}}
                />
            );

            // Check for play icon (SVG with play path)
            const playIcon = document.querySelector('svg path[d="M8 5v14l11-7z"]');
            expect(playIcon).toBeInTheDocument();
        });

        it('does not show play icon for images', () => {
            const photos: Photo[] = [{
                id: 'photo-1',
                journey_id: 'journey-1',
                url: 'photos/photo1.jpg',
                media_type: 'image',
                sort_order: 0,
            }];

            render(
                <DayPhotos
                    photos={photos}
                    getMediaUrl={mockGetMediaUrl}
                    isMobile={false}
                    onPhotoClick={() => {}}
                />
            );

            // Should not have play icon
            const playIcon = document.querySelector('svg path[d="M8 5v14l11-7z"]');
            expect(playIcon).not.toBeInTheDocument();
        });

        it('uses "Journey video" as default alt text for videos', () => {
            const photos: Photo[] = [{
                id: 'video-1',
                journey_id: 'journey-1',
                url: 'videos/video1.mov',
                media_type: 'video',
                sort_order: 0,
            }];

            render(
                <DayPhotos
                    photos={photos}
                    getMediaUrl={mockGetMediaUrl}
                    isMobile={false}
                    onPhotoClick={() => {}}
                />
            );

            expect(screen.getByAltText('Journey video')).toBeInTheDocument();
        });

        it('uses caption as alt text for videos when available', () => {
            const photos: Photo[] = [{
                id: 'video-1',
                journey_id: 'journey-1',
                url: 'videos/video1.mov',
                caption: 'Summit video',
                media_type: 'video',
                sort_order: 0,
            }];

            render(
                <DayPhotos
                    photos={photos}
                    getMediaUrl={mockGetMediaUrl}
                    isMobile={false}
                    onPhotoClick={() => {}}
                />
            );

            expect(screen.getByAltText('Summit video')).toBeInTheDocument();
        });

        it('renders mixed photos and videos correctly', () => {
            const photos: Photo[] = [
                {
                    id: 'photo-1',
                    journey_id: 'journey-1',
                    url: 'photos/photo1.jpg',
                    media_type: 'image',
                    sort_order: 0,
                },
                {
                    id: 'video-1',
                    journey_id: 'journey-1',
                    url: 'videos/video1.mov',
                    media_type: 'video',
                    sort_order: 1,
                },
                {
                    id: 'photo-2',
                    journey_id: 'journey-1',
                    url: 'photos/photo2.jpg',
                    sort_order: 2, // No media_type defaults to image
                },
            ];

            render(
                <DayPhotos
                    photos={photos}
                    getMediaUrl={mockGetMediaUrl}
                    isMobile={false}
                    onPhotoClick={() => {}}
                />
            );

            // Should have 3 images
            const images = screen.getAllByRole('img');
            expect(images).toHaveLength(3);

            // Should have exactly 1 play icon (for the video)
            const playIcons = document.querySelectorAll('svg path[d="M8 5v14l11-7z"]');
            expect(playIcons).toHaveLength(1);
        });
    });
});
