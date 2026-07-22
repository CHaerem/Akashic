import SwiftUI
import AVKit

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
                        VideoPage(photo: photo)
                    } else {
                        ZoomableImage(url: photo.originalFileURL ?? photo.thumbnailFileURL,
                                      rotation: photo.rotation)
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
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(.white)
                        .padding(.horizontal, 10).padding(.vertical, 4)
                        .background(MapPalette.cyan.opacity(0.25), in: Capsule())
                }
                if let dateLabel = data.dateLabel {
                    Text(dateLabel)
                        .font(.system(size: 13))
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
                            .font(.system(size: 16, weight: .bold))
                            .foregroundStyle(.white)
                            .frame(width: 40, height: 40)
                            .background(.ultraThinMaterial, in: Circle())
                    }
                    .buttonStyle(.plain)
                }
                Button { dismiss() } label: {
                    Image(systemName: "xmark")
                        .font(.system(size: 16, weight: .bold))
                        .foregroundStyle(.white)
                        .frame(width: 40, height: 40)
                        .background(.ultraThinMaterial, in: Circle())
                }
                .buttonStyle(.plain)
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
                    .font(.system(size: 14))
                    .foregroundStyle(.white)
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: 520)
            }
            HStack {
                Text("\(index + 1) / \(photos.count)")
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(.white.opacity(0.8))
                Spacer()
                if let url = current?.originalFileURL ?? current?.thumbnailFileURL {
                    ShareLink(item: url) {
                        Image(systemName: "square.and.arrow.up")
                            .font(.system(size: 16, weight: .semibold))
                            .foregroundStyle(.white)
                            .frame(width: 40, height: 40)
                            .background(.ultraThinMaterial, in: Circle())
                    }
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
                .simultaneousGesture(scale > 1 ? pan : nil)
                .onTapGesture(count: 2) { toggleZoom() }
                .animation(.easeInOut(duration: 0.2), value: scale)
        }
    }

    @ViewBuilder
    private var content: some View {
        if let url {
            AsyncImage(url: url) { phase in
                switch phase {
                case let .success(image):
                    image.resizable().scaledToFit()
                case .failure:
                    fallback(icon: "exclamationmark.triangle")
                case .empty:
                    ProgressView().tint(.white)
                @unknown default:
                    fallback(icon: "photo")
                }
            }
        } else {
            fallback(icon: "icloud.and.arrow.down")
        }
    }

    private func fallback(icon: String) -> some View {
        Image(systemName: icon)
            .font(.system(size: 40))
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

    private var pan: some Gesture {
        DragGesture()
            .onChanged { value in
                offset = CGSize(width: lastOffset.width + value.translation.width,
                                height: lastOffset.height + value.translation.height)
            }
            .onEnded { _ in lastOffset = offset }
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
    @State private var player: AVPlayer?

    var body: some View {
        Group {
            if let player {
                VideoPlayer(player: player)
                    .ignoresSafeArea()
            } else {
                ZStack {
                    Color.black
                    Image(systemName: "play.slash")
                        .font(.system(size: 40))
                        .foregroundStyle(.white.opacity(0.4))
                }
            }
        }
        .onAppear {
            if player == nil, let url = photo.originalFileURL {
                player = AVPlayer(url: url)
            }
        }
        .onDisappear { player?.pause() }
    }
}
