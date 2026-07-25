import SwiftUI

/// Top-level shell. The signature globe experience (`GlobeExperienceView`) is now the
/// PRIMARY landing screen (tab 0) — it replaces the old flat journey list as the app's
/// front door, with the list still reachable via its "Journeys" button/sheet. Stats and
/// Settings remain as secondary tabs.
struct RootView: View {
    @EnvironmentObject private var store: JourneyStore
    @State private var selectedTab = 0

    /// The first-sync download prompt is published here when a fresh install's heavy pull is
    /// deferred by the Wi-Fi-only policy and a size estimate is available.
    @ObservedObject private var syncStatus = PersistenceController.shared.syncStatus
    @ObservedObject private var networkPolicy = NetworkPolicy.shared

    init() {
        // The app runs `.preferredColorScheme(.dark)`, so the system bars are already dark and
        // already the right material. Below iOS 26 they are flat, and an opaque fill matching the
        // night-sky palette reads better than the default grey; from iOS 26 the bars are Liquid
        // Glass, and forcing an opaque background fights the system — it suppressed the large
        // navigation title on the Settings screen (a blank band where the title belongs) and cost
        // scroll views the inset the floating tab bar needs, so the last row of Settings sat
        // half-hidden behind the tab pill. Leave the new bars alone.
        guard #unavailable(iOS 26) else { return }

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
        .sheet(isPresented: firstSyncPromptPresented) {
            if case let .prompt(_, summary) = syncStatus.firstSyncPrompt {
                FirstSyncDownloadPromptView(
                    estimateSummary: summary,
                    onWait: { syncStatus.firstSyncPrompt = nil },
                    onDownloadNow: {
                        // A one-occasion cellular pass for THIS download only — the global
                        // "Wi-Fi only" setting is left untouched.
                        networkPolicy.grantOneOccasionCellularDownload()
                        syncStatus.firstSyncPrompt = nil
                    })
                    .presentationDetents([.medium])
            }
        }
    }

    /// True while a `.prompt` decision is published; dismissing clears it.
    private var firstSyncPromptPresented: Binding<Bool> {
        Binding(
            get: { if case .prompt = syncStatus.firstSyncPrompt { return true } else { return false } },
            set: { if !$0 { syncStatus.firstSyncPrompt = nil } })
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

/// One-time first-sync sheet shown at the 5.4 GB moment: an honest estimate with a Wi-Fi
/// recommendation and an explicit cellular escape hatch. The default (and recommended) action is
/// to wait; choosing cellular grants a one-occasion pass, never a standing preference.
private struct FirstSyncDownloadPromptView: View {
    let estimateSummary: String
    let onWait: () -> Void
    let onDownloadNow: () -> Void

    var body: some View {
        VStack(spacing: 20) {
            Image(systemName: "icloud.and.arrow.down")
                .font(.system(size: 44))
                .foregroundStyle(Theme.accent)
                .padding(.top, 32)

            Text("About \(estimateSummary) to download")
                .font(.title3.weight(.semibold))
                .foregroundStyle(Theme.textPrimary)
                .multilineTextAlignment(.center)

            Text("Your photo archive downloads on this device's first sync. Downloading over "
                 + "cellular can use a large amount of data — waiting for Wi-Fi is recommended.")
                .font(.subheadline)
                .foregroundStyle(Theme.textSecondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 24)

            Spacer()

            VStack(spacing: 12) {
                Button(action: onWait) {
                    Text("Wait for Wi-Fi (recommended)")
                        .font(.headline)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 14)
                        .background(Theme.accent)
                        .foregroundStyle(Color.black)
                        .clipShape(RoundedRectangle(cornerRadius: 14))
                }
                Button(action: onDownloadNow) {
                    Text("Download now over cellular")
                        .font(.subheadline)
                        .foregroundStyle(Theme.textSecondary)
                }
            }
            .padding(.horizontal, 24)
            .padding(.bottom, 28)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Theme.background.ignoresSafeArea())
        .interactiveDismissDisabled()
    }
}

#Preview {
    RootView().environmentObject(JourneyStore(persistence: .preview)).preferredColorScheme(.dark)
}
