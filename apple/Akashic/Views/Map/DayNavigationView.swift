import SwiftUI

/// Bottom day-navigation overlay for trek mode — the MapKit port of the web's
/// `NavigationPill` + `DayPill`.
///
/// Semantics mirrored from the web:
///  - Overview mode shows "{N} days · {trek}" and a hint to start day 1.
///  - Day mode shows "Day X · Camp" with prev/next chevrons and left/right swipe.
///  - A scrollable Day 1…N pill strip (camp short-name under each number); the selected
///    day is the cyan active-segment colour, bigger + brighter.
///  - Overview + Globe buttons switch stage.
///
/// Styling follows the app's dark liquid-glass language: `.ultraThinMaterial` over a
/// #0B0B19 tint with a hairline border (matching `Theme`).
struct DayNavigationView: View {
    let journey: Journey
    @ObservedObject var controller: TrekCameraController

    /// Swipe threshold (points) to advance a day — mirrors the web's 50 px threshold.
    private let swipeThreshold: CGFloat = 50

    /// The chevrons were sized to fit a fixed 15 pt glyph; now that the glyph scales with
    /// Dynamic Type (`.subheadline`), the box around it needs to scale too or the glyph
    /// outgrows its layout slot and misaligns with the header text next to it. The tap
    /// target itself is handled separately below (44 pt minimum, invisible padding).
    @ScaledMetric(relativeTo: .subheadline) private var chevronBoxSize: CGFloat = 32

    private var selectedIndex: Int? { controller.selectedDayIndex }
    private var camps: [Camp] { journey.camps }
    private var selectedCamp: Camp? { selectedIndex.flatMap { camps.indices.contains($0) ? camps[$0] : nil } }

    var body: some View {
        VStack(spacing: 10) {
            header
            dayStrip
            controlRow
        }
        .padding(.horizontal, 12)
        .padding(.bottom, 6)
    }

    // MARK: - Header (collapsed pill)

    private var header: some View {
        HStack(spacing: 10) {
            if selectedIndex != nil {
                chevron("chevron.left", label: "Previous day", enabled: (selectedIndex ?? 0) > 0) {
                    controller.selectPrevDay()
                }
            }

            // 13/11 pt map to `.footnote`/`.caption2` — the closest semantic styles to the
            // original fixed sizes, keeping the same primary/secondary hierarchy.
            VStack(spacing: 1) {
                if let camp = selectedCamp {
                    Text("Day \(camp.dayNumber)")
                        .font(.footnote.weight(.bold))
                        .foregroundStyle(Theme.textPrimary)
                    Text(camp.name)
                        .font(.caption2)
                        .foregroundStyle(Theme.textSecondary)
                        .lineLimit(1)
                } else {
                    // "0 days" is what a journey with a route but no days used to announce.
                    Text(camps.isEmpty ? "No days yet" : "\(camps.count) days")
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(MapPalette.cyan)
                    Text(journey.shortName)
                        .font(.footnote.weight(.semibold))
                        .foregroundStyle(Theme.textPrimary)
                        .lineLimit(1)
                }
            }
            .accessibilityElement(children: .combine)
            .frame(maxWidth: .infinity)

            if selectedIndex != nil {
                chevron("chevron.right", label: "Next day", enabled: (selectedIndex ?? 0) < camps.count - 1) {
                    controller.selectNextDay()
                }
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
        .frame(maxWidth: .infinity)
        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .strokeBorder(Theme.hairline, lineWidth: 1)
        )
        .contentShape(Rectangle())
        .gesture(
            DragGesture(minimumDistance: 20)
                .onEnded { value in
                    guard selectedIndex != nil else { return }
                    if value.translation.width > swipeThreshold {
                        controller.selectPrevDay()      // swipe right → previous day
                    } else if value.translation.width < -swipeThreshold {
                        controller.selectNextDay()      // swipe left → next day
                    }
                }
        )
    }

    // MARK: - Day pill strip (Day 1…N)

    private var dayStrip: some View {
        ScrollViewReader { proxy in
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(camps.indices, id: \.self) { i in
                        dayPill(index: i, camp: camps[i])
                            .id(i)
                    }
                }
                .padding(.horizontal, 4)
                .padding(.vertical, 2)
            }
            .onChange(of: selectedIndex) { _, new in
                guard let new else { return }
                withAnimation(.easeInOut) { proxy.scrollTo(new, anchor: .center) }
            }
        }
    }

    private func dayPill(index: Int, camp: Camp) -> some View {
        let selected = selectedIndex == index
        // `.caption`/`.caption2` keeps the selected pill's "bigger + brighter" documented
        // emphasis; the camp short-name was 9 pt (below the `.caption2` floor) either way.
        return Button {
            controller.selectDay(index)
        } label: {
            VStack(spacing: 1) {
                Text("Day \(camp.dayNumber)")
                    .font(selected ? .caption.weight(.bold) : .caption2.weight(.bold))
                Text(camp.name.split(separator: " ").first.map(String.init) ?? camp.name)
                    .font(.caption2)
                    .lineLimit(1)
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 6)
            .foregroundStyle(selected ? .black : Theme.textPrimary)
            .background {
                if selected {
                    Capsule().fill(MapPalette.cyan.opacity(0.9))
                } else {
                    Capsule().fill(.ultraThinMaterial)
                        .overlay(Capsule().strokeBorder(Theme.hairline, lineWidth: 1))
                }
            }
            // The capsule stays its drawn size; this only widens the tappable box (~29 pt
            // tall today) to the 44 pt HIG minimum, centred around the same visual pill.
            .frame(minWidth: 44, minHeight: 44)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Day \(camp.dayNumber), \(camp.name)")
        .accessibilityAddTraits(selected ? .isSelected : [])
    }

    // MARK: - Control row

    private var controlRow: some View {
        HStack(spacing: 10) {
            controlButton("Overview", system: "scope", active: selectedIndex == nil) {
                controller.showOverview()
            }
            controlButton("Globe", system: "globe", active: false) {
                controller.returnToGlobe()
            }
        }
    }

    private func controlButton(_ title: String, system: String, active: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Label(title, systemImage: system)
                .font(.footnote.weight(.semibold))
                .padding(.horizontal, 16)
                .padding(.vertical, 9)
                .foregroundStyle(active ? .black : Theme.textPrimary)
                .background {
                    if active {
                        Capsule().fill(MapPalette.cyan.opacity(0.9))
                    } else {
                        Capsule().fill(.ultraThinMaterial)
                            .overlay(Capsule().strokeBorder(Theme.hairline, lineWidth: 1))
                    }
                }
                .frame(minWidth: 44, minHeight: 44)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(active ? .isSelected : [])
    }

    // MARK: - Bits

    private func chevron(_ system: String, label: String, enabled: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: system)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(enabled ? Theme.textPrimary : Theme.textTertiary)
                .frame(width: chevronBoxSize, height: chevronBoxSize)
                .frame(minWidth: 44, minHeight: 44)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(!enabled)
        .accessibilityLabel(label)
    }
}
