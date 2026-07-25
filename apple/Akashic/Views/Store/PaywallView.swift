import SwiftUI

/// The "Akashic Complete" sheet (COMMERCIALIZATION-PLAN §4.4 + §5).
///
/// Shows what the unlock includes, the localized price from the loaded product, Purchase and
/// Restore buttons, and graceful loading/offline states (offline must not brick — it shows a
/// retry, never a dead sheet). No dark patterns: it is always dismissible, and it says plainly
/// what the free tier already includes.
///
/// It is entitlement-agnostic about *why* it was shown — the `reason` only tailors the one-line
/// header so the upsell is honest and specific to the moment (a create attempt, an export, a
/// publish, or the Settings row).
struct PaywallView: View {

    /// Why the paywall came up, so the header can be specific and kind.
    ///
    /// No `.export` / `.publish` case: plan §5 (revised) made both free-tier features — the one
    /// free journey is fully finishable, so neither action ever routes here anymore (see
    /// `JourneyExportSheet` / `JourneyShowcaseSheet`, which no longer gate on entitlement at all).
    /// The only wall left is unlimited journeys/photos.
    enum Reason: Equatable {
        case journeyLimit
        case photoLimit(remaining: Int)
        case enrich
        case settings

        var headline: String {
            switch self {
            case .journeyLimit: return "The free tier includes one journey"
            case .photoLimit: return "The free tier includes 100 photos per journey"
            case .enrich: return "Enrich journey is part of Akashic Complete"
            case .settings: return "Unlock everything, once"
            }
        }

        var subhead: String {
            switch self {
            case .journeyLimit:
                return "You've filled your free journey. Akashic Complete removes the limit — for your whole family."
            case let .photoLimit(remaining):
                if remaining > 0 {
                    return "We added the photos that fit. Akashic Complete lifts the 100-photo cap so the rest can come too."
                }
                return "This journey is at the free 100-photo cap. Akashic Complete lifts it — for your whole family."
            case .enrich:
                return "Let Akashic suggest weather, places and points of interest for an existing journey — with Akashic Complete. Correcting your own data is always free."
            case .settings:
                return "One purchase, no subscription — and it's shared with your family."
            }
        }
    }

    var reason: Reason = .settings

    @EnvironmentObject private var entitlements: EntitlementStore
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 24) {
                    hero
                    benefits
                    priceAndPurchase
                    restoreRow
                    legalRow
                }
                .padding(20)
                // D2: the benefit card and purchase button otherwise stretch full-width in the
                // iPad form sheet this presents in — this is a purchase surface, so an inflated,
                // unfamiliar layout is exactly the wrong place to look "off".
                .constrainedReadingWidth()
            }
            .scrollContentBackground(.hidden)
            .background(Theme.background.ignoresSafeArea())
            .navigationTitle("Akashic Complete")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Close") { dismiss() }.tint(Theme.accent)
                }
            }
            .onAppear { entitlements.resetPurchasePhase() }
            .onChange(of: entitlements.isComplete) { _, complete in
                // The moment the purchase (or restore) lands, get out of the user's way.
                if complete { dismiss() }
            }
        }
    }

    // MARK: Hero

    private var hero: some View {
        VStack(spacing: 12) {
            ZStack {
                Circle().fill(Theme.accentSoft).frame(width: 88, height: 88)
                Image(systemName: "star.circle.fill")
                    .font(.system(size: 44, weight: .semibold))
                    .foregroundStyle(Theme.accent)
            }
            Text(reason.headline)
                .font(.title2.weight(.bold))
                .foregroundStyle(Theme.textPrimary)
                .multilineTextAlignment(.center)
            Text(reason.subhead)
                .font(.subheadline)
                .foregroundStyle(Theme.textSecondary)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity)
        .padding(.top, 8)
    }

    // MARK: Benefits

    private var benefits: some View {
        // Export and showcase publishing are NOT listed here — plan §5 (revised) made both part
        // of the free tier (the one free journey is fully finishable). The only thing Akashic
        // Complete still unlocks is more journeys and more photos, for the whole family.
        VStack(alignment: .leading, spacing: 14) {
            benefitRow("infinity", "Unlimited journeys & photos",
                       "Create and keep as many trips as you like, with no photo cap.")
            benefitRow("person.2.fill", "Family Sharing",
                       "One purchase covers everyone in your Family Sharing group.")
        }
        .padding(18)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.surface, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 20, style: .continuous).strokeBorder(Theme.hairline, lineWidth: 1))
    }

    private func benefitRow(_ icon: String, _ title: String, _ detail: String) -> some View {
        HStack(alignment: .top, spacing: 14) {
            Image(systemName: icon)
                .font(.title3)
                .foregroundStyle(Theme.accent)
                .frame(width: 30)
            VStack(alignment: .leading, spacing: 3) {
                Text(title).font(.subheadline.weight(.semibold)).foregroundStyle(Theme.textPrimary)
                Text(detail).font(.caption).foregroundStyle(Theme.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 0)
        }
    }

    // MARK: Price + purchase

    /// Whether the priced purchase surface should be shown. NEVER for an already-entitled user —
    /// presenting a live "Unlock for <price>" button for something already owned is a wrong-state
    /// purchase surface (a reviewer red flag). (quality gate: paywall shown to existing owners.)
    static func showsPurchaseSurface(isComplete: Bool) -> Bool { !isComplete }

    @ViewBuilder
    private var priceAndPurchase: some View {
        VStack(spacing: 12) {
            if !Self.showsPurchaseSurface(isComplete: entitlements.isComplete) {
                alreadyCompleteRow
            } else {
                purchaseSurface
            }
        }
    }

    /// Shown when the viewer already owns Akashic Complete — a plain confirmation, never a buy button.
    private var alreadyCompleteRow: some View {
        VStack(spacing: 8) {
            Label("You have Akashic Complete", systemImage: "checkmark.seal.fill")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(Theme.accent)
            Text("Unlimited journeys and photos — shared with your Family Sharing group.")
                .font(.caption).foregroundStyle(Theme.textSecondary)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding(16)
        .background(Theme.surface, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
    }

    @ViewBuilder
    private var purchaseSurface: some View {
        VStack(spacing: 12) {
            switch entitlements.loadState {
            case .idle, .loading:
                ProgressView().tint(Theme.accent)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 8)

            case .loaded:
                if let product = entitlements.product {
                    purchaseButton(price: product.displayPrice)
                    Text("One-time purchase · no subscription")
                        .font(.caption2).foregroundStyle(Theme.textTertiary)
                } else {
                    // Store reachable but the product isn't configured yet — treat like offline.
                    unavailableRow
                }

            case let .failed(message):
                VStack(spacing: 8) {
                    Text("Couldn't reach the App Store.")
                        .font(.subheadline.weight(.semibold)).foregroundStyle(Theme.textPrimary)
                    Text(message).font(.caption).foregroundStyle(Theme.textSecondary)
                        .multilineTextAlignment(.center)
                    Button {
                        Task { await entitlements.loadProduct() }
                    } label: {
                        Label("Try again", systemImage: "arrow.clockwise")
                            .font(.subheadline.weight(.semibold))
                            .foregroundStyle(Theme.accent)
                    }
                }
                .frame(maxWidth: .infinity)
                .padding(16)
                .background(Theme.surface, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            }

            if case let .failed(message) = entitlements.purchasePhase {
                Text(message).font(.caption).foregroundStyle(Theme.warning)
                    .multilineTextAlignment(.center)
            }
            if entitlements.purchasePhase == .pending {
                Text("Waiting for approval — this can happen with Ask to Buy. You'll be unlocked automatically once it's approved.")
                    .font(.caption).foregroundStyle(Theme.textSecondary)
                    .multilineTextAlignment(.center)
            }
        }
    }

    private func purchaseButton(price: String) -> some View {
        Button {
            Task { await entitlements.purchase() }
        } label: {
            HStack(spacing: 8) {
                if isBusy(.purchasing) { ProgressView().tint(Theme.onAccent) }
                Text(isBusy(.purchasing) ? "Purchasing…" : "Unlock for \(price)")
                    .font(.headline)
                    .foregroundStyle(Theme.onAccent)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 15)
            .background(Theme.accent, in: Capsule())
        }
        .buttonStyle(.plain)
        .disabled(isBusy(.purchasing) || isBusy(.restoring))
    }

    private var unavailableRow: some View {
        VStack(spacing: 8) {
            Text("Akashic Complete isn't available here yet.")
                .font(.subheadline.weight(.semibold)).foregroundStyle(Theme.textPrimary)
            Text("Check your connection and try again.").font(.caption).foregroundStyle(Theme.textSecondary)
            Button {
                Task { await entitlements.loadProduct() }
            } label: {
                Label("Try again", systemImage: "arrow.clockwise")
                    .font(.subheadline.weight(.semibold)).foregroundStyle(Theme.accent)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(16)
        .background(Theme.surface, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
    }

    private var restoreRow: some View {
        Button {
            Task { await entitlements.restore() }
        } label: {
            HStack(spacing: 6) {
                if isBusy(.restoring) { ProgressView().tint(Theme.accent) }
                Text(isBusy(.restoring) ? "Restoring…" : "Restore purchases")
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(Theme.accent)
            }
        }
        .buttonStyle(.plain)
        .disabled(isBusy(.purchasing) || isBusy(.restoring))
    }

    private var legalRow: some View {
        HStack(spacing: 6) {
            Link("Terms", destination: AppInfo.termsURL)
            Text("·").foregroundStyle(Theme.textTertiary)
            Link("Privacy", destination: AppInfo.privacyURL)
        }
        .font(.caption)
        .tint(Theme.textSecondary)
        .padding(.top, 4)
    }

    private func isBusy(_ phase: EntitlementStore.PurchasePhase) -> Bool {
        entitlements.purchasePhase == phase
    }
}

#if DEBUG
#Preview {
    PaywallView(reason: .journeyLimit)
        .environmentObject(EntitlementStore.previewFree)
        .preferredColorScheme(.dark)
}
#endif
