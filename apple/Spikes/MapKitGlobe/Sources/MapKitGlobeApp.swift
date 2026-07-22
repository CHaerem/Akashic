import SwiftUI

@main
struct MapKitGlobeApp: App {
    @StateObject private var model = AppModel(trek: TrekLoader.loadKilimanjaro())

    var body: some Scene {
        WindowGroup {
            ContentView(model: model)
                .preferredColorScheme(.dark)
                .statusBarHidden(true)
        }
    }
}
