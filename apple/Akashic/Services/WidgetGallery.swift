import SwiftUI

/// Debug-only harness that renders the widget views at (approximately) their real point sizes
/// on a home-screen-like backdrop, so the widget gallery can be screenshotted without the
/// long-press "Add Widget" flow (which is not scriptable via `simctl`).
///
/// Reachable from the app's existing launch seam: `AKASHIC_SCREEN=widgets`
/// (see `AkashicApp.rootScreen`). Renders each journey's small + medium widget.
struct WidgetGalleryHarness: View {
    let snapshots: [WidgetSnapshot]

    var body: some View {
        ScrollView {
            VStack(spacing: 26) {
                Text("WidgetKit — Journey Stats")
                    .font(.system(size: 15, weight: .semibold, design: .rounded))
                    .foregroundStyle(.white.opacity(0.75))
                    .padding(.top, 20)

                // Small + medium stacked per journey so both families fit the phone width
                // (a small + medium side-by-side is wider than any iPhone).
                ForEach(Array(snapshots.prefix(2).enumerated()), id: \.element.id) { _, snapshot in
                    VStack(spacing: 14) {
                        tile(snapshot, size: .medium, width: 338, height: 158)
                        tile(snapshot, size: .small, width: 158, height: 158)
                    }
                }
            }
            .frame(maxWidth: .infinity)
            .padding(.bottom, 40)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(
            LinearGradient(colors: [Color(red: 0.08, green: 0.09, blue: 0.13),
                                    Color.black],
                           startPoint: .top, endPoint: .bottom)
            .ignoresSafeArea())
    }

    private func tile(_ snapshot: WidgetSnapshot,
                      size: WidgetSizeClass,
                      width: CGFloat, height: CGFloat) -> some View {
        JourneyStatsWidgetView(snapshot: snapshot, size: size)
            .frame(width: width, height: height)
            .background(WidgetTheme.background)
            .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 22, style: .continuous)
                    .strokeBorder(.white.opacity(0.08), lineWidth: 1))
            .shadow(color: .black.opacity(0.5), radius: 14, y: 8)
    }
}

#Preview {
    WidgetGalleryHarness(snapshots: [WidgetPlaceholder.snapshot])
        .preferredColorScheme(.dark)
}
