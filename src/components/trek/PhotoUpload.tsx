/**
 * Photo upload component with drag-and-drop support and preview
 * Allows family members to collaboratively add photos to journeys
 * Enhanced for mobile with larger touch targets and metadata preview
 *
 * NOTE: Browser upload currently only accepts IMAGE files (not videos).
 * This is intentional for the MVP because:
 * - iPhone records video in .mov format (QuickTime)
 * - .mov only works in Safari, not Chrome/Firefox
 * - Converting to .mp4 in-browser requires ffmpeg.wasm (~25MB)
 *
 * For video uploads, use the bulk upload script which auto-converts:
 *   SUPABASE_SERVICE_KEY="..." npx tsx scripts/bulkUploadR2.ts <folder> <journey-slug>
 *
 * Future enhancement: Add client-side transcoding with ffmpeg.wasm or
 * server-side transcoding via Cloudflare Worker.
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { uploadPhoto, type UploadResult } from '../../lib/media';
import { extractPhotoMetadata, type PhotoMetadata } from '../../lib/exif';
import { Button } from '../ui/button';
import { cn } from '@/lib/utils';

interface PhotoUploadProps {
    journeyId: string;
    onUploadComplete: (result: UploadResult) => void;
    onUploadError: (error: string) => void;
    isMobile?: boolean;
}

interface PendingFile {
    id: string;
    file: File;
    previewUrl: string;
    metadata: PhotoMetadata;
}

interface UploadingFile {
    id: string;
    file: File;
    previewUrl: string;
    metadata: PhotoMetadata;
    status: 'uploading' | 'done' | 'error';
    error?: string;
}

export function PhotoUpload({ journeyId, onUploadComplete, onUploadError, isMobile = false }: PhotoUploadProps) {
    const [isDragging, setIsDragging] = useState(false);
    const [pending, setPending] = useState<PendingFile[]>([]);
    const [uploading, setUploading] = useState<UploadingFile[]>([]);
    const fileInputRef = useRef<HTMLInputElement>(null);

    // Cleanup preview URLs on unmount
    useEffect(() => {
        return () => {
            pending.forEach(p => URL.revokeObjectURL(p.previewUrl));
            uploading.forEach(u => URL.revokeObjectURL(u.previewUrl));
        };
    }, []);

    const handleFiles = useCallback(async (files: FileList | File[]) => {
        const fileArray = Array.from(files).filter(f =>
            f.type.startsWith('image/')
        );

        if (fileArray.length === 0) {
            onUploadError('No valid image files selected');
            return;
        }

        const newPending: PendingFile[] = await Promise.all(
            fileArray.map(async (file) => {
                const id = `pending-${Date.now()}-${Math.random().toString(36).slice(2)}`;
                const previewUrl = URL.createObjectURL(file);
                const metadata = await extractPhotoMetadata(file);
                return { id, file, previewUrl, metadata };
            })
        );

        setPending(prev => [...prev, ...newPending]);
    }, [onUploadError]);

    const removePending = useCallback((id: string) => {
        setPending(prev => {
            const item = prev.find(p => p.id === id);
            if (item) {
                URL.revokeObjectURL(item.previewUrl);
            }
            return prev.filter(p => p.id !== id);
        });
    }, []);

    const uploadAll = useCallback(async () => {
        if (pending.length === 0) return;

        const toUpload = pending.map(p => ({
            ...p,
            status: 'uploading' as const,
        }));

        setUploading(toUpload);
        setPending([]);

        for (const item of toUpload) {
            try {
                const result = await uploadPhoto(journeyId, item.file);

                const resultWithMetadata: UploadResult = {
                    ...result,
                    coordinates: item.metadata.coordinates,
                    takenAt: item.metadata.takenAt,
                };

                setUploading(prev => prev.map(u =>
                    u.id === item.id ? { ...u, status: 'done' } : u
                ));

                onUploadComplete(resultWithMetadata);

                setTimeout(() => {
                    setUploading(prev => {
                        const toRemove = prev.find(u => u.id === item.id);
                        if (toRemove) {
                            URL.revokeObjectURL(toRemove.previewUrl);
                        }
                        return prev.filter(u => u.id !== item.id);
                    });
                }, 1000);
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : 'Upload failed';

                setUploading(prev => prev.map(u =>
                    u.id === item.id ? { ...u, status: 'error', error: errorMessage } : u
                ));

                onUploadError(`Failed to upload ${item.file.name}: ${errorMessage}`);
            }
        }
    }, [pending, journeyId, onUploadComplete, onUploadError]);

    const clearError = useCallback((id: string) => {
        setUploading(prev => {
            const item = prev.find(u => u.id === id);
            if (item) {
                URL.revokeObjectURL(item.previewUrl);
            }
            return prev.filter(u => u.id !== id);
        });
    }, []);

    const handleDragOver = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(true);
    }, []);

    const handleDragLeave = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(false);
    }, []);

    const handleDrop = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(false);

        const files = e.dataTransfer.files;
        if (files.length > 0) {
            handleFiles(files);
        }
    }, [handleFiles]);

    const handleClick = useCallback(() => {
        fileInputRef.current?.click();
    }, []);

    const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        const files = e.target.files;
        if (files && files.length > 0) {
            handleFiles(files);
        }
        e.target.value = '';
    }, [handleFiles]);

    const formatDate = (date?: Date) => {
        if (!date) return null;
        return date.toLocaleDateString(undefined, {
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
        });
    };

    const isUploading = uploading.some(u => u.status === 'uploading');

    return (
        <div>
            {/* Drop zone */}
            <div
                onClick={handleClick}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                className={cn(
                    "border-2 border-dashed rounded-xl text-center transition-all duration-200",
                    "flex flex-col items-center justify-center",
                    isMobile ? "p-6 min-h-20" : "p-8",
                    isDragging
                        ? "border-blue-500/60 bg-blue-500/10"
                        : "border-white/20 light:border-black/20",
                    isUploading
                        ? "opacity-60 pointer-events-none cursor-default"
                        : "cursor-pointer"
                )}
            >
                <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/jpeg,image/png,image/gif,image/webp,image/heic,image/heif"
                    multiple
                    onChange={handleFileChange}
                    className="hidden"
                />

                <div className={cn(
                    "rounded-full bg-white/10 light:bg-black/5 flex items-center justify-center mb-3",
                    isMobile ? "w-12 h-12" : "w-10 h-10"
                )}>
                    <svg width={isMobile ? 24 : 20} height={isMobile ? 24 : 20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-white/60 light:text-slate-400">
                        <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
                        <polyline points="17 8 12 3 7 8" />
                        <line x1="12" y1="3" x2="12" y2="15" />
                    </svg>
                </div>

                <p className={cn(
                    "text-white/70 light:text-slate-600 m-0 mb-1 font-medium",
                    isMobile ? "text-[15px]" : "text-sm"
                )}>
                    {isDragging ? 'Drop photos here' : isMobile ? 'Tap to add photos' : 'Drop photos or click to browse'}
                </p>

                <p className="text-white/40 light:text-slate-400 text-[11px] m-0">
                    GPS location and date will be extracted automatically
                </p>
            </div>

            {/* Pending photos preview */}
            {pending.length > 0 && (
                <div className="mt-4">
                    <div className="flex justify-between items-center mb-3">
                        <span className="text-xs text-white/70 light:text-slate-600 font-medium">
                            {pending.length} photo{pending.length !== 1 ? 's' : ''} ready
                        </span>
                        <Button
                            variant="primary"
                            size="sm"
                            onClick={uploadAll}
                        >
                            Upload All
                        </Button>
                    </div>

                    <div className={cn(
                        "grid gap-2",
                        isMobile ? "grid-cols-3" : "grid-cols-4"
                    )}>
                        {pending.map((item) => (
                            <div
                                key={item.id}
                                className="relative aspect-square rounded-lg overflow-hidden bg-white/5 light:bg-black/5"
                            >
                                <img
                                    src={item.previewUrl}
                                    alt="Preview"
                                    className="w-full h-full object-cover"
                                />

                                {/* Remove button */}
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        removePending(item.id);
                                    }}
                                    className={cn(
                                        "absolute top-1 right-1 rounded-full bg-black/60 border-none text-white",
                                        "cursor-pointer flex items-center justify-center text-sm",
                                        isMobile ? "w-7 h-7" : "w-6 h-6"
                                    )}
                                >
                                    ✕
                                </button>

                                {/* Metadata indicators */}
                                <div className="absolute bottom-0 left-0 right-0 p-1 bg-gradient-to-t from-black/70 to-transparent flex gap-1">
                                    {item.metadata.coordinates && (
                                        <div
                                            className="w-[18px] h-[18px] rounded-full bg-blue-500/80 flex items-center justify-center"
                                            title="Has GPS location"
                                        >
                                            <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5">
                                                <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z" />
                                                <circle cx="12" cy="10" r="3" />
                                            </svg>
                                        </div>
                                    )}
                                    {item.metadata.takenAt && (
                                        <div className="flex-1 text-[9px] text-white/80 overflow-hidden text-ellipsis whitespace-nowrap leading-[18px]">
                                            {formatDate(item.metadata.takenAt)}
                                        </div>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>

                    {/* Metadata summary */}
                    <div className="mt-3 p-2.5 bg-white/5 light:bg-black/5 rounded-lg text-[11px] text-white/40 light:text-slate-500 flex gap-4">
                        <span>
                            <span className="text-blue-400">
                                {pending.filter(p => p.metadata.coordinates).length}
                            </span>{' '}
                            with GPS
                        </span>
                        <span>
                            <span className="text-green-400">
                                {pending.filter(p => p.metadata.takenAt).length}
                            </span>{' '}
                            with date
                        </span>
                    </div>
                </div>
            )}

            {/* Upload progress */}
            {uploading.length > 0 && (
                <div className="mt-4">
                    <div className={cn(
                        "grid gap-2",
                        isMobile ? "grid-cols-3" : "grid-cols-4"
                    )}>
                        {uploading.map((item) => (
                            <div
                                key={item.id}
                                className="relative aspect-square rounded-lg overflow-hidden bg-white/5 light:bg-black/5"
                            >
                                <img
                                    src={item.previewUrl}
                                    alt="Uploading"
                                    className={cn(
                                        "w-full h-full object-cover",
                                        item.status === 'uploading' && "opacity-50"
                                    )}
                                />

                                {/* Status overlay */}
                                <div className={cn(
                                    "absolute inset-0 flex items-center justify-center",
                                    item.status === 'error' && "bg-red-500/30",
                                    item.status === 'done' && "bg-green-500/30",
                                    item.status === 'uploading' && "bg-black/30"
                                )}>
                                    {item.status === 'uploading' && (
                                        <div className="w-6 h-6 border-2 border-white/30 border-t-white/90 rounded-full animate-spin" />
                                    )}
                                    {item.status === 'done' && (
                                        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2.5">
                                            <polyline points="20 6 9 17 4 12" />
                                        </svg>
                                    )}
                                    {item.status === 'error' && (
                                        <button
                                            onClick={() => clearError(item.id)}
                                            className="bg-black/50 border-none rounded px-2 py-1 text-white text-[10px] cursor-pointer"
                                        >
                                            Failed - tap to dismiss
                                        </button>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}
