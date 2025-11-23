import { useState, useEffect } from 'react';
import PhotoSwipeLightbox from 'photoswipe/lightbox';
import 'photoswipe/style.css';
import photoMetadata from '../../data/photoMetadata.json';

export default function PhotoGallery({ trekData }) {
    const [photos, setPhotos] = useState([]);
    const trekId = trekData.id === 'mount-kenya' ? 'mountKenya' : trekData.id === 'inca-trail' ? 'incaTrail' : 'kilimanjaro';

    useEffect(() => {
        if (photoMetadata[trekId]) {
            setPhotos(photoMetadata[trekId]);
        }
    }, [trekId]);

    useEffect(() => {
        let lightbox = new PhotoSwipeLightbox({
            gallery: '#my-test-gallery',
            children: 'a',
            pswpModule: () => import('photoswipe')
        });
        lightbox.init();

        return () => {
            lightbox.destroy();
            lightbox = null;
        };
    }, [photos]);

    if (photos.length === 0) {
        return (
            <div className="text-center py-12 bg-mountain-50 rounded-xl border-2 border-dashed border-mountain-200">
                <svg className="w-12 h-12 text-mountain-300 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                <h3 className="text-lg font-medium text-mountain-900">No photos found</h3>
                <p className="text-gray-500 mt-1">Add photos to public/images/{trekData.id} and run the generator script.</p>
            </div>
        );
    }

    return (
        <div className="pswp-gallery grid grid-cols-2 md:grid-cols-3 gap-4" id="my-test-gallery">
            {photos.map((photo, index) => (
                <a
                    key={index}
                    href={`/images/${photo.filename}`}
                    data-pswp-width={photo.width || 1600} // Fallback if width missing
                    data-pswp-height={photo.height || 1200} // Fallback if height missing
                    target="_blank"
                    rel="noreferrer"
                    className="aspect-square relative group overflow-hidden rounded-lg cursor-pointer block"
                >
                    <img
                        src={`/images/${photo.filename}`}
                        alt={photo.description || `Photo ${index + 1}`}
                        className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110"
                        loading="lazy"
                    />
                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors duration-300" />
                </a>
            ))}
        </div>
    );
}
