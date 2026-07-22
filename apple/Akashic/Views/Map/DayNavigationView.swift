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
                chevron("chevron.left", enabled: (selectedIndex ?? 0) > 0) {
                    controller.selectPrevDay()
                }
            }

            VStack(spacing: 1) {
                if let camp = selectedCamp {
                    Text("Day \(camp.dayNumber)")
                        .font(.system(size: 13, weight: .bold))
                        .foregroundStyle(Theme.textPrimary)
                    Text(camp.name)
                        .font(.system(size: 11))
                        .foregroundStyle(Theme.textSecondary)
                        .lineLimit(1)
                } else {
                    Text("\(camps.count) days")
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(MapPalette.cyan)
                    Text(journey.shortName)
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(Theme.textPrimary)
                        .lineLimit(1)
                }
            }
            .frame(maxWidth: .infinity)

            if selectedIndex != nil {
                chevron("chevron.right", enabled: (selectedIndex ?? 0) < camps.count - 1) {
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
        return Button {
            controller.selectDay(index)
        } label: {
            VStack(spacing: 1) {
                Text("Day \(camp.dayNumber)")
                    .font(.system(size: selected ? 12 : 11, weight: .bold))
                Text(camp.name.split(separator: " ").first.map(String.init) ?? camp.name)
                    .font(.system(size: 9))
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
        }
        .buttonStyle(.plain)
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
                .font(.system(size: 13, weight: .semibold))
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
        }
        .buttonStyle(.plain)
    }

    // MARK: - Bits

    private func chevron(_ system: String, enabled: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: system)
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(enabled ? Theme.textPrimary : Theme.textTertiary)
                .frame(width: 32, height: 32)
        }
        .buttonStyle(.plain)
        .disabled(!enabled)
    }
}
