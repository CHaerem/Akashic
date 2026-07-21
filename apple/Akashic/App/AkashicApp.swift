import SwiftUI

@main
struct AkashicApp: App {
    @StateObject private var store = JourneyStore()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(store)
                .preferredColorScheme(.dark)
                .tint(Theme.accent)
        }
    }
}
