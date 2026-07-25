import SwiftUI
import PhotosUI
import UniformTypeIdentifiers

/// Phase 1 of journey creation (C1 — see `apple/Docs/DESIGN-PLAN.md`): "what do you have?" — three
/// large tappable cards, no text fields. Every path converges on `NewJourneySheet`'s review phase;
/// this view only decides HOW the user gets there. A photo pick or a parsed GPX file is handed back
/// through a closure so `NewJourneySheet` (which owns `JourneyDraft`) can apply it and switch phase —
/// this view never touches the draft itself.
///
/// A GPX parse failure is the one path that does NOT advance: the typed `GPXParseError` message is
/// shown right here, on the card, and the chooser stays on screen so the user can try another file
/// without losing the "what do you have?" framing.
struct NewJourneyChooser: View {
    /// Bound to the sheet's own picker selection, so the same `onChange(of: photoSelection)` that
    /// seeds days from photos today keeps doing exactly that — picking up the result is the sheet's
    /// job, not this view's.
    @Binding var photoSelection: [PhotosPickerItem]
    /// Called with a successfully parsed file; the sheet applies it to the draft and moves to review.
    var onGPXImported: (GPXFile) -> Void
    /// "Start with just a name" — straight to review, empty, with the name field focused.
    var onNameOnly: () -> Void
    var onCancel: () -> Void

    @State private var showingImporter = false
    @State private var isImportingGPX = false
    @State private var importError: String?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 16) {
                    photosCard
                    gpxCard
                    nameOnlyCard
                }
                .padding(20)
                .padding(.bottom, 40)
            }
            .background(Theme.background.ignoresSafeArea())
            .navigationTitle("New Journey")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel", action: onCancel)
                        .foregroundStyle(Theme.textSecondary)
                }
            }
        }
        .presentationBackground(Theme.background)
        .fileImporter(isPresented: $showingImporter,
                      allowedContentTypes: gpxContentTypes,
                      allowsMultipleSelection: false,
                      onCompletion: handleImport)
    }

    // MARK: Cards

    /// Visually promoted and listed first — the design review's top finding is that photos are how
    /// most families will actually start, so this is the path with the least friction between tap
    /// and a drafted trip.
    private var photosCard: some View {
        PhotosPicker(selection: $photoSelection,
                     maxSelectionCount: 0,
                     matching: .images,
                     photoLibrary: .shared()) {
            card(icon: "photo.on.rectangle.angled",
                 title: "Start from your photos",
                 subtitle: "Pick the trip's photos — Akashic drafts the days, route and map, and adds the photos.",
                 promoted: true)
        }
        .buttonStyle(.plain)
    }

    private var gpxCard: some View {
        Button {
            importError = nil
            showingImporter = true
        } label: {
            VStack(alignment: .leading, spacing: 8) {
                card(icon: "arrow.down.doc",
                     title: "Import a GPX route",
                     subtitle: "A track from Strava, Garmin, AllTrails or komoot.",
                     promoted: false,
                     isLoading: isImportingGPX)
                if let importError {
                    Text(importError)
                        .font(.footnote)
                        .foregroundStyle(Theme.warning)
                        .padding(.horizontal, 18)
                }
            }
        }
        .buttonStyle(.plain)
        .disabled(isImportingGPX)
    }

    private var nameOnlyCard: some View {
        Button(action: onNameOnly) {
            card(icon: "flag",
                 title: "Start with just a name",
                 subtitle: "Add the route, days and photos later — or draw the route by hand.",
                 promoted: false)
        }
        .buttonStyle(.plain)
    }

    /// One chooser card. `promoted` gives the photos card the filled accent surface the redesign
    /// calls for; the other two stay visually equal to each other — GPX and just-a-name are both
    /// ordinary, valid starting points, neither more "correct" than the other.
    private func card(icon: String, title: String, subtitle: String,
                       promoted: Bool, isLoading: Bool = false) -> some View {
        HStack(alignment: .top, spacing: 14) {
            ZStack {
                Circle()
                    .fill(promoted ? Theme.accent : Theme.accentSoft)
                    .frame(width: 48, height: 48)
                if isLoading {
                    // `promoted`'s circle is filled with the accent colour, so its foreground
                    // needs `Theme.onAccent` (fixed, always contrasts with `accent`) — not
                    // `Theme.background`, which now follows the system appearance and would
                    // render pale-on-pale in Light Mode exactly like the CTA buttons `onAccent`
                    // was introduced for.
                    ProgressView().tint(promoted ? Theme.onAccent : Theme.accent)
                } else {
                    Image(systemName: icon)
                        .font(.title3)
                        .foregroundStyle(promoted ? Theme.onAccent : Theme.accent)
                }
            }
            VStack(alignment: .leading, spacing: 4) {
                Text(title)
                    .font(.headline)
                    .foregroundStyle(Theme.textPrimary)
                Text(subtitle)
                    .font(.subheadline)
                    .foregroundStyle(Theme.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 0)
        }
        .padding(18)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(promoted ? Theme.accentSoft : Theme.surface,
                    in: RoundedRectangle(cornerRadius: 20, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 20, style: .continuous)
                .strokeBorder(promoted ? Theme.accent.opacity(0.5) : Theme.hairline,
                              lineWidth: promoted ? 1.5 : 1)
        )
    }

    // MARK: GPX import

    private var gpxContentTypes: [UTType] {
        var types: [UTType] = []
        if let gpx = UTType("com.topografix.gpx") { types.append(gpx) }
        if let byExtension = UTType(filenameExtension: "gpx") { types.append(byExtension) }
        types.append(.xml)
        return types
    }

    private func handleImport(_ result: Result<[URL], Error>) {
        switch result {
        case let .failure(error):
            importError = error.localizedDescription
        case let .success(urls):
            guard let url = urls.first else { return }
            importError = nil
            isImportingGPX = true
            Task {
                defer { isImportingGPX = false }
                do {
                    let file = try await GPXParser.parseSecurityScoped(url)
                    onGPXImported(file)
                } catch {
                    // Stay in the chooser: the typed `GPXParseError` message is shown right on the
                    // card so the user can pick a different file without losing this screen.
                    importError = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
                }
            }
        }
    }
}
