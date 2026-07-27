/**
 * What the user sees after sharing photos into the installed web app.
 *
 * It used to offer "Upload N Photos": pick a journey, then for each file call
 * `uploadPhoto` (which throws — there is no R2 upload any more) and `createPhoto` (a
 * stubbed CloudKit write that returns `false`). On the happy path it cleared the shared
 * files and closed as though the photos had landed. Bringing photos in is native-only
 * (LEG-07), so this now says so, shows what was shared so the user can recognise it, and
 * offers only "Done" — which clears the queue, the one thing it can honestly do.
 *
 * The PWA share_target itself still exists in the manifest; retiring that entry is a
 * separate change (it lives outside this component).
 */

import { useState, useEffect, useCallback } from 'react';
import { getPendingSharedFiles, clearSharedFiles, type SharedFile } from '../lib/shareTarget';
import { NativeOnlyNotice } from './common/NativeOnlyNotice';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogFooter,
} from './ui/dialog';
import { Button } from './ui/button';

interface PhotoPreview {
    sharedFile: SharedFile;
    previewUrl: string;
}

interface ShareTargetModalProps {
    isOpen: boolean;
    onClose: () => void;
    /**
     * Kept for the caller. Nothing is uploaded here, so there is nothing to refetch and
     * this is never called.
     */
    onUploadComplete?: () => void;
}

export function ShareTargetModal({ isOpen, onClose }: ShareTargetModalProps) {
    const [photos, setPhotos] = useState<PhotoPreview[]>([]);
    const [error, setError] = useState<string | null>(null);

    // Load shared files for preview. No EXIF extraction: the metadata only ever fed the
    // upload, and reading it off every file is not free.
    useEffect(() => {
        if (!isOpen) return;

        let revoked = false;
        const created: string[] = [];

        async function loadSharedFiles() {
            try {
                const sharedFiles = await getPendingSharedFiles();
                if (revoked) return;

                const previews = sharedFiles.map((sf) => {
                    const previewUrl = URL.createObjectURL(sf.file);
                    created.push(previewUrl);
                    return { sharedFile: sf, previewUrl };
                });

                setPhotos(previews);
            } catch (err) {
                console.error('Failed to load shared files:', err);
                setError('Failed to load shared photos');
            }
        }

        loadSharedFiles();

        return () => {
            revoked = true;
            created.forEach((url) => URL.revokeObjectURL(url));
        };
    }, [isOpen]);

    const handleDismiss = useCallback(async () => {
        // Clearing the queue is the only write this modal can actually perform: it is
        // local IndexedDB, not CloudKit.
        await clearSharedFiles();
        photos.forEach(p => URL.revokeObjectURL(p.previewUrl));
        setPhotos([]);
        onClose();
    }, [photos, onClose]);

    return (
        <Dialog open={isOpen} onOpenChange={(open) => !open && handleDismiss()}>
            <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>Shared Photos</DialogTitle>
                    <DialogDescription>
                        {photos.length} photo{photos.length !== 1 ? 's' : ''} arrived here
                    </DialogDescription>
                </DialogHeader>

                <div className="flex flex-col gap-4">
                    {error && (
                        <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
                            {error}
                        </div>
                    )}

                    <NativeOnlyNotice what="Adding photos to a journey" />

                    {/* Photo grid — so the user can see which photos this was about */}
                    <div className="grid grid-cols-3 gap-2">
                        {photos.map((photo, index) => (
                            <div
                                key={photo.sharedFile.id}
                                className="relative aspect-square rounded-lg overflow-hidden bg-white/5"
                            >
                                <img
                                    src={photo.previewUrl}
                                    alt={`Photo ${index + 1}`}
                                    className="w-full h-full object-cover"
                                />
                            </div>
                        ))}
                    </div>
                </div>

                <DialogFooter>
                    <Button variant="primary" onClick={handleDismiss}>
                        Done
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
