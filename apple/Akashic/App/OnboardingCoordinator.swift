import SwiftUI

/// Drives whether the first-run onboarding cover is showing. Owned by the app root and shared
/// through the environment so the "Replay intro" row deep in consumer Settings can re-present it
/// without any screen between them knowing about onboarding.
@MainActor
final class OnboardingCoordinator: ObservableObject {
    @Published var isPresented: Bool

    init(isPresented: Bool = OnboardingState.shouldShow()) {
        self.isPresented = isPresented
    }

    /// Finish or skip: remember it was seen and drop the cover.
    func finish() {
        OnboardingState.markSeen()
        isPresented = false
    }

    /// "Replay intro": clear the flag and show it again now.
    func replay() {
        OnboardingState.reset()
        isPresented = true
    }
}
