import ImageIO
import SwiftUI
import UIKit
import AVKit

/// Reduce Transparency fallback for the lightbox's glass chrome buttons (both here and in
/// `ResolvingImagePage`'s loading/retry pills below). Fixed dark, not `Theme.surface` — the
/// backdrop underneath is fixed black in every appearance (see `PhotoLightboxView`'s doc
/// comment on why this viewer deliberately doesn't adapt to light/dark). Parallels
/// `MapPalette.overlaySurface` / `mapOverlayMaterial`, the map's own fixed-dark answer to the
/// same setting.
private let lightboxChromeOpaqueFill = Color.black.opacity(0.55)

/// Everything the lightbox needs, wrapped so it can drive `.fullScreenCover(item:)`.
struct LightboxData: Identifiable, Equatable {
    let id = UUID()
    let photos: [Photo]
    var startIndex: Int = 0
    var dayLabel: String?
    var dateLabel: String?

    static func == (lhs: LightboxData, rhs: LightboxData) -> Bool { lhs.id == rhs.id }
}

/// Full-screen photo/video pager: swipe between a day's media, pinch-zoom images, play
/// videos, read captions, swipe down to dismiss, and share the underlying local file.
///
/// When a `journey` is supplied the top bar gains an edit affordance (pencil) that opens the
/// contextual `PhotoEditSheet`; edits update the pager's local copy in place. Passing `nil`
/// (e.g. a read-only public context) hides all editing.
///
/// **Deliberately stays a fixed-dark viewer in both system appearances** — the black backdrop
/// and white chrome text/icons here are not routed through `Theme`, on purpose. This is the same
/// call A3 already made for the map and the globe: a full-screen photo/video pager is an
/// immersive viewer, not a page of chrome, and that's what Apple's own Photos app does too (its
/// lightbox stays black regardless of the system's light/dark setting). Making it "adapt" would
/// mean a white background flashing behind photos while they decode/load, which is worse, not
/// more correct. Reduce Transparency is a separate axis from light/dark, though, and still
/// applies here — see `lightboxChromeOpaqueFill` above.
struct PhotoLightboxView: View {
    let data: LightboxData
    var journey: Journey?
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var store: JourneyStore

    /// Local, mutable copy so caption/rotation/delete edits reflect without a round-trip.
    @State private var photos: [Photo]
    @State private var index: Int
    @State private var showChrome = true
    @State private var dragOffset: CGFloat = 0
    @State private var editingPhoto: Photo?
    @State private var editingIndex: Int = 0

    /// The chrome's circular icon buttons (edit / close / share) were sized to fit a fixed
    /// 40 pt glyph; scale the circle with the glyph (`.callout`, the old 16 pt) so it doesn't
    /// outgrow it — same reasoning as `DayDetailSheet.chevronBoxSize`.
    @ScaledMetric(relativeTo: .callout) private var iconButtonSize: CGFloat = 40

    init(data: LightboxData, journey: Journey? = nil) {
        self.data = data
        self.journey = journey
        _photos = State(initialValue: data.photos)
        _index = State(initialValue: min(max(data.startIndex, 0), max(data.photos.count - 1, 0)))
    }

    private var current: Photo? {
        photos.indices.contains(index) ? photos[index] : nil
    }

    private var allowsEditing: Bool { journey != nil }

    /// Backdrop fades out as the swipe-to-dismiss drag grows. Types are spelled out:
    /// mixing integer and floating-point literals here is ambiguous to older type
    /// checkers (Xcode 16 fails to compile it).
    private var backdropOpacity: Double {
        let dragSpan: CGFloat = 400
        let maxFade: CGFloat = 0.6
        return 1 - Double(min(abs(dragOffset) / dragSpan, maxFade))
    }

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()
                .opacity(backdropOpacity)

            pager
                .offset(y: dragOffset)

            if showChrome {
                VStack {
                    topBar
                    Spacer()
                    bottomBar
                }
            }
        }
        .statusBarHidden(true)
        .simultaneousGesture(dismissDrag)
        .onTapGesture {
            withAnimation(.easeInOut(duration: 0.2)) { showChrome.toggle() }
        }
        .sheet(item: $editingPhoto) { photo in
            if let journey {
                PhotoEditSheet(photo: photo, journey: journey) { updated in
                    applyEdit(updated)
                }
                .environmentObject(store)
            }
        }
    }

    // MARK: Pager

    private var pager: some View {
        TabView(selection: $index) {
            ForEach(Array(photos.enumerated()), id: \.element.id) { i, photo in
                Group {
                    if photo.isVideo {
                        VideoPage(photo: photo, fetcher: store.mediaFetcher)
                    } else {
                        // v2: the original lives on a PhotoMedia record in the excluded media zone,
                        // so it is streamed on demand. The thumbnail shows instantly; the full-res
                        // swaps in when ready, with a retry affordance on failure (MAPPING §13).
                        ResolvingImagePage(photo: photo, fetcher: store.mediaFetcher)
                    }
                }
                .tag(i)
            }
        }
        .tabViewStyle(.page(indexDisplayMode: .never))
        .ignoresSafeArea()
    }

    /// Reflect an edit sheet result into the local pager copy (nil = deleted).
    private func applyEdit(_ updated: Photo?) {
        guard photos.indices.contains(editingIndex) else { return }
        if let updated {
            photos[editingIndex] = updated
        } else {
            photos.remove(at: editingIndex)
            if photos.isEmpty { dismiss(); return }
            index = min(editingIndex, photos.count - 1)
        }
    }

    // MARK: Chrome

    private var topBar: some View {
        HStack(alignment: .top) {
            VStack(alignment: .leading, spacing: 4) {
                if let dayLabel = data.dayLabel {
                    Text(dayLabel)
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.white)
                        .padding(.horizontal, 10).padding(.vertical, 4)
                        .background(MapPalette.cyan.opacity(0.25), in: Capsule())
                }
                if let dateLabel = data.dateLabel {
                    Text(dateLabel)
                        .font(.footnote)
                        .foregroundStyle(.white.opacity(0.75))
                }
            }
            Spacer()
            HStack(spacing: 10) {
                if allowsEditing, let photo = current {
                    Button {
                        editingIndex = index
                        editingPhoto = photo
                    } label: {
                        Image(systemName: "slider.horizontal.3")
                            .font(.callout.weight(.bold))
                            .foregroundStyle(.white)
                            .frame(width: iconButtonSize, height: iconButtonSize)
                            .themedMaterial(Circle(), opaqueFill: lightboxChromeOpaqueFill)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Edit photo")
                }
                Button { dismiss() } label: {
                    Image(systemName: "xmark")
                        .font(.callout.weight(.bold))
                        .foregroundStyle(.white)
                        .frame(width: iconButtonSize, height: iconButtonSize)
                        .themedMaterial(Circle(), opaqueFill: lightboxChromeOpaqueFill)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Close")
            }
        }
        .padding(.horizontal, 16)
        .padding(.top, 8)
        .background(
            LinearGradient(colors: [.black.opacity(0.6), .clear],
                           startPoint: .top, endPoint: .bottom)
                .ignoresSafeArea(edges: .top)
        )
    }

    private var bottomBar: some View {
        VStack(spacing: 12) {
            if let caption = current?.caption, !caption.isEmpty {
                Text(caption)
                    .font(.subheadline)
                    .foregroundStyle(.white)
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: 520)
            }
            HStack {
                Text("\(index + 1) / \(photos.count)")
                    .font(.footnote.weight(.medium))
                    .foregroundStyle(.white.opacity(0.8))
                Spacer()
                if let url = current?.originalFileURL ?? current?.thumbnailFileURL {
                    ShareLink(item: url) {
                        Image(systemName: "square.and.arrow.up")
                            .font(.callout.weight(.semibold))
                            .foregroundStyle(.white)
                            .frame(width: iconButtonSize, height: iconButtonSize)
                            .themedMaterial(Circle(), opaqueFill: lightboxChromeOpaqueFill)
                    }
                    .accessibilityLabel("Share")
                }
            }
        }
        .padding(.horizontal, 20)
        .padding(.bottom, 24)
        .padding(.top, 24)
        .background(
            LinearGradient(colors: [.clear, .black.opacity(0.6)],
                           startPoint: .top, endPoint: .bottom)
                .ignoresSafeArea(edges: .bottom)
        )
    }

    // MARK: Swipe-down-to-dismiss (simultaneous so TabView paging still works)

    private var dismissDrag: some Gesture {
        DragGesture()
            .onChanged { value in
                // Only react to vertical-dominant drags so horizontal paging is untouched.
                if abs(value.translation.height) > abs(value.translation.width) * 1.5 {
                    dragOffset = value.translation.height
                }
            }
            .onEnded { value in
                if dragOffset > 140 || value.predictedEndTranslation.height > 300 {
                    dismiss()
                } else {
                    withAnimation(.spring(response: 0.3)) { dragOffset = 0 }
                }
            }
    }
}

// MARK: - On-demand original resolution (v2 media split)

/// Wraps `ZoomableImage` with on-demand original fetching. Shows the thumbnail immediately, streams
/// the full-resolution original via `MediaFetcher`, and swaps it in when ready. A fetch failure
/// leaves the thumbnail visible and offers a retry — never a blocking error. With no fetcher
/// (fixtures / non-CloudKit build) it simply uses whatever bytes are already on disk.
private struct ResolvingImagePage: View {
    let photo: Photo
    var fetcher: MediaFetcher?

    @State private var resolvedURL: URL?
    @State private var isLoading = false
    @State private var failed = false

    var body: some View {
        ZStack {
            ZoomableImage(url: resolvedURL ?? photo.thumbnailFileURL, rotation: photo.rotation)
            if isLoading {
                ProgressView()
                    .tint(.white)
                    .padding(10)
                    .themedMaterial(Circle(), opaqueFill: lightboxChromeOpaqueFill)
            } else if failed {
                Button {
                    Task { await resolve() }
                } label: {
                    Label("Retry", systemImage: "arrow.clockwise")
                        .font(.footnote.weight(.semibold))
                        .foregroundStyle(.white)
                        .padding(.horizontal, 14).padding(.vertical, 8)
                        .themedMaterial(Capsule(), opaqueFill: lightboxChromeOpaqueFill)
                }
                .buttonStyle(.plain)
            }
        }
        .task(id: photo.id) { await resolve() }
    }

    private func resolve() async {
        failed = false
        // Instant local hit, or no fetcher (fixtures) → use whatever is on disk.
        if let local = photo.originalFileURL { resolvedURL = local; return }
        guard let fetcher else { resolvedURL = photo.thumbnailFileURL; return }
        isLoading = true
        defer { isLoading = false }
        do {
            resolvedURL = try await fetcher.originalURL(for: photo)
        } catch {
            failed = true   // keep the thumbnail visible; the retry button is shown
        }
    }
}

// MARK: - Zoomable image

/// A single pinch-zoomable, pannable image loaded from a local file URL. Applies the stored
/// display `rotation` (0/90/180/270).
private struct ZoomableImage: View {
    let url: URL?
    var rotation: Int = 0

    @State private var scale: CGFloat = 1
    @State private var lastScale: CGFloat = 1
    @State private var offset: CGSize = .zero
    @State private var lastOffset: CGSize = .zero

    var body: some View {
        GeometryReader { geo in
            // A quarter turn exchanges width/height: fit the image into the swapped box first,
            // rotate, then re-frame to the container so it stays fit (not overflowing/clipped).
            let quarter = rotation == 90 || rotation == 270
            content
                .frame(width: quarter ? geo.size.height : geo.size.width,
                       height: quarter ? geo.size.width : geo.size.height)
                .rotationEffect(.degrees(Double(rotation)))
                .frame(width: geo.size.width, height: geo.size.height)
                .scaleEffect(scale)
                .offset(offset)
                .gesture(magnify)
                .simultaneousGesture(scale > 1 ? pan(in: geo.size) : nil)
                .onTapGesture(count: 2) { toggleZoom() }
                .animation(.easeInOut(duration: 0.2), value: scale)
        }
    }

    @State private var decoded: UIImage?
    @State private var decodeFailed = false

    @ViewBuilder
    private var content: some View {
        if let url {
            Group {
                if let decoded {
                    Image(uiImage: decoded).resizable().scaledToFit()
                } else if decodeFailed {
                    fallback(icon: "exclamationmark.triangle")
                } else {
                    ProgressView().tint(.white)
                }
            }
            // QUA-68: bounded decode instead of AsyncImage. AsyncImage decodes a local file at
            // FULL native resolution — a 24 MP HEIC is ~96 MB decoded, 48 MP ~190 MB — inside a
            // TabView(.page) that keeps neighbouring pages alive: several such bitmaps at once
            // is a realistic jetsam on 3–4 GB devices. StoryPDFRenderer.downscaledImage chose
            // CGImageSource thumbnails for exactly this reason; the lightbox now uses the same
            // pattern, keeping the full-resolution file only for ShareLink.
            .task(id: url) {
                decodeFailed = false
                decoded = await BoundedImageLoader.load(url: url)
                if decoded == nil { decodeFailed = true }
            }
        } else {
            fallback(icon: "icloud.and.arrow.down")
        }
    }

    private func fallback(icon: String) -> some View {
        Image(systemName: icon)
            .font(.largeTitle)
            .foregroundStyle(.white.opacity(0.4))
            .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var magnify: some Gesture {
        MagnifyGesture()
            .onChanged { value in
                scale = min(max(lastScale * value.magnification, 1), 4)
            }
            .onEnded { _ in
                lastScale = scale
                if scale <= 1 { resetPan() }
            }
    }

    private func pan(in container: CGSize) -> some Gesture {
        DragGesture()
            .onChanged { value in
                offset = CGSize(width: lastOffset.width + value.translation.width,
                                height: lastOffset.height + value.translation.height)
            }
            .onEnded { _ in
                // QUA-68: snap back inside the scaled bounds — a zoomed photo could be dragged
                // fully off-screen and "lost" behind black.
                withAnimation(.easeOut(duration: 0.2)) {
                    offset = LightboxImageMath.clampedPanOffset(offset, scale: scale, container: container)
                }
                lastOffset = offset
            }
    }

    private func toggleZoom() {
        if scale > 1 {
            scale = 1; lastScale = 1; resetPan()
        } else {
            scale = 2; lastScale = 2
        }
    }

    private func resetPan() {
        offset = .zero; lastOffset = .zero
    }
}

// MARK: - Video page

/// A video page backed by AVPlayer over the local file URL.
private struct VideoPage: View {
    let photo: Photo
    var fetcher: MediaFetcher?
    @State private var player: AVPlayer?
    @State private var isLoading = false
    @State private var failed = false

    var body: some View {
        Group {
            if let player {
                VideoPlayer(player: player)
                    .ignoresSafeArea()
            } else {
                ZStack {
                    Color.black
                    if isLoading {
                        ProgressView().tint(.white)
                    } else if failed {
                        // QUA-68: parity with ResolvingImagePage. This used to settle on a bare
                        // play.slash glyph over black, permanently, with no words, no retry and
                        // no accessibility label — a family member on hotel Wi-Fi who tapped a
                        // video hit a dead end while the image path had a labelled Retry pill.
                        VStack(spacing: 14) {
                            Image(systemName: "play.slash")
                                .font(.largeTitle)
                                .foregroundStyle(.white.opacity(0.4))
                                .accessibilityHidden(true)
                            Button {
                                Task { await load() }
                            } label: {
                                Label("Retry", systemImage: "arrow.clockwise")
                                    .font(.footnote.weight(.semibold))
                                    .foregroundStyle(.white)
                                    .padding(.horizontal, 14).padding(.vertical, 8)
                                    .themedMaterial(Capsule(), opaqueFill: lightboxChromeOpaqueFill)
                            }
                            .buttonStyle(.plain)
                        }
                        .accessibilityElement(children: .contain)
                        .accessibilityLabel("The video could not load")
                    } else {
                        Image(systemName: "play.slash")
                            .font(.largeTitle)
                            .foregroundStyle(.white.opacity(0.4))
                            .accessibilityLabel("Video unavailable")
                    }
                }
            }
        }
        // v2: the video original may live on a PhotoMedia record — resolve it on demand before
        // building the player (a local hit returns immediately with no download).
        .task(id: photo.id) { await load() }
        .onDisappear { player?.pause() }
    }

    private func load() async {
        guard player == nil else { return }
        failed = false
        if let url = photo.originalFileURL {
            player = AVPlayer(url: url)
            return
        }
        guard let fetcher else { return }
        isLoading = true
        defer { isLoading = false }
        do {
            let url = try await fetcher.originalURL(for: photo)
            player = AVPlayer(url: url)
        } catch {
            failed = true
        }
    }
}

// MARK: - Bounded decode + pan math (QUA-68)

/// Pure pan-clamp math, extracted for unit tests: at `scale`, a fitted image overhangs the
/// container by `(scale − 1) × side / 2` per edge — offsets beyond that show only black.
enum LightboxImageMath {
    static func clampedPanOffset(_ offset: CGSize, scale: CGFloat, container: CGSize) -> CGSize {
        let maxX = max(0, (scale - 1) * container.width / 2)
        let maxY = max(0, (scale - 1) * container.height / 2)
        return CGSize(width: min(max(offset.width, -maxX), maxX),
                      height: min(max(offset.height, -maxY), maxY))
    }
}

/// QUA-68: decode a local image at bounded pixel size, off the main actor.
/// `kCGImageSourceCreateThumbnailWithTransform` honours EXIF orientation, matching what
/// `AsyncImage` displayed; the app's own stored display `rotation` is applied by the view.
enum BoundedImageLoader {
    /// Sharp through 2× of the double-tap zoom on the largest current screens, hard-capped so a
    /// 48 MP original decodes to ≤ ~16 MP (~64 MB RGBA) instead of ~190 MB.
    static let maxPixelSize: CGFloat = 4096

    static func load(url: URL, maxPixelSize: CGFloat = BoundedImageLoader.maxPixelSize) async -> UIImage? {
        let boxed = url
        return await Task.detached(priority: .userInitiated) {
            let sourceOptions = [kCGImageSourceShouldCache: false] as CFDictionary
            guard let source = CGImageSourceCreateWithURL(boxed as CFURL, sourceOptions) else { return nil }
            let options = [
                kCGImageSourceCreateThumbnailFromImageAlways: true,
                kCGImageSourceCreateThumbnailWithTransform: true,
                kCGImageSourceShouldCacheImmediately: true,
                kCGImageSourceThumbnailMaxPixelSize: maxPixelSize,
            ] as CFDictionary
            guard let cg = CGImageSourceCreateThumbnailAtIndex(source, 0, options) else { return nil }
            return UIImage(cgImage: cg)
        }.value
    }
}
