import SwiftUI
import CloudKit

/// "Shared with" screen for one journey: who has access, at what level, and the entry point
/// to CloudKit's own invitation sheet.
///
/// Everything here goes through `JourneySharingService`, so the view previews and unit-tests
/// against a fake without a container. The one piece that genuinely needs UIKit is the
/// invitation sheet itself (`CloudSharingSheet`).
struct JourneyShareView: View {
    let journeyID: String
    let journeyTitle: String
    let service: JourneySharingService

    @Environment(\.dismiss) private var dismiss

    @State private var state: JourneyShareState?
    @State private var isLoading = true
    @State private var errorMessage: String?
    @State private var shareToPresent: PresentedShare?
    @State private var isPreparingShare = false
    @State private var confirmStopSharing = false

    var body: some View {
        NavigationStack {
            Group {
                if isLoading {
                    ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
                        .accessibilityLabel("Reading who this journey is shared with")
                } else {
                    content
                }
            }
            .background(Theme.background.ignoresSafeArea())
            .navigationTitle("Sharing")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") { dismiss() }.tint(Theme.accent)
                }
            }
        }
        .task { await reload() }
        .sheet(item: $shareToPresent) { presented in
            CloudSharingSheet(share: presented.share,
                              containerIdentifier: Config.cloudKitContainerIdentifier,
                              title: journeyTitle)
                // Participants change while that sheet is open, so re-read on the way out.
                .onDisappear { Task { await reload() } }
        }
    }

    @ViewBuilder
    private var content: some View {
        List {
            if let errorMessage {
                Section {
                    Text(errorMessage)
                        .font(.footnote)
                        .foregroundStyle(Theme.warning)
                }
            }

            Section {
                if let state, state.isShared {
                    ForEach(state.participants) { participant in
                        participantRow(participant, canManage: state.isOwner)
                    }
                } else {
                    Text("Only you can see this journey.")
                        .font(.callout)
                        .foregroundStyle(Theme.textSecondary)
                }
            } header: {
                Text(state?.isShared == true ? "People" : "Not shared")
            }

            if state?.isOwner == true {
                Section {
                    Button {
                        Task { await presentInvitation() }
                    } label: {
                        HStack {
                            Label(state?.isShared == true ? "Invite more people" : "Invite people",
                                  systemImage: "person.badge.plus")
                            if isPreparingShare {
                                Spacer()
                                ProgressView()
                            }
                        }
                    }
                    .disabled(isPreparingShare)
                    // QUA-24: preparing a CKShare is a network round trip, and the spinner was the
                    // only sign of it. Announced as part of the label so the state is heard on the
                    // control itself rather than as a separate "in progress" with no subject.
                    .accessibilityLabel(isPreparingShare
                                        ? "Preparing the invitation"
                                        : (state?.isShared == true ? "Invite more people" : "Invite people"))
                    .accessibilityHint("Opens the system sheet for sending an invitation")

                    if state?.isShared == true {
                        Button(role: .destructive) {
                            confirmStopSharing = true
                        } label: {
                            Label("Stop sharing", systemImage: "person.2.slash")
                        }
                    }
                } footer: {
                    Text("Everyone you invite sees this journey's days, photos and comments. Editors can add photos and comments; viewers can only read.")
                }
            } else if state?.isShared == true {
                Section {
                    Text("This journey is shared with you. Only its owner can change who has access.")
                        .font(.footnote)
                        .foregroundStyle(Theme.textSecondary)
                }
            }
        }
        .scrollContentBackground(.hidden)
        .confirmationDialog("Stop sharing this journey?",
                            isPresented: $confirmStopSharing,
                            titleVisibility: .visible) {
            Button("Stop sharing", role: .destructive) { Task { await stopSharing() } }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("Everyone else loses access. Nothing is deleted — the journey stays yours, and copies already on their devices remain there.")
        }
    }

    @ViewBuilder
    private func participantRow(_ participant: ShareParticipant, canManage: Bool) -> some View {
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                Text(participant.displayName)
                    .font(.callout)
                HStack(spacing: 6) {
                    Text(participant.role.displayName)
                    if participant.acceptance == .pending {
                        Text("· Invited")
                    }
                }
                .font(.caption)
                .foregroundStyle(Theme.textSecondary)
            }
            // QUA-24: who has access and at what level is one fact about one person, and it is the
            // fact this screen exists to state. Three announcements — a name, a role, and a bare
            // "· Invited" — put the middot in the middle of the family's privacy settings.
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(participant.acceptance == .pending
                                ? Text("\(participant.displayName), \(participant.role.displayName), invitation not accepted yet")
                                : Text("\(participant.displayName), \(participant.role.displayName)"))
            Spacer()
            if canManage, participant.isMutable {
                Menu {
                    ForEach(ShareRole.assignable, id: \.self) { role in
                        Button {
                            Task { await setRole(role, for: participant) }
                        } label: {
                            if role == participant.role {
                                Label(role.displayName, systemImage: "checkmark")
                            } else {
                                Text(role.displayName)
                            }
                        }
                    }
                    Divider()
                    Button(role: .destructive) {
                        Task { await remove(participant) }
                    } label: {
                        Label("Remove access", systemImage: "person.badge.minus")
                    }
                } label: {
                    Image(systemName: "ellipsis.circle").tint(Theme.accent)
                }
                // An unlabelled glyph, once per participant, and the menu behind it can revoke
                // someone's access to the family's photos.
                .accessibilityLabel(Text("Manage \(participant.displayName)"))
                .accessibilityHint("Change their access level, or remove them")
            }
        }
    }

    // MARK: - Actions

    private func reload() async {
        isLoading = state == nil
        do {
            state = try await service.shareState(forJourneyID: journeyID)
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
        }
        isLoading = false
    }

    private func presentInvitation() async {
        isPreparingShare = true
        defer { isPreparingShare = false }
        do {
            let share = try await service.prepareShare(forJourneyID: journeyID, title: journeyTitle)
            shareToPresent = PresentedShare(share: share)
            // v2: also ensure the media-zone share and publish its URL onto the Journey record so
            // participants auto-accept and can stream originals on demand (MAPPING §13). Best-effort
            // and no-op outside the entitled build / for a journey we do not own.
            await PersistenceController.shared.ensureMediaShare(forJourneyID: journeyID, title: journeyTitle)
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func setRole(_ role: ShareRole, for participant: ShareParticipant) async {
        await mutate { try await service.setRole(role, forParticipant: participant.id, journeyID: journeyID) }
    }

    private func remove(_ participant: ShareParticipant) async {
        await mutate { try await service.removeParticipant(participant.id, journeyID: journeyID) }
    }

    private func stopSharing() async {
        await mutate { try await service.stopSharing(forJourneyID: journeyID) }
        // v2: stop the media-zone share too and clear the published URL (MAPPING §13).
        await PersistenceController.shared.stopMediaShare(forJourneyID: journeyID)
    }

    /// Run a mutation and re-read the truth from CloudKit afterwards. Deliberately no optimistic
    /// local update: a rejected permission change that the UI already drew would misrepresent
    /// who can see the family's photos, which is the one thing this screen must not get wrong.
    private func mutate(_ operation: () async throws -> Void) async {
        do {
            try await operation()
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
        }
        await reload()
    }
}

// MARK: - UIKit invitation sheet

/// `UICloudSharingController` is still the only way to send a CloudKit invitation — SwiftUI's
/// `ShareLink` can carry a `CKShare` but not create or manage one, and the system sheet is what
/// handles Messages/Mail delivery and the link itself.
struct CloudSharingSheet: UIViewControllerRepresentable {
    let share: CKShare
    let containerIdentifier: String
    let title: String

    func makeCoordinator() -> Coordinator { Coordinator(title: title) }

    func makeUIViewController(context: Context) -> UICloudSharingController {
        let container = CKContainer(identifier: containerIdentifier)
        let controller = UICloudSharingController(share: share, container: container)
        // Ownership is not transferable and public links are off (see `prepareShare`), so the
        // sheet offers exactly the two choices the family model has.
        controller.availablePermissions = [.allowPrivate, .allowReadWrite, .allowReadOnly]
        controller.delegate = context.coordinator
        return controller
    }

    func updateUIViewController(_ controller: UICloudSharingController, context: Context) {}

    final class Coordinator: NSObject, UICloudSharingControllerDelegate {
        /// The journey's own name, not prose — nothing to localise here.
        private let title: String
        init(title: String) { self.title = title }

        func itemTitle(for controller: UICloudSharingController) -> String? { title }

        func cloudSharingController(_ controller: UICloudSharingController,
                                    failedToSaveShareWithError error: Error) {
            SyncLog.error("share: failedToSaveShare \(error)")
        }
    }
}

/// `sheet(item:)` needs an `Identifiable`, and conforming `CKShare` itself would be a retroactive
/// conformance on a framework class — a landmine if Apple ever adds its own. A local wrapper
/// carries the identity instead.
struct PresentedShare: Identifiable {
    let share: CKShare
    var id: String { share.recordID.recordName }
}
