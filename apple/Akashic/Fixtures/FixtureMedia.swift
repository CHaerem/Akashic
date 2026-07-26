import Foundation

/// **Photographs for the bundled fixtures** (DIFF-10) — the photo half of the fixture pipeline, which
/// did not exist: `FixtureLoader` and `FixtureModels` between them contained not one occurrence of
/// the word "photo", so the once-ever demo journey a new paying customer sees on first launch had a
/// route, days and notes but **no photographs at all**, in a photo-memory app.
///
/// Two layers, deliberately split the way the rest of the codebase splits things:
///
///   * `photo(from:journey:...)` and `photos(from:journey:...)` are **pure** — fixture shape in,
///     domain `Photo` out, ids minted, day resolved, object keys computed. No file system.
///   * `stagePhotos(...)` is the thin I/O shell that copies bundled bytes into the media library and
///     stamps the resolved absolute path onto each `Photo`.
///
/// ## Why bytes have to be copied at all
/// `Photo` locates its bytes two ways (`Photo.resolveMedia`): the absolute `localOriginalPath`, and
/// failing that the R2-style relative key (`url`) re-resolved against `MediaLibrary.shared`. A file
/// inside the app bundle satisfies neither on its own — the bundle is not the media root — so the
/// bundled JPEG is copied to `<media root>/journeys/<journeyId>/photos/<photoId>.jpg`, exactly where
/// an ingested or imported photo would live. From that point on nothing in the app knows or cares
/// that these photos arrived from a fixture: the grid, the lightbox, the map markers, the story view
/// and the widget all read them through the same paths as real ones.
///
/// The copy is idempotent (skips a file already present at the destination), so re-seeding
/// `.fixtures` mode on every launch costs one `fileExists` per photo rather than a rewrite.
enum FixtureMedia {

    /// The sidecar manifest resource, without extension (`Fixtures/demo-media/demo-photos.json`).
    static let manifestResourceName = "demo-photos"

    struct MediaError: Error, CustomStringConvertible {
        let description: String
    }

    // MARK: - Manifest

    /// Decode the bundled photo manifest. Returns an **empty** manifest when the resource is absent or
    /// unreadable rather than throwing: a build that somehow shipped without the sidecar must still
    /// seed its journeys, just without photographs. (Fixture *journeys* are load-bearing and do throw;
    /// their photographs are not.)
    static func loadManifest(bundle: Bundle = .main) -> FixturePhotoManifest {
        guard let url = bundle.url(forResource: manifestResourceName, withExtension: "json"),
              let data = try? Data(contentsOf: url),
              let manifest = try? JSONDecoder().decode(FixturePhotoManifest.self, from: data)
        else { return FixturePhotoManifest(journeys: [:]) }
        return manifest
    }

    // MARK: - Pure mapping

    /// Map one fixture photo onto a domain `Photo` for `journey`.
    ///
    /// `idPrefix` is applied to the photo id for exactly the reason
    /// `PersistenceController.remapToDemoIdentity` prefixes journey and waypoint ids: a photo id is a
    /// CloudKit `recordName` (`MAPPING.md`: `Photo.recordName == photos.id`), so a seeded copy must
    /// never be able to collide with a record that could arrive by sync or share. The demo seed passes
    /// `"demo-"`; `.fixtures` dev mode, which never touches a syncable store, passes nothing.
    ///
    /// `journey` must already be in its final identity (post-remap) — `journeyId`, `waypointId` and
    /// the object key are all derived from it, so photos automatically follow the journey's ids.
    /// Returns nil only for a fixture entry with an empty id or file name.
    static func photo(from fixture: FixturePhoto,
                      journey: Journey,
                      idPrefix: String = "",
                      library: MediaLibrary = .shared) -> Photo? {
        guard !fixture.id.isEmpty, !fixture.file.isEmpty else { return nil }
        let photoId = idPrefix + fixture.id
        let ext = (fixture.file as NSString).pathExtension.lowercased()
        let waypointId = fixture.dayNumber.flatMap { dayNumber in
            journey.camps.first { $0.dayNumber == dayNumber }?.id
        }
        // No separate thumbnail is generated or bundled: `Photo.thumbnailFileURL` falls back to the
        // original, and these are already modest 1024px JPEGs. Bundling a second file per photo would
        // double the download for no visible difference at this scale.
        return Photo(
            id: photoId,
            journeyId: journey.id,
            waypointId: waypointId,
            url: library.relativeOriginalPath(journeyId: journey.id, photoId: photoId,
                                              ext: ext.isEmpty ? "jpg" : ext),
            thumbnailURL: nil,
            caption: fixture.caption,
            coordinates: fixture.coordinates
                ?? waypointId.flatMap { id in journey.camps.first { $0.id == id }?.coordinates },
            takenAt: fixture.takenAt,
            isHero: fixture.isHero ?? false,
            sortOrder: fixture.sortOrder ?? 0,
            rotation: 0,
            mediaType: "image",
            duration: nil,
            locationSource: fixture.coordinates == nil ? "estimated" : "exif",
            localOriginalPath: nil,
            localThumbPath: nil)
    }

    /// Pure batch form of `photo(from:...)`, dropping unusable entries.
    static func photos(from fixtures: [FixturePhoto],
                       journey: Journey,
                       idPrefix: String = "",
                       library: MediaLibrary = .shared) -> [Photo] {
        fixtures.compactMap { photo(from: $0, journey: journey, idPrefix: idPrefix, library: library) }
    }

    // MARK: - Staging (the I/O shell)

    /// Copy each photo's bundled bytes into `library` and return the photos with
    /// `localOriginalPath` resolved. A photo whose bundled file is missing is **dropped** rather than
    /// returned with a dead path — a broken-image placeholder in the demo is worse than one fewer
    /// photo.
    ///
    /// `fixtures` and the returned photos are paired by index against `photos(from:...)`, so this
    /// takes the fixture entries and does the mapping itself; that keeps the file-name → photo-id
    /// pairing in one place instead of asking the caller to zip two arrays.
    static func stagePhotos(_ fixtures: [FixturePhoto],
                            for journey: Journey,
                            idPrefix: String = "",
                            bundle: Bundle = .main,
                            library: MediaLibrary = .shared) -> [Photo] {
        guard !fixtures.isEmpty else { return [] }
        var staged: [Photo] = []
        for fixture in fixtures {
            guard var photo = photo(from: fixture, journey: journey,
                                    idPrefix: idPrefix, library: library),
                  let sourceURL = bundledFileURL(named: fixture.file, bundle: bundle)
            else { continue }
            let destination = library.absoluteURL(forRelative: photo.url)
            do {
                try copyIfNeeded(from: sourceURL, to: destination, journeyId: journey.id,
                                 library: library)
            } catch {
                // Never fatal: the store still gets its journey, just without this photograph.
                assertionFailure("Fixture photo staging failed for \(fixture.file): \(error)")
                continue
            }
            photo.localOriginalPath = destination.path
            staged.append(photo)
        }
        return staged
    }

    /// Locate a bundled fixture image. Resources are flattened into the bundle root by the copy-files
    /// phase, so the plain file name is the lookup; the directory-qualified form is tried too in case
    /// a future build preserves the folder.
    static func bundledFileURL(named file: String, bundle: Bundle) -> URL? {
        let name = (file as NSString).deletingPathExtension
        let ext = (file as NSString).pathExtension
        return bundle.url(forResource: name, withExtension: ext)
            ?? bundle.url(forResource: name, withExtension: ext, subdirectory: "demo-media")
    }

    private static func copyIfNeeded(from source: URL, to destination: URL,
                                     journeyId: String, library: MediaLibrary) throws {
        let fileManager = FileManager.default
        if fileManager.fileExists(atPath: destination.path) { return }
        try library.ensurePhotoDirectory(journeyId: journeyId)
        try fileManager.copyItem(at: source, to: destination)
    }
}
