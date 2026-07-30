import SwiftUI

/// "Does this journey add up?" — the coherence findings, inside the sheet where they get corrected.
///
/// QUA-95. A section of `JourneyEditSheet` rather than a sheet of its own, for two reasons. The dates
/// and the day list this reports on are edited a few points above it, so a separate destination would
/// send someone away from the controls; and this screen already presents sheets, where **a fourth
/// presentation modifier on one view breaks presentation for the whole view** — a trap this project
/// has already paid for once. So nothing here presents anything: each row names the problem and says
/// where the fix lives.
struct JourneyCheckupSection: View {
    @EnvironmentObject private var store: JourneyStore
    let journey: Journey

    private var findings: [JourneyCoherence.Finding] {
        JourneyCoherence.findings(journey: journey, photos: store.photos(forJourneyID: journey.id))
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Does this add up?")
                .font(.headline)
                .foregroundStyle(Theme.textPrimary)

            if findings.isEmpty {
                Label {
                    Text("The dates, days and photo locations agree with each other.")
                        .font(.subheadline)
                        .foregroundStyle(Theme.textSecondary)
                } icon: {
                    Image(systemName: "checkmark.seal")
                        .foregroundStyle(Theme.accentText)
                }
                .accessibilityElement(children: .combine)
            } else {
                ForEach(findings) { finding in
                    row(finding)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    @ViewBuilder
    private func row(_ finding: JourneyCoherence.Finding) -> some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: finding.isDefect ? "exclamationmark.triangle.fill" : "questionmark.circle")
                .foregroundStyle(finding.isDefect ? Theme.warning : Theme.textSecondary)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Self.detail(finding)
                    .font(.subheadline)
                    .foregroundStyle(Theme.textPrimary)
                Self.remedy(finding)
                    .font(.caption)
                    .foregroundStyle(Theme.textSecondary)
            }
        }
        // Combined so VoiceOver reads the problem and its remedy as one item rather than as two
        // fragments with an icon between them.
        .accessibilityElement(children: .combine)
    }

    /// What is wrong, with its numbers. `Text` rather than `String` throughout so every one of these
    /// is extracted for localisation — a `String` here would silently ship English (QUA-06).
    static func detail(_ finding: JourneyCoherence.Finding) -> Text {
        switch finding {
        case let .datesExcludePhotos(outside, total, first, last):
            return Text("\(outside) of \(total) photos were taken outside these dates — they run \(first) to \(last).")
        case let .implausibleSpan(days):
            return Text("These dates describe a \(days)-day journey.")
        case let .duplicateDayNumbers(days):
            return Text("Two places share day \(days.map(String.init).formatted(.list(type: .and))), so photos cannot tell them apart.")
        case let .noDayAssignment(photos):
            return Text("None of the \(photos) photos is filed under a day.")
        case let .collapsedCoordinate(count, located, latitude, longitude):
            return Text("\(count) of \(located) located photos share one spot — \(latitude), \(longitude).")
        case let .noRealLocation(located):
            return Text("All \(located) locations are estimates; none came from the camera.")
        }
    }

    /// Where the fix lives. Named surfaces rather than a button, per the note on this type.
    static func remedy(_ finding: JourneyCoherence.Finding) -> Text {
        switch finding {
        case .datesExcludePhotos, .implausibleSpan:
            return Text("Correct the dates above.")
        case .duplicateDayNumbers:
            return Text("Give one of them a different day in the day list.")
        case .noDayAssignment:
            return Text("Photos are matched by position and time — check a photo's day in the Photos tab.")
        case .collapsedCoordinate:
            return Text("If they belong somewhere else, place them from the Photos tab.")
        case .noRealLocation:
            return Text("Nothing to correct unless the places are wrong — the camera recorded no GPS.")
        }
    }
}
