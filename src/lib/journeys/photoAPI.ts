/**
 * Photos.
 *
 * Reads and caption edits are supported on web; uploading, deleting and re-assigning
 * photos are native-only (D6) and the adapter returns a guarded no-op for those.
 */

export {
    fetchPhotos,
    getPhotosForWaypoint,
    createPhoto,
    updatePhoto,
    deletePhoto,
    assignPhotoToWaypoint,
} from './adapters/cloudkit/photoAdapter';
