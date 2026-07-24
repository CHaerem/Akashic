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

// On-demand full-size originals (photo architecture v2): a repacked Photo record
// keeps only its thumb; its original lives in a PhotoMedia record in the journey's
// media zone, resolved lazily here.
export { fetchOriginalUrl } from './adapters/cloudkit/mediaAdapter';
