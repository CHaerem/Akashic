/**
 * Photo upload component with drag-and-drop support and preview
 * Allows family members to collaboratively add photos to journeys
 * Enhanced for mobile with larger touch targets and metadata preview
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { uploadPhoto, type UploadResult } from '../../lib/media';
import { extractPhotoMetadata, type PhotoMetadata } from '../../lib/exif';
import { colors, radius, transitions } from '../../styles/liquidGlass';

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

        // Process files and extract metadata
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

        // Move all pending to uploading state
        const toUpload = pending.map(p => ({
            ...p,
            status: 'uploading' as const,
        }));

        setUploading(toUpload);
        setPending([]);

        // Upload each file
        for (const item of toUpload) {
            try {
                const result = await uploadPhoto(journeyId, item.file);

                // Combine upload result with extracted metadata
                const resultWithMetadata: UploadResult = {
                    ...result,
                    coordinates: item.metadata.coordinates,
                    takenAt: item.metadata.takenAt,
                };

                // Update status
                setUploading(prev => prev.map(u =>
                    u.id === item.id ? { ...u, status: 'done' } : u
                ));

                // Notify parent
                onUploadComplete(resultWithMetadata);

                // Remove after short delay to show success
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
                style={{
                    border: `2px dashed ${isDragging ? 'rgba(59, 130, 246, 0.6)' : 'rgba(255,255,255,0.2)'}`,
                    borderRadius: radius.lg,
                    padding: isMobile ? 24 : 32,
                    textAlign: 'center',
                    cursor: isUploading ? 'default' : 'pointer',
                    background: isDragging ? 'rgba(59, 130, 246, 0.1)' : 'transparent',
                    transition: `all ${transitions.fast}`,
                    opacity: isUploading ? 0.6 : 1,
                    pointerEvents: isUploading ? 'none' : 'auto',
                    minHeight: isMobile ? 80 : 'auto',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                }}
            >
                <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/jpeg,image/png,image/gif,image/webp,image/heic,image/heif"
                    multiple
                    onChange={handleFileChange}
                    style={{ display: 'none' }}
                />

                <div style={{
                    width: isMobile ? 48 : 40,
                    height: isMobile ? 48 : 40,
                    borderRadius: '50%',
                    background: 'rgba(255,255,255,0.1)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    marginBottom: 12,
                }}>
                    <svg width={isMobile ? 24 : 20} height={isMobile ? 24 : 20} viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.6)" strokeWidth="2">
                        <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
                        <polyline points="17 8 12 3 7 8" />
                        <line x1="12" y1="3" x2="12" y2="15" />
                    </svg>
                </div>

                <p style={{
                    color: colors.text.secondary,
                    fontSize: isMobile ? 15 : 14,
                    margin: 0,
                    marginBottom: 4,
                    fontWeight: 500,
                }}>
                    {isDragging ? 'Drop photos here' : isMobile ? 'Tap to add photos' : 'Drop photos or click to browse'}
                </p>

                <p style={{
                    color: colors.text.tertiary,
                    fontSize: 11,
                    margin: 0,
                }}>
                    GPS location and date will be extracted automatically
                </p>
            </div>

            {/* Pending photos preview */}
            {pending.length > 0 && (
                <div style={{ marginTop: 16 }}>
                    <div style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        marginBottom: 12,
                    }}>
                        <span style={{
                            fontSize: 12,
                            color: colors.text.secondary,
                            fontWeight: 500,
                        }}>
                            {pending.length} photo{pending.length !== 1 ? 's' : ''} ready
                        </span>
                        <button
                            onClick={uploadAll}
                            style={{
                                padding: isMobile ? '10px 20px' : '8px 16px',
                                fontSize: 13,
                                fontWeight: 500,
                                background: 'rgba(59, 130, 246, 0.8)',
                                border: 'none',
                                borderRadius: radius.md,
                                color: '#fff',
                                cursor: 'pointer',
                                transition: `all ${transitions.fast}`,
                            }}
                        >
                            Upload All
                        </button>
                    </div>

                    <div style={{
                        display: 'grid',
                        gridTemplateColumns: isMobile ? 'repeat(3, 1fr)' : 'repeat(4, 1fr)',
                        gap: 8,
                    }}>
                        {pending.map((item) => (
                            <div
                                key={item.id}
                                style={{
                                    position: 'relative',
                                    aspectRatio: '1',
                                    borderRadius: radius.md,
                                    overflow: 'hidden',
                                    background: 'rgba(255,255,255,0.05)',
                                }}
                            >
                                <img
                                    src={item.previewUrl}
                                    alt="Preview"
                                    style={{
                                        width: '100%',
                                        height: '100%',
                                        objectFit: 'cover',
                                    }}
                                />

                                {/* Remove button */}
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        removePending(item.id);
                                    }}
                                    style={{
                                        position: 'absolute',
                                        top: 4,
                                        right: 4,
                                        width: isMobile ? 28 : 24,
                                        height: isMobile ? 28 : 24,
                                        borderRadius: '50%',
                                        background: 'rgba(0,0,0,0.6)',
                                        border: 'none',
                                        color: '#fff',
                                        cursor: 'pointer',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        fontSize: 14,
                                    }}
                                >
                                    ✕
                                </button>

                                {/* Metadata indicators */}
                                <div style={{
                                    position: 'absolute',
                                    bottom: 0,
                                    left: 0,
                                    right: 0,
                                    padding: 4,
                                    background: 'linear-gradient(transparent, rgba(0,0,0,0.7))',
                                    display: 'flex',
                                    gap: 4,
                                }}>
                                    {item.metadata.coordinates && (
                                        <div
                                            style={{
                                                width: 18,
                                                height: 18,
                                                borderRadius: '50%',
                                                background: 'rgba(59, 130, 246, 0.8)',
                                                display: 'flex',
                                                alignItems: 'center',
                                                justifyContent: 'center',
                                            }}
                                            title="Has GPS location"
                                        >
                                            <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5">
                                                <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z" />
                                                <circle cx="12" cy="10" r="3" />
                                            </svg>
                                        </div>
                                    )}
                                    {item.metadata.takenAt && (
                                        <div
                                            style={{
                                                flex: 1,
                                                fontSize: 9,
                                                color: 'rgba(255,255,255,0.8)',
                                                overflow: 'hidden',
                                                textOverflow: 'ellipsis',
                                                whiteSpace: 'nowrap',
                                                lineHeight: '18px',
                                            }}
                                        >
                                            {formatDate(item.metadata.takenAt)}
                                        </div>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>

                    {/* Metadata summary */}
                    <div style={{
                        marginTop: 12,
                        padding: 10,
                        background: 'rgba(255, 255, 255, 0.03)',
                        borderRadius: radius.md,
                        fontSize: 11,
                        color: colors.text.tertiary,
                        display: 'flex',
                        gap: 16,
                    }}>
                        <span>
                            <span style={{ color: 'rgba(59, 130, 246, 0.9)' }}>
                                {pending.filter(p => p.metadata.coordinates).length}
                            </span>{' '}
                            with GPS
                        </span>
                        <span>
                            <span style={{ color: 'rgba(34, 197, 94, 0.9)' }}>
                                {pending.filter(p => p.metadata.takenAt).length}
                            </span>{' '}
                            with date
                        </span>
                    </div>
                </div>
            )}

            {/* Upload progress */}
            {uploading.length > 0 && (
                <div style={{ marginTop: 16 }}>
                    <div style={{
                        display: 'grid',
                        gridTemplateColumns: isMobile ? 'repeat(3, 1fr)' : 'repeat(4, 1fr)',
                        gap: 8,
                    }}>
                        {uploading.map((item) => (
                            <div
                                key={item.id}
                                style={{
                                    position: 'relative',
                                    aspectRatio: '1',
                                    borderRadius: radius.md,
                                    overflow: 'hidden',
                                    background: 'rgba(255,255,255,0.05)',
                                }}
                            >
                                <img
                                    src={item.previewUrl}
                                    alt="Uploading"
                                    style={{
                                        width: '100%',
                                        height: '100%',
                                        objectFit: 'cover',
                                        opacity: item.status === 'uploading' ? 0.5 : 1,
                                    }}
                                />

                                {/* Status overlay */}
                                <div style={{
                                    position: 'absolute',
                                    inset: 0,
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    background: item.status === 'error'
                                        ? 'rgba(255, 100, 100, 0.3)'
                                        : item.status === 'done'
                                            ? 'rgba(34, 197, 94, 0.3)'
                                            : 'rgba(0, 0, 0, 0.3)',
                                }}>
                                    {item.status === 'uploading' && (
                                        <div style={{
                                            width: 24,
                                            height: 24,
                                            border: '2px solid rgba(255,255,255,0.3)',
                                            borderTopColor: 'rgba(255,255,255,0.9)',
                                            borderRadius: '50%',
                                            animation: 'spin 1s linear infinite',
                                        }} />
                                    )}
                                    {item.status === 'done' && (
                                        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2.5">
                                            <polyline points="20 6 9 17 4 12" />
                                        </svg>
                                    )}
                                    {item.status === 'error' && (
                                        <button
                                            onClick={() => clearError(item.id)}
                                            style={{
                                                background: 'rgba(0,0,0,0.5)',
                                                border: 'none',
                                                borderRadius: radius.sm,
                                                padding: '4px 8px',
                                                color: '#fff',
                                                fontSize: 10,
                                                cursor: 'pointer',
                                            }}
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

            {/* CSS for spinner animation */}
            <style>{`
                @keyframes spin {
                    to { transform: rotate(360deg); }
                }
            `}</style>
        </div>
    );
}
