import SwiftUI

extension Journey {
    /// A journey that exists but holds nothing yet: no route, no days. Legitimate — §4.1 keeps
    /// "no route yet" a valid state because photos-only trips exist — and it is the state EVERY new
    /// customer is in for their first minutes, which is why it needs its own answer rather than the
    /// content screens rendered over nothing.
    var isEmptyShell: Bool { route.coordinates.isEmpty && camps.isEmpty }
}

/// What to do next with a journey that has nothing in it yet.
///
/// Before this existed the app answered the question with silence: the globe flew into an empty
/// ocean, the detail screen showed a world-sized map thumbnail, four stat chips reading zero, and a
/// bare "Days" heading over nothing. Nothing was broken and there was nothing to do either — the
/// worst possible first impression for the one screen the beta gate measures ("≥7 of 10 families
/// complete a journey unaided").
///
/// The steps are supplied by the caller so each host offers only what it can actually do.
struct JourneyNextStepsCard: View {
    struct Step: Identifiable {
        var icon: String
        var title: LocalizedStringKey
        var subtitle: LocalizedStringKey
        var action: () -> Void
        /// The title was the identity; as a `LocalizedStringKey` it no longer can be, and the
        /// icon is the better choice anyway — it does not change between languages.
        var id: String { icon }
    }

    var title: LocalizedStringKey
    var message: LocalizedStringKey
    var steps: [Step] = []

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            VStack(alignment: .leading, spacing: 6) {
                Text(title)
                    .font(.title3.weight(.bold))
                    .foregroundStyle(Theme.textPrimary)
                Text(message)
                    .font(.subheadline)
                    .foregroundStyle(Theme.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            if !steps.isEmpty {
                VStack(spacing: 10) {
                    ForEach(steps) { step in
                        Button(action: step.action) {
                            HStack(spacing: 12) {
                                Image(systemName: step.icon)
                                    .font(.title3)
                                    .foregroundStyle(Theme.accent)
                                    .frame(width: 26)
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(step.title)
                                        .font(.subheadline.weight(.semibold))
                                        .foregroundStyle(Theme.textPrimary)
                                    Text(step.subtitle)
                                        .font(.caption2)
                                        .foregroundStyle(Theme.textTertiary)
                                        .fixedSize(horizontal: false, vertical: true)
                                }
                                Spacer(minLength: 8)
                                Image(systemName: "chevron.right")
                                    .font(.footnote)
                                    .foregroundStyle(Theme.textTertiary)
                            }
                            .padding(12)
                            .frame(maxWidth: .infinity)
                            .background(Theme.surfaceRaised, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous)
                                .strokeBorder(Theme.hairline, lineWidth: 1))
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
        }
        .padding(20)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.surface, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 20, style: .continuous)
            .strokeBorder(Theme.hairline, lineWidth: 1))
    }
}

/// The globe's version of the same message: one line and one way out, because the globe has no
/// editing surface of its own. Sized to sit where `DayNavigationView` would.
///
/// Unlike `JourneyNextStepsCard` above, this one only ever renders as a map overlay (see
/// `GlobeExperienceView`), so its text/hairline use the fixed-light `MapPalette` tones, not the
/// appearance-adaptive `Theme` ones — it sits on the immersive satellite map in both light and
/// dark, same as the rest of that screen's chrome.
struct JourneyNothingToShowPill: View {
    let journeyName: String
    var onOpen: () -> Void

    var body: some View {
        VStack(spacing: 10) {
            VStack(spacing: 2) {
                Text("Nothing to show yet")
                    .font(.system(size: 13, weight: .bold))
                    .foregroundStyle(MapPalette.label)
                Text("\(journeyName) has no route, days or photos")
                    .font(.system(size: 11))
                    .foregroundStyle(MapPalette.labelSecondary)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Button(action: onOpen) {
                Label("Open journey", systemImage: "arrow.up.forward.app")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(Theme.onAccent)
                    .padding(.vertical, 10)
                    .padding(.horizontal, 18)
                    .background(Theme.accent, in: Capsule())
            }
            .buttonStyle(.plain)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .frame(maxWidth: .infinity)
        .mapOverlayMaterial(RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous)
            .strokeBorder(MapPalette.hairline, lineWidth: 1))
        .padding(.horizontal, 12)
    }
}
