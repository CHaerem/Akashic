import SwiftUI

/// Debug settings: inspect and override the persistence mode.
///
/// The store is built once at launch (`PersistenceController.shared`), so changing the
/// override takes effect on the next launch. This is the manual escape hatch for flipping
/// the app onto a real CloudKit / local store during bring-up.
struct SettingsView: View {
    @EnvironmentObject private var store: JourneyStore
    @State private var override: PersistenceMode?
    @State private var showRelaunchNote = false

    var body: some View {
        Form {
            Section("Active store") {
                labelled("Mode", store.mode.label)
                labelled("Journeys loaded", "\(store.journeys.count)")
                labelled("CloudKit container", Config.cloudKitContainerIdentifier)
                labelled("CloudKit enabled (build flag)", FeatureFlags.cloudKitEnabled ? "Yes" : "No")
            }

            Section {
                Picker("Persistence mode", selection: Binding(
                    get: { override ?? store.mode },
                    set: { newValue in
                        override = newValue
                        Config.setPersistenceModeOverride(newValue)
                        showRelaunchNote = true
                    }
                )) {
                    ForEach(PersistenceMode.allCases) { Text($0.label).tag($0) }
                }
                .pickerStyle(.inline)

                Button("Clear override (follow build flag)") {
                    override = nil
                    Config.setPersistenceModeOverride(nil)
                    showRelaunchNote = true
                }
                .foregroundStyle(Theme.accent)
            } header: {
                Text("Override (debug)")
            } footer: {
                Text("CloudKit mode requires the Release-CloudKit build with entitlements and an iCloud account. Changes apply after relaunching the app.")
            }
        }
        .scrollContentBackground(.hidden)
        .background(Theme.background.ignoresSafeArea())
        .navigationTitle("Settings")
        .onAppear {
            if let raw = UserDefaults.standard.string(forKey: Config.persistenceModeOverrideKey) {
                override = PersistenceMode(rawValue: raw)
            }
        }
        .alert("Relaunch required", isPresented: $showRelaunchNote) {
            Button("OK", role: .cancel) {}
        } message: {
            Text("Quit and reopen Akashic for the new persistence mode to take effect.")
        }
    }

    private func labelled(_ title: String, _ value: String) -> some View {
        HStack {
            Text(title).foregroundStyle(Theme.textSecondary)
            Spacer()
            Text(value)
                .foregroundStyle(Theme.textPrimary)
                .multilineTextAlignment(.trailing)
        }
    }
}

#Preview {
    NavigationStack { SettingsView() }
        .environmentObject(JourneyStore(persistence: .preview))
        .preferredColorScheme(.dark)
}
