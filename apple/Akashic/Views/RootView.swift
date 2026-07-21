import SwiftUI

/// Top-level tab shell: Journeys, Map, Stats, Settings.
struct RootView: View {
    @EnvironmentObject private var store: JourneyStore
    @State private var selectedTab = 0
    @State private var journeysPath: [String] = []

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
            NavigationStack(path: $journeysPath) {
                JourneyListView()
            }
            .tabItem { Label("Journeys", systemImage: "mountain.2.fill") }
            .tag(0)

            NavigationStack {
                MapView()
            }
            .tabItem { Label("Map", systemImage: "map.fill") }
            .tag(1)

            NavigationStack {
                StatsTabView()
            }
            .tabItem { Label("Stats", systemImage: "chart.bar.fill") }
            .tag(2)

            NavigationStack {
                SettingsView()
            }
            .tabItem { Label("Settings", systemImage: "gearshape.fill") }
            .tag(3)
        }
        .onAppear(perform: applyLaunchEnvironment)
    }

    /// Deep-link seam for UI tests / screenshots, e.g.
    /// `AKASHIC_TAB=2` or `AKASHIC_OPEN=<journey id or slug>`.
    private func applyLaunchEnvironment() {
        let env = ProcessInfo.processInfo.environment
        if let raw = env["AKASHIC_TAB"], let tab = Int(raw), (0...3).contains(tab) {
            selectedTab = tab
        }
        if let key = env["AKASHIC_OPEN"],
           let match = store.journeys.first(where: { $0.id == key || $0.slug == key }) {
            selectedTab = 0
            journeysPath = [match.id]
        }
    }
}

#Preview {
    RootView().environmentObject(JourneyStore(persistence: .preview)).preferredColorScheme(.dark)
}
