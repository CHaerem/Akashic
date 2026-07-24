import SwiftUI
import PhotosUI

/// Native photo/video upload — counterpart to the web `PhotoUpload`. Multi-selects from the
/// system photo library, runs each item through `PhotoIngestService` (EXIF + 400px thumbnail
/// + file write under the R2 key scheme), suggests a day via `PhotoDayMatcher`, and lets the
/// user override the assignment before committing to the store.
///
/// Files are written during ingest (before commit) so the review list can show real thumbnails;
/// anything not committed is cleaned up on cancel.
struct PhotoImportSheet: View {
    @EnvironmentObject private var store: JourneyStore
    @EnvironmentObject private var entitlements: EntitlementStore
    @Environment(\.dismiss) private var dismiss

    let journey: Journey
    /// When launched from a specific day (DayDetailSheet "+"), new photos default to that day.
    var presetWaypointID: String?
    var onComplete: () -> Void = {}

    @State private var selection: [PhotosPickerItem] = []
    @State private var pending: [PendingIngest] = []
    @State private var isProcessing = false
    @State private var isCommitting = false
    @State private var committed = false
    @State private var errorMessage: String?
    /// After a partial import (free tier, owned journey over the photo cap): how many were left out.
    @State private var partialRemainder = 0
    @State private var showPaywall = false

    struct PendingIngest: Identifiable {
        let id: String
        var photo: Photo
        var waypointID: String?
    }

    var body: some View {
        EditSheetScaffold(
            title: "Add Media",
            saveTitle: pending.isEmpty ? "Add" : "Add \(pending.count)",
            saveDisabled: pending.isEmpty || isProcessing,
            isSaving: isCommitting,
            onCancel: cancel,
            onSave: commit
        ) {
            picker
            if isProcessing {
                HStack(spacing: 8) {
                    ProgressView().tint(Theme.accent)
                    Text("Processing…").font(.subheadline).foregroundStyle(Theme.textSecondary)
                }
            }
            if let errorMessage {
                Text(errorMessage).font(.footnote).foregroundStyle(.red)
            }
            if partialRemainder > 0 {
                partialImportBanner
            }
            if !pending.isEmpty {
                Text("\(pending.count) ready · tap a day to change the assignment")
                    .font(.caption).foregroundStyle(Theme.textTertiary)
                ForEach($pending) { $item in
                    reviewRow($item)
                }
            }
        }
        .onChange(of: selection) { _, items in
            guard !items.isEmpty else { return }
            Task { await process(items) }
        }
        .onDisappear { if !committed { cleanupUncommitted() } }
        .sheet(isPresented: $showPaywall) {
            PaywallView(reason: .photoLimit(remaining: partialRemainder))
                .environmentObject(entitlements)
        }
    }

    /// Shown after a free-tier partial import: what landed, what didn't, and the way to unlock the
    /// rest. Never a silent drop — the remainder is always named.
    private var partialImportBanner: some View {
        VStack(alignment: .leading, spacing: 8) {
            Label("\(partialRemainder) photo\(partialRemainder == 1 ? "" : "s") couldn't be added",
                  systemImage: "exclamationmark.triangle.fill")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(Theme.warning)
            Text("The free tier holds up to \(EntitlementPolicy.freePhotosPerOwnedJourney) photos per journey. "
                 + "We added the ones that fit. Akashic Complete lifts the cap so the rest can come too.")
                .font(.caption)
                .foregroundStyle(Theme.textSecondary)
            Button {
                showPaywall = true
            } label: {
                Label("Unlock with Akashic Complete", systemImage: "star.circle")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(Theme.accent)
            }
            .buttonStyle(.plain)
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.surface, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(Theme.hairline, lineWidth: 1))
    }

    // MARK: Picker

    private var picker: some View {
        PhotosPicker(
            selection: $selection,
            maxSelectionCount: 0,
            matching: .any(of: [.images, .videos]),
            photoLibrary: .shared()
        ) {
            HStack(spacing: 10) {
                Image(systemName: "photo.badge.plus")
                    .font(.title3).foregroundStyle(Theme.accent)
                Text(pending.isEmpty ? "Select photos or videos" : "Select more")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(Theme.textPrimary)
                Spacer()
            }
            .padding(16)
            .frame(maxWidth: .infinity)
            .background(Theme.surface, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .strokeBorder(Theme.accent.opacity(0.4), style: StrokeStyle(lineWidth: 1, dash: [5, 4]))
            )
        }
    }

    // MARK: Review row

    private func reviewRow(_ item: Binding<PendingIngest>) -> some View {
        HStack(spacing: 12) {
            EditablePhotoThumb(photo: item.wrappedValue.photo, size: 64)
            VStack(alignment: .leading, spacing: 4) {
                if item.wrappedValue.photo.isVideo {
                    Label("Video", systemImage: "play.circle").font(.caption).foregroundStyle(Theme.textSecondary)
                }
                if let coords = item.wrappedValue.photo.coordinates, coords.count >= 2 {
                    Label(String(format: "%.3f, %.3f", coords[1], coords[0]), systemImage: "mappin")
                        .font(.caption2).foregroundStyle(Theme.textTertiary)
                }
                dayMenu(item)
            }
            Spacer()
            Button {
                remove(item.wrappedValue)
            } label: {
                Image(systemName: "xmark.circle.fill").foregroundStyle(Theme.textTertiary)
            }
            .buttonStyle(.plain)
        }
        .padding(10)
        .background(Theme.surface, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(Theme.hairline, lineWidth: 1))
    }

    private func dayMenu(_ item: Binding<PendingIngest>) -> some View {
        Menu {
            Button {
                item.wrappedValue.waypointID = nil
            } label: {
                Label("Unassigned", systemImage: item.wrappedValue.waypointID == nil ? "checkmark" : "")
            }
            ForEach(journey.camps) { camp in
                Button {
                    item.wrappedValue.waypointID = camp.id
                } label: {
                    Label("Day \(camp.dayNumber) — \(camp.name)",
                          systemImage: item.wrappedValue.waypointID == camp.id ? "checkmark" : "")
                }
            }
        } label: {
            HStack(spacing: 4) {
                Image(systemName: "calendar").font(.caption2)
                Text(dayLabel(item.wrappedValue.waypointID)).font(.caption.weight(.medium))
                Image(systemName: "chevron.down").font(.system(size: 8))
            }
            .foregroundStyle(Theme.accent)
            .padding(.vertical, 4).padding(.horizontal, 8)
            .background(Theme.accentSoft, in: Capsule())
        }
    }

    private func dayLabel(_ waypointID: String?) -> String {
        guard let waypointID, let camp = journey.camps.first(where: { $0.id == waypointID }) else {
            return "Unassigned"
        }
        return "Day \(camp.dayNumber)"
    }

    // MARK: Ingest

    private func process(_ items: [PhotosPickerItem]) async {
        isProcessing = true
        errorMessage = nil
        defer { isProcessing = false; selection = [] }

        let service = PhotoIngestService()
        var order = store.nextPhotoSortOrder(forJourneyID: journey.id) + pending.count
        for pickerItem in items {
            do {
                let photo = try await service.ingest(pickerItem: pickerItem,
                                                     journeyId: journey.id, sortOrder: order)
                order += 1
                let suggested = presetWaypointID
                    ?? PhotoIngestService.suggestedWaypointId(for: photo, in: journey)
                pending.append(PendingIngest(id: photo.id, photo: photo, waypointID: suggested))
            } catch {
                errorMessage = error.localizedDescription
            }
        }
    }

    // MARK: Commit / cleanup

    private func commit() {
        guard !pending.isEmpty else { return }

        // Free-tier photo cap applies only to journeys the user OWNS; photos added to a journey
        // shared *into* this account are never gated (COMMERCIALIZATION-PLAN §5). Complete lifts
        // the cap entirely.
        let owned = store.isOwnedByCurrentUser(journeyID: journey.id)
        let existing = store.photos(forJourneyID: journey.id).count
        let allowed = owned
            ? entitlements.photosAllowed(currentCount: existing, adding: pending.count)
            : pending.count

        guard allowed < pending.count else {
            // Everything fits — the original path.
            isCommitting = true
            store.addIngestedPhotos(pending.map(materialize))
            committed = true
            onComplete()
            dismiss()
            return
        }

        // Over the free cap on an owned journey: import what fits, delete the rest's staged files
        // (never leave orphans on disk), and report the remainder with an upgrade path. Nothing is
        // silently dropped.
        let keep = Array(pending.prefix(allowed))
        let drop = Array(pending.suffix(pending.count - allowed))
        let service = PhotoEditService()
        for item in drop { service.deleteFiles(for: item.photo) }
        if !keep.isEmpty {
            store.addIngestedPhotos(keep.map(materialize))
            onComplete()
        }
        committed = true          // the kept photos are saved; the dropped ones already cleaned up
        pending = []
        partialRemainder = drop.count
    }

    /// Stamp a pending item's chosen day onto its photo for insertion.
    private func materialize(_ item: PendingIngest) -> Photo {
        var photo = item.photo
        photo.waypointId = item.waypointID
        return photo
    }

    private func remove(_ item: PendingIngest) {
        PhotoEditService().deleteFiles(for: item.photo)
        pending.removeAll { $0.id == item.id }
    }

    private func cancel() {
        cleanupUncommitted()
        dismiss()
    }

    private func cleanupUncommitted() {
        let service = PhotoEditService()
        for item in pending { service.deleteFiles(for: item.photo) }
        pending = []
    }
}
