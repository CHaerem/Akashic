import SwiftUI

/// The shared middle section stack of a day: distance/ascent stats, the day's own notes (S3),
/// highlights, weather, fun facts, discoveries and the photo strip. Every section already
/// self-hides when its data is absent (see each subview) — this file just holds them together
/// so there is exactly one place that decides what a "day" is made of.
///
/// Used by both `DayDetailSheet` (which wraps this with its own chevron-nav header, edit bar and
/// day comments) and `JourneyStoryView`'s chapters (which have no modal chrome at all — just a
/// cover header, then one of these per day). S1's brief is explicit that the story view is
/// re-assembly of this stack against the web's `DayChapter`, not a new layout, so extracting it
/// here so both hosts render identical content is the point.
struct DayChapterSections: View {
    let camp: Camp
    let photos: [Photo]
    /// True only for the journey's owner — gates the notes field's write affordance (S3): a
    /// shared-in viewer reads the same notes but never sees an edit prompt.
    let isOwner: Bool
    var onNotesSave: (String) -> Void
    var onPhotoTap: (Int) -> Void
    /// Photo-strip edit hooks. nil in every read-only host (the story view); `DayDetailSheet`
    /// supplies both so its own photo strip stays exactly as editable as it is today.
    var onAddPhoto: (() -> Void)?
    var onEditPhoto: ((Photo) -> Void)?

    var body: some View {
        dayStats

        DayNotesField(notes: camp.notes, isOwner: isOwner, onSave: onNotesSave)

        if !camp.highlights.isEmpty {
            highlights
        }

        if let weather = camp.weather {
            WeatherRow(weather: weather)
        }

        if let facts = camp.funFacts, !facts.isEmpty {
            FunFactsCarousel(facts: facts)
        }

        DayDiscoveriesView(
            pointsOfInterest: camp.pointsOfInterest ?? [],
            historicalSites: camp.historicalSites ?? []
        )

        DayPhotoStrip(photos: photos, onTap: onPhotoTap, onAdd: onAddPhoto, onEditPhoto: onEditPhoto)
    }

    // MARK: - Day stats

    /// `StatChipRow`, not a plain `HStack` (which is what this was before extraction): the fourth
    /// chip — Elevation, e.g. Kilimanjaro's "2,812 m" — is exactly the case `StatChipRow`'s own
    /// doc comment calls out ("Kilimanjaro's Summit chip rendered as '5,89…'"). A bare `HStack`
    /// showed that same truncation the moment the story view put four chips on a real phone
    /// width instead of the sheet's slightly roomier presentation.
    /// Absent is "—", never 0 — the same rule the journey header follows. A journey drafted from
    /// photos has no per-day route distance and no elevation (photo EXIF altitude isn't persisted),
    /// so every chip here read "0 km / 0 m / 0 m": three measurements presented as having been taken
    /// and come back empty. Zero is only shown where it is a real measured value.
    private var dayStats: some View {
        StatChipRow(items: [
            .init(icon: "figure.walk",
                  value: camp.dayDistance > 0 ? Formatters.distanceKm(camp.dayDistance) : "—",
                  caption: "Distance"),
            .init(icon: "arrow.up.forward",
                  value: camp.elevationGainFromPrevious > 0 ? Formatters.meters(camp.elevationGainFromPrevious) : "—",
                  caption: "Ascent"),
        ] + (camp.elevationLossFromPrevious > 0 ? [
            StatChipRow.Item(icon: "arrow.down.forward", value: Formatters.meters(camp.elevationLossFromPrevious), caption: "Descent"),
        ] : []) + [
            .init(icon: "mountain.2",
                  value: camp.elevation > 0 ? Formatters.meters(camp.elevation) : "—",
                  caption: "Elevation"),
        ])
    }

    // MARK: - Highlights

    private var highlights: some View {
        VStack(alignment: .leading, spacing: 8) {
            SectionLabel(icon: "✨", title: "Highlights")
            VStack(alignment: .leading, spacing: 6) {
                ForEach(camp.highlights, id: \.self) { item in
                    HStack(alignment: .top, spacing: 8) {
                        Circle().fill(Theme.accent).frame(width: 5, height: 5).padding(.top, 6)
                        Text(item)
                            .font(.footnote)
                            .foregroundStyle(Theme.textSecondary)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
            }
        }
    }
}
