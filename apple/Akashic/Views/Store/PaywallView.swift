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

        /// `LocalizedStringKey`, not `String`. Both of these go straight into a `Text`, and a
        /// `String` there is displayed verbatim — so the entire paywall, the one screen that has to
        /// persuade someone to pay, was untranslatable while the store listing selling it was
        /// Norwegian-first.
        var headline: LocalizedStringKey {
            switch self {
            case .journeyLimit: return "The free tier includes one journey"
            case .photoLimit: return "The free tier includes 100 photos per journey"
            case .enrich: return "Enrich journey is part of Akashic Complete"
            case .settings: return "Unlock everything, once"
            }
        }

        var subhead: LocalizedStringKey {
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
                        .accessibilityIdentifier(A11yID.paywallClose)
                }
            }
            .onAppear { entitlements.resetPurchasePhase() }
            // A2 (QUA-18): `.success` rather than `.selection` — this is the one moment in the app
            // that is an event rather than a nudge, and the sheet dismisses immediately afterwards,
            // so the haptic is the only confirmation the purchase landed at all.
            .sensoryFeedback(.success, trigger: entitlements.isComplete) { was, now in
                !was && now
            }
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
                    .foregroundStyle(Theme.accentText)
            }
            // QUA-24: the badge is ornament. Left visible it announces "star, circle, fill" as the
            // first thing on the purchase screen, ahead of the sentence that explains why the
            // screen appeared.
            .accessibilityHidden(true)
            Text(reason.headline)
                .font(.title2.weight(.bold))
                .foregroundStyle(Theme.textPrimary)
                .multilineTextAlignment(.center)
                .accessibilityAddTraits(.isHeader)
                // QUA-10: the headline is the only thing on the sheet that says WHY it appeared,
                // so it is what a test asserts to prove the right `reason` was routed. See `A11yID`.
                .accessibilityIdentifier(A11yID.paywallHeadline)
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
        // of the free tier (the one free journey is fully finishable).
        //
        // Akashic Intelligence IS listed (QUA-22). It was missing while `entitlements.isComplete`
        // already gated three working features, so the paywall was selling half of what the
        // purchase unlocks — and once DOC-08 put it in the store description and the IAP
        // description, launch-checklist Phase C's requirement that those three agree was broken.
        // It is listed last and hedged, because it needs Apple Intelligence hardware: promising it
        // flatly to someone whose phone cannot run it would be the opposite problem.
        VStack(alignment: .leading, spacing: 14) {
            benefitRow("infinity", "Unlimited journeys & photos",
                       "Create and keep as many trips as you like, with no photo cap.")
            benefitRow("person.2.fill", "Family Sharing",
                       "One purchase covers everyone in your Family Sharing group.")
            benefitRow("sparkles", "Akashic Intelligence",
                       "Draft a day's notes, name your days and ground your facts — on your device, on iPhone models that support Apple Intelligence.")
        }
        .padding(18)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.surface, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 20, style: .continuous).strokeBorder(Theme.hairline, lineWidth: 1))
    }

    private func benefitRow(_ icon: String, _ title: LocalizedStringKey, _ detail: LocalizedStringKey) -> some View {
        HStack(alignment: .top, spacing: 14) {
            Image(systemName: icon)
                .font(.title3)
                .foregroundStyle(Theme.accentText)
                .frame(width: 30)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 3) {
                Text(title).font(.subheadline.weight(.semibold)).foregroundStyle(Theme.textPrimary)
                Text(detail).font(.caption).foregroundStyle(Theme.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 0)
        }
        // QUA-24: one benefit is one thing, not two announcements — a heading followed by an
        // orphaned sentence makes the buyer swipe twice to hear one claim, and three times over the
        // three benefits is how a purchase screen becomes tiring to read.
        .accessibilityElement(children: .combine)
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
                .foregroundStyle(Theme.accentText)
            Text("Unlimited journeys and photos — shared with your Family Sharing group.")
                .font(.caption).foregroundStyle(Theme.textSecondary)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding(16)
        .background(Theme.surface, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier(A11yID.paywallAlreadyComplete)
    }

    @ViewBuilder
    private var purchaseSurface: some View {
        VStack(spacing: 12) {
            switch entitlements.loadState {
            case .idle, .loading:
                ProgressView().tint(Theme.accent)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 8)
                    // A bare `ProgressView` announces "in progress" with no subject. On this screen
                    // the subject is the only thing that matters: is the price coming, or is the
                    // sheet stuck?
                    .accessibilityLabel("Loading the price")

            case .loaded:
                if let product = entitlements.product {
                    purchaseButton(price: product.displayPrice)
                    // QUA-17: the anchor, which is the plan's own argument for the price and was
                    // missing from the one surface that gets a single shot at making it. The buyer's
                    // real alternative is not another app, it is a printed photo book at several
                    // hundred kroner *per trip* — so the comparison is the sentence, not the number.
                    // Deliberately no figure for the book: quoting a competitor's price in-app would
                    // go stale and invites a claim we would have to keep true.
                    Text("One-time purchase · no subscription")
                        .font(.caption2).foregroundStyle(Theme.textTertiary)
                    Text("Less than half the price of one printed photo book — for every trip your family ever takes.")
                        .font(.caption2)
                        .foregroundStyle(Theme.textSecondary)
                        .multilineTextAlignment(.center)
                        .fixedSize(horizontal: false, vertical: true)
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
                            .foregroundStyle(Theme.accentText)
                    }
                    // "Try again" alone does not say at what — and this is the offline state, where
                    // the user is already guessing.
                    .accessibilityLabel("Try loading the price again")
                    .accessibilityIdentifier(A11yID.paywallRetry)
                    // QUA-29: same sub-44 pt hit target as `unavailableRow`'s retry below — this is
                    // the `.failed(message)` branch of the same "the store is unreachable" state.
                    .frame(minHeight: 44)
                    .contentShape(Rectangle())
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
        // Names the product, not just the price. "Unlock for 99 kr" read on its own is a price with
        // no subject; this is the one control on the screen that spends money, so it says what it
        // buys. The spinner beside the text is hidden by `children: .ignore`.
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(isBusy(.purchasing)
                            ? Text("Purchasing Akashic Complete")
                            : Text("Unlock Akashic Complete for \(price)"))
        .accessibilityAddTraits(.isButton)
        .accessibilityIdentifier(A11yID.paywallPurchase)
    }

    private var unavailableRow: some View {
        VStack(spacing: 8) {
            Text("Akashic Complete isn't available here yet.")
                .font(.subheadline.weight(.semibold)).foregroundStyle(Theme.textPrimary)
                // QUA-10: "the sheet degraded instead of bricking" is a state a test has to be able
                // to NAME. On the sentence rather than on the enclosing VStack, because an
                // identifier set on a container is inherited by every descendant — put it on the
                // stack and the retry Button inside it reports `paywall.unavailable` too, which is
                // exactly how the first version of this failed to find its own retry control.
                .accessibilityIdentifier(A11yID.paywallUnavailable)
            Text("Check your connection and try again.").font(.caption).foregroundStyle(Theme.textSecondary)
            Button {
                Task { await entitlements.loadProduct() }
            } label: {
                Label("Try again", systemImage: "arrow.clockwise")
                    .font(.subheadline.weight(.semibold)).foregroundStyle(Theme.accentText)
            }
            .accessibilityLabel("Try loading the price again")
            .accessibilityIdentifier(A11yID.paywallRetry)
            // QUA-29: `performAccessibilityAudit` measured this at 90 × 19.7 pt. It is the ONLY
            // way out of the offline state — the difference between "the sheet degraded
            // gracefully" and "the sheet is dead" — and it was under half the 44 pt minimum on
            // its short axis. `contentShape` is what makes the enlarged frame actually tappable
            // rather than merely tall; the same pairing the globe's own chrome already uses.
            .frame(minHeight: 44)
            .contentShape(Rectangle())
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
                    .foregroundStyle(Theme.accentText)
            }
        }
        .buttonStyle(.plain)
        .disabled(isBusy(.purchasing) || isBusy(.restoring))
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(isBusy(.restoring) ? "Restoring purchases" : "Restore purchases")
        .accessibilityHint("Checks the App Store for a purchase already made with this Apple Account")
        .accessibilityAddTraits(.isButton)
        .accessibilityIdentifier(A11yID.paywallRestore)
        // QUA-29: measured at 131 × 18 pt — less than half the 44 pt minimum, on the control App
        // Review specifically looks for on a non-consumable purchase screen. A customer restoring
        // on a new device is, by definition, someone who has already paid and cannot get in.
        .frame(minHeight: 44)
        .contentShape(Rectangle())
    }

    private var legalRow: some View {
        HStack(spacing: 6) {
            // QUA-29: both links measured ~38 × 14 pt. `minWidth`/`minHeight` on each link rather
            // than on the `HStack`, because enlarging the row would leave two small targets inside
            // a large one — the audit measures the ELEMENT, and so does a thumb.
            Link("Terms", destination: AppInfo.termsURL)
                .frame(minWidth: 44, minHeight: 44)
                .contentShape(Rectangle())
            // Purely a visual divider between the two links.
            Text("·").foregroundStyle(Theme.textTertiary).accessibilityHidden(true)
            Link("Privacy", destination: AppInfo.privacyURL)
                .frame(minWidth: 44, minHeight: 44)
                .contentShape(Rectangle())
        }
        .font(.caption)
        .tint(Theme.textSecondary)
        // The links now carry their own 44 pt height, so the row no longer needs padding to keep
        // its distance from the restore button above.
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
