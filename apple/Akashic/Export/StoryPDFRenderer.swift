import Foundation
import SwiftUI
import MapKit
import UIKit

/// DIFF-07 — draws a paginated `StoryBook` to a PDF.
///
/// Everything structural is explained on `StoryBook`; this file is the pixels half. Two constraints
/// drive its whole shape:
///   * **`ImageRenderer` is synchronous and gets no run loop**, so every photograph must already be a
///     decoded `UIImage` before drawing starts. Hence `resolveImages` runs first and the page views
///     take `UIImage` rather than a URL.
///   * **A SwiftUI `Map` renders blank** in that renderer, so the route page is an `MKMapSnapshotter`
///     image — which is asynchronous, and therefore also resolved up front.
///
/// Page size is A4 at 72 dpi (595 × 842 pt), the PDF default, because this is meant to be printable
/// by a person at home or handed to a print shop, and A4 is what both expect here.
@MainActor
struct StoryPDFRenderer {

    /// A4 at 72 dpi. Not US Letter: the audience is Norwegian.
    static let pageSize = CGSize(width: 595, height: 842)
    static let margin: CGFloat = 48

    /// Long side of a decoded photograph, in points. Thumbnails are 400 px, which is enough for a
    /// grid cell but visibly soft as a full-page image, so originals are preferred when on disk and
    /// downscaled to this — big enough to print acceptably, small enough that sixty of them do not
    /// exhaust memory.
    static let maxImageEdge: CGFloat = 1400

    /// Everything the pages need, resolved before a single page is drawn.
    struct Resolved {
        var images: [String: UIImage] = [:]
        var routeSnapshot: UIImage?
    }

    // MARK: - Public entry

    /// Render a journey to PDF data.
    ///
    /// `photosByDay` is the caller's selection, so a curated book is the same code path as a
    /// complete one — pass DIFF-04's best-of to get a book worth handing over.
    static func render(journey: Journey,
                       photosByDay: [Int: [Photo]],
                       heroPhoto: Photo?,
                       includeMap: Bool = true) async -> Data? {
        let pages = StoryPagination.pages(journey: journey,
                                          photosByDay: photosByDay,
                                          heroPhotoID: heroPhoto?.id,
                                          includeMap: includeMap)
        let all = photosByDay.values.flatMap { $0 } + [heroPhoto].compactMap { $0 }
        let resolved = await resolve(pages: pages, from: all, journey: journey,
                                     includeMap: includeMap)
        return draw(pages: pages, resolved: resolved)
    }

    // MARK: - Resolution (async, before any drawing)

    static func resolve(pages: [StoryPage],
                        from photos: [Photo],
                        journey: Journey,
                        includeMap: Bool) async -> Resolved {
        var resolved = Resolved()

        // Only what the pagination actually references — decoding a whole journey to draw sixty
        // images is the difference between a book and a jetsam.
        let needed = Set(StoryPagination.referencedPhotoIDs(pages))
        let byID = Dictionary(photos.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
        for id in needed {
            guard let photo = byID[id] else { continue }
            // Prefer the original: a 400 px thumbnail is visibly soft printed at page width.
            let url = photo.originalFileURL ?? photo.thumbnailFileURL
            guard let url, let image = downscaledImage(at: url, maxEdge: maxImageEdge) else { continue }
            resolved.images[id] = image
        }

        if includeMap, pages.contains(.map) {
            resolved.routeSnapshot = await routeSnapshot(journey: journey)
        }
        return resolved
    }

    /// Decode at a bounded size rather than loading full resolution and scaling afterwards —
    /// `kCGImageSourceThumbnailMaxPixelSize` never materialises the full bitmap, which is the whole
    /// point when a page may hold six of these.
    static func downscaledImage(at url: URL, maxEdge: CGFloat) -> UIImage? {
        guard let source = CGImageSourceCreateWithURL(url as CFURL, nil) else { return nil }
        let options: [CFString: Any] = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,   // honour EXIF orientation
            kCGImageSourceThumbnailMaxPixelSize: maxEdge,
        ]
        guard let cg = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary) else {
            return nil
        }
        return UIImage(cgImage: cg)
    }

    /// The route as a static image. `MKMapSnapshotter` rather than a SwiftUI `Map`, which renders
    /// blank inside `ImageRenderer`; the polyline is drawn over the snapshot by hand because a
    /// snapshotter renders base map only.
    static func routeSnapshot(journey: Journey) async -> UIImage? {
        let coords = journey.route.coordinates.compactMap { point -> CLLocationCoordinate2D? in
            guard point.count >= 2 else { return nil }
            return CLLocationCoordinate2D(latitude: point[1], longitude: point[0])
        }
        guard coords.count >= 2 else { return nil }

        let options = MKMapSnapshotter.Options()
        options.region = region(covering: coords)
        options.size = CGSize(width: pageSize.width - margin * 2,
                              height: pageSize.height * 0.55)
        options.mapType = .standard

        guard let snapshot = try? await MKMapSnapshotter(options: options).start() else { return nil }

        let renderer = UIGraphicsImageRenderer(size: options.size)
        return renderer.image { context in
            snapshot.image.draw(at: .zero)
            let path = UIBezierPath()
            for (index, coord) in coords.enumerated() {
                let point = snapshot.point(for: coord)
                index == 0 ? path.move(to: point) : path.addLine(to: point)
            }
            UIColor(red: 0.56, green: 0.62, blue: 1.0, alpha: 1.0).setStroke()  // Theme accent
            path.lineWidth = 3
            path.lineJoinStyle = .round
            path.stroke()
            _ = context
        }
    }

    /// Region covering every coordinate, with a margin so the polyline never touches the edge.
    static func region(covering coords: [CLLocationCoordinate2D]) -> MKCoordinateRegion {
        let lats = coords.map(\.latitude), lngs = coords.map(\.longitude)
        guard let minLat = lats.min(), let maxLat = lats.max(),
              let minLng = lngs.min(), let maxLng = lngs.max() else {
            return MKCoordinateRegion()
        }
        let center = CLLocationCoordinate2D(latitude: (minLat + maxLat) / 2,
                                           longitude: (minLng + maxLng) / 2)
        // A floor as well as padding: a single-day track spanning 200 m would otherwise zoom to
        // a meaningless close-up of one hillside.
        let span = MKCoordinateSpan(latitudeDelta: max((maxLat - minLat) * 1.4, 0.01),
                                    longitudeDelta: max((maxLng - minLng) * 1.4, 0.01))
        return MKCoordinateRegion(center: center, span: span)
    }

    // MARK: - Drawing

    static func draw(pages: [StoryPage], resolved: Resolved) -> Data? {
        guard !pages.isEmpty else { return nil }
        let bounds = CGRect(origin: .zero, size: pageSize)
        let renderer = UIGraphicsPDFRenderer(bounds: bounds)

        return renderer.pdfData { context in
            for (index, page) in pages.enumerated() {
                context.beginPage()
                let view = StoryPageView(page: page,
                                         resolved: resolved,
                                         pageNumber: index + 1,
                                         pageCount: pages.count)
                    .frame(width: pageSize.width, height: pageSize.height)
                let imageRenderer = ImageRenderer(content: view)
                imageRenderer.scale = 2      // 144 dpi effective: prints acceptably, stays modest
                imageRenderer.render { _, render in
                    render(context.cgContext)
                }
            }
        }
    }
}
