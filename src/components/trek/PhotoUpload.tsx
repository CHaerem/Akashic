/**
 * Photo upload component with drag-and-drop support
 * Allows family members to collaboratively add photos to journeys
 */

import { useState, useCallback, useRef } from 'react';
import { uploadPhoto, type UploadResult } from '../../lib/media';
import { extractPhotoMetadata } from '../../lib/exif';

interface PhotoUploadProps {
    journeyId: string;
    onUploadComplete: (result: UploadResult) => void;
    onUploadError: (error: string) => void;
}

interface UploadingFile {
    file: File;
    progress: number;
    error?: string;
}

export function PhotoUpload({ journeyId, onUploadComplete, onUploadError }: PhotoUploadProps) {
    const [isDragging, setIsDragging] = useState(false);
    const [uploading, setUploading] = useState<UploadingFile[]>([]);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleFiles = useCallback(async (files: FileList | File[]) => {
        const fileArray = Array.from(files).filter(f =>
            f.type.startsWith('image/')
        );

        if (fileArray.length === 0) {
            onUploadError('No valid image files selected');
            return;
        }

        // Add files to uploading state
        setUploading(prev => [
            ...prev,
            ...fileArray.map(file => ({ file, progress: 0 }))
        ]);

        // Upload each file
        for (const file of fileArray) {
            try {
                // Extract EXIF metadata before upload
                const metadata = await extractPhotoMetadata(file);

                // Upload to R2 (using journey UUID)
                const result = await uploadPhoto(journeyId, file);

                // Combine upload result with extracted metadata
                const resultWithMetadata: UploadResult = {
                    ...result,
                    coordinates: metadata.coordinates,
                    takenAt: metadata.takenAt,
                };

                // Remove from uploading state
                setUploading(prev => prev.filter(u => u.file !== file));

                // Notify parent with metadata
                onUploadComplete(resultWithMetadata);
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : 'Upload failed';

                // Mark as failed
                setUploading(prev => prev.map(u =>
                    u.file === file ? { ...u, error: errorMessage } : u
                ));

                onUploadError(`Failed to upload ${file.name}: ${errorMessage}`);
            }
        }
    }, [journeyId, onUploadComplete, onUploadError]);

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
        // Reset input so same file can be selected again
        e.target.value = '';
    }, [handleFiles]);

    const clearError = useCallback((file: File) => {
        setUploading(prev => prev.filter(u => u.file !== file));
    }, []);

    const isUploading = uploading.some(u => !u.error);

    return (
        <div>
            {/* Drop zone */}
            <div
                onClick={handleClick}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                style={{
                    border: `2px dashed ${isDragging ? 'rgba(255,255,255,0.5)' : 'rgba(255,255,255,0.2)'}`,
                    borderRadius: 12,
                    padding: 32,
                    textAlign: 'center',
                    cursor: isUploading ? 'default' : 'pointer',
                    background: isDragging ? 'rgba(255,255,255,0.05)' : 'transparent',
                    transition: 'all 0.2s ease',
                    opacity: isUploading ? 0.6 : 1,
                    pointerEvents: isUploading ? 'none' : 'auto'
                }}
            >
                <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/jpeg,image/png,image/gif,image/webp"
                    multiple
                    onChange={handleFileChange}
                    style={{ display: 'none' }}
                />

                <div style={{
                    fontSize: 32,
                    marginBottom: 12,
                    opacity: 0.5
                }}>
                    {isUploading ? '...' : '+'}
                </div>

                <p style={{
                    color: 'rgba(255,255,255,0.6)',
                    fontSize: 14,
                    margin: 0,
                    marginBottom: 8
                }}>
                    {isUploading
                        ? 'Uploading...'
                        : isDragging
                            ? 'Drop photos here'
                            : 'Drop photos here or click to browse'}
                </p>

                <p style={{
                    color: 'rgba(255,255,255,0.3)',
                    fontSize: 11,
                    margin: 0
                }}>
                    JPEG, PNG, GIF, WebP up to 20MB
                </p>
            </div>

            {/* Upload progress / errors */}
            {uploading.length > 0 && (
                <div style={{ marginTop: 16 }}>
                    {uploading.map((item, index) => (
                        <div
                            key={`${item.file.name}-${index}`}
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                padding: '8px 12px',
                                background: item.error
                                    ? 'rgba(255,100,100,0.1)'
                                    : 'rgba(255,255,255,0.05)',
                                borderRadius: 8,
                                marginBottom: 8
                            }}
                        >
                            <span style={{
                                flex: 1,
                                fontSize: 12,
                                color: item.error
                                    ? 'rgba(255,150,150,0.9)'
                                    : 'rgba(255,255,255,0.7)',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap'
                            }}>
                                {item.file.name}
                                {item.error && ` - ${item.error}`}
                            </span>

                            {item.error ? (
                                <button
                                    onClick={() => clearError(item.file)}
                                    style={{
                                        background: 'none',
                                        border: 'none',
                                        color: 'rgba(255,255,255,0.4)',
                                        cursor: 'pointer',
                                        padding: 4,
                                        marginLeft: 8
                                    }}
                                >
                                    ✕
                                </button>
                            ) : (
                                <div style={{
                                    width: 16,
                                    height: 16,
                                    border: '2px solid rgba(255,255,255,0.3)',
                                    borderTopColor: 'rgba(255,255,255,0.8)',
                                    borderRadius: '50%',
                                    animation: 'spin 1s linear infinite',
                                    marginLeft: 8
                                }} />
                            )}
                        </div>
                    ))}
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
