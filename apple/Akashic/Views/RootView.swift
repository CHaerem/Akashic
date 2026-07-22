import SwiftUI

/// Top-level shell. The signature globe experience (`GlobeExperienceView`) is now the
/// PRIMARY landing screen (tab 0) — it replaces the old flat journey list as the app's
/// front door, with the list still reachable via its "Journeys" button/sheet. Stats and
/// Settings remain as secondary tabs.
struct RootView: View {
    @EnvironmentObject private var store: JourneyStore
    @State private var selectedTab = 0

    init() {
        // Dark, translucent tab + nav bars consistent with the night-sky palette.
        let appearance = UITabBarAppearance()
        appearance.configureWithOpaqueBackground()
        appearance.backgroundColor = UIColor(Theme.background)
        UITabBar.appearance().standardAppearance = appearance
        UITabBar.appearance().scrollEdgeAppearance = appearance

        let nav = UINavigationBarAppearance()
        nav.configureWithOpaqueBackground()
        nav.backgroundColor = UIColor(Theme.background)
        nav.titleTextAttributes = [.foregroundColor: UIColor.white]
        nav.largeTitleTextAttributes = [.foregroundColor: UIColor.white]
        UINavigationBar.appearance().standardAppearance = nav
        UINavigationBar.appearance().scrollEdgeAppearance = nav
    }

    var body: some View {
        TabView(selection: $selectedTab) {
            // Primary landing: the signature globe / trek map (full-bleed).
            GlobeExperienceView()
                .tabItem { Label("Explore", systemImage: "globe") }
                .tag(0)

            NavigationStack {
                StatsTabView()
            }
            .tabItem { Label("Stats", systemImage: "chart.bar.fill") }
            .tag(1)

            NavigationStack {
                SettingsView()
            }
            .tabItem { Label("Settings", systemImage: "gearshape.fill") }
            .tag(2)
        }
        .onAppear(perform: applyLaunchEnvironment)
    }

    /// Deep-link seam for UI tests / screenshots, e.g. `AKASHIC_TAB=1`.
    /// The globe's own scene control (`AKASHIC_SCENE` / `AKASHIC_JOURNEY` / `AKASHIC_OPEN`)
    /// is applied inside `GlobeExperienceView` via `TrekCameraController.applyLaunchScene`.
    private func applyLaunchEnvironment() {
        let env = ProcessInfo.processInfo.environment
        if let raw = env["AKASHIC_TAB"], let tab = Int(raw), (0...2).contains(tab) {
            selectedTab = tab
        }
    }
}

#Preview {
    RootView().environmentObject(JourneyStore(persistence: .preview)).preferredColorScheme(.dark)
}
