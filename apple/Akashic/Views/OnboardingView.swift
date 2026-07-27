import SwiftUI
import CloudKit

/// First-run onboarding (COMMERCIALIZATION-PLAN §4.2): three lightweight, skippable cards shown
/// once on first launch (and replayable from Settings). It sells the vision, tells the honest
/// truth about where data lives, and explains sharing — no paywall (that is M3).
///
/// Presented as a full-screen cover from the app root so M1's screens stay untouched. All of the
/// "show once" policy lives in `OnboardingState`; this view is pure UI plus the last-card iCloud
/// check.
struct OnboardingView: View {
    /// Called when the user finishes or skips. The caller persists "seen" and dismisses.
    var onFinish: () -> Void

    /// Injectable for previews/tests; defaults to the real CloudKit provider (which safely
    /// returns `.couldNotDetermine` in non-CloudKit builds — it never constructs a container
    /// without the entitlement).
    var accountStatusProvider: AccountStatusProviding =
        CloudKitAccountStatusProvider(containerIdentifier: Config.cloudKitContainerIdentifier)

    @State private var page = 0
    @State private var accountStatus: CKAccountStatus?

    private let lastPage = 2

    var body: some View {
        ZStack {
            Theme.background.ignoresSafeArea()

            VStack(spacing: 0) {
                // Skip — always available; the intro is never mandatory.
                HStack {
                    Spacer()
                    Button("Skip") { onFinish() }
                        .font(.subheadline)
                        .foregroundStyle(Theme.textSecondary)
                        .padding(.horizontal, 20)
                        .padding(.top, 12)
                }

                TabView(selection: $page) {
                    card(
                        hero: .brandMark,
                        title: "Your treks, on a living globe",
                        body: "Akashic turns your hikes and expeditions into journeys you can relive — every day, photo, and waypoint on a globe you can spin."
                    ).tag(0)

                    dataLivesCard.tag(1)

                    sharingCard.tag(2)
                }
                // A4-5 (QUA-30): the built-in index view is off and `pageIndicator` below replaces it.
                //
                // This started as a one-line change — `backgroundDisplayMode` from `.always` (which
                // draws the dots inside a filled capsule, not an idiom iOS uses) to something without
                // the capsule. Neither other value does that. Measured, not assumed: with `.always` the
                // indicator band holds 14,144 non-white pixels; with `.interactive` and with `.never`
                // alike it holds **zero** — both suppress the whole index view, not just its backing,
                // so a new customer got no signal that there were three pages at all.
                //
                // So the dots are drawn here instead. Fifteen lines buys exact control over what the
                // first screen a customer ever sees looks like, and lets the indicator carry a real
                // accessibility value instead of the built-in one this replaces.
                .tabViewStyle(.page(indexDisplayMode: .never))

                pageIndicator

                Button(page == lastPage ? "Get started" : "Continue") {
                    if page == lastPage {
                        onFinish()
                    } else {
                        withAnimation { page += 1 }
                    }
                }
                .font(.headline)
                .foregroundStyle(Theme.onAccent)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 16)
                .background(Theme.accent, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                .padding(.horizontal, 24)
                .padding(.bottom, 20)
            }
            // D2: this is a `fullScreenCover`, so it gets the iPad's full 13" width with nothing
            // to cap it — a single sentence of body text spanning that width is the most extreme
            // version of the "stretched phone" problem this task exists to fix, and it is the
            // very first screen a new iPad owner sees.
            .constrainedReadingWidth()
        }
        .task(id: page) {
            // Only query iCloud when the user actually reaches the last card, and only once.
            if page == lastPage, accountStatus == nil {
                accountStatus = await accountStatusProvider.accountStatus()
            }
        }
    }

    // MARK: - Cards

    /// Card 2 — where data lives. The core honesty promise plus the storage corollary.
    private var dataLivesCard: some View {
        card(
            hero: .symbol("icloud.fill"),
            title: "Your data lives in your iCloud",
            body: "Your journeys and photos live in your own iCloud. We run no servers and never see them.",
            footnote: "Because the photos are yours, they count against your iCloud storage. A large photo archive may need a bigger iCloud+ plan."
        )
    }

    /// Card 3 — sharing, plus the gentle iCloud-account state handling.
    private var sharingCard: some View {
        card(
            hero: .symbol("person.2.fill"),
            title: "Share with family",
            body: "Invite the people you travelled with. They see your journeys on their own devices, and can add their photos and comments.",
            extra: { AnyView(iCloudStateRow) }
        )
    }

    /// Gentle, non-blocking iCloud-account note on the last card. Shown only when we can
    /// positively determine there is no account (or it is restricted); otherwise nothing, because
    /// the default build cannot determine account status and must not cry wolf.
    @ViewBuilder
    private var iCloudStateRow: some View {
        switch accountStatus {
        case .noAccount:
            noteRow(
                icon: "exclamationmark.icloud",
                text: "No iCloud account is signed in. Akashic works locally on this device — to sync and share, sign in via Settings › [your name] › iCloud."
            )
        case .restricted:
            noteRow(
                icon: "lock.icloud",
                text: "iCloud is restricted on this device. Akashic still works locally; sharing and sync need iCloud enabled in Settings."
            )
        default:
            // .available / .couldNotDetermine / .temporarilyUnavailable / unknown → say nothing.
            EmptyView()
        }
    }

    private func noteRow(icon: String, text: LocalizedStringKey) -> some View {
        HStack(alignment: .top, spacing: 8) {
            Image(systemName: icon)
                .foregroundStyle(Theme.warning)
            Text(text)
                .font(.footnote)
                .foregroundStyle(Theme.textSecondary)
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.surface, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .padding(.top, 8)
    }

    /// The paging dots. Floating, as iOS's own do — see the note at `tabViewStyle` for why this is
    /// hand-drawn rather than `indexViewStyle`.
    ///
    /// The current page uses `Theme.accentText` (5.20:1 in Light Mode after QUA-32, 8.50:1 in Dark);
    /// the others use `Theme.textSecondary` at full strength.
    ///
    /// Hierarchy comes from colour, not opacity. The first version faded `textSecondary` to 35 %, which
    /// measured **1.62:1** against a Dark-Mode page — below the 3:1 a UI component needs, and this one
    /// is not decorative: the inactive dots are the only thing telling a new customer there are three
    /// pages at all. `.tertiaryLabel` is out for the same reason at 1.74:1.
    private var pageIndicator: some View {
        HStack(spacing: 8) {
            ForEach(0 ... lastPage, id: \.self) { index in
                Circle()
                    .fill(index == page ? Theme.accentText : Theme.textSecondary)
                    .frame(width: 8, height: 8)
            }
        }
        .padding(.vertical, 12)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text("Page \(page + 1) of \(lastPage + 1)"))
        // Announced, but not a control: swiping the cards is what moves it, and offering it as an
        // adjustable would imply a second way to page that does not exist.
    }

    // MARK: - Card chrome

    /// What a card leads with.
    ///
    /// A4-6 (QUA-30): page one uses the app's own mark, the rest use SF Symbols — and that split is
    /// deliberate rather than a migration half-done. First launch is the one moment brand continuity
    /// is guaranteed to be seen, and it was the one place the mark was absent, in favour of
    /// `globe.europe.africa.fill`. For the later cards a system symbol is genuinely clearer, because
    /// they illustrate a *concept* (iCloud, sharing) rather than identifying the app.
    private enum CardHero {
        case brandMark
        case symbol(String)
    }

    @ViewBuilder
    private func heroImage(_ hero: CardHero) -> some View {
        switch hero {
        case .brandMark:
            // The mark carries its own periwinkle gradient, so no `foregroundStyle` — and it needs no
            // light/dark variant, because the graticule only ever falls inside the sphere.
            Image("AkashicMark")
                .resizable()
                .scaledToFit()
                .frame(width: 104, height: 104)
                .accessibilityHidden(true)   // the title below is the announcement
        case let .symbol(name):
            Image(systemName: name)
                .font(.system(size: 64))
                .foregroundStyle(Theme.accentText)
        }
    }

    private func card(hero: CardHero,
                      title: LocalizedStringKey,
                      body text: LocalizedStringKey,
                      footnote: LocalizedStringKey? = nil,
                      extra: (() -> AnyView)? = nil) -> some View {
        VStack(spacing: 20) {
            Spacer(minLength: 0)

            heroImage(hero)
                .padding(.bottom, 8)

            Text(title)
                .font(.title.weight(.bold))
                .foregroundStyle(Theme.textPrimary)
                .multilineTextAlignment(.center)

            Text(text)
                .font(.body)
                .foregroundStyle(Theme.textSecondary)
                .multilineTextAlignment(.center)

            if let footnote {
                Text(footnote)
                    .font(.footnote)
                    .foregroundStyle(Theme.textTertiary)
                    .multilineTextAlignment(.center)
            }

            if let extra {
                extra()
            }

            Spacer(minLength: 0)
        }
        .padding(.horizontal, 32)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

#Preview {
    OnboardingView(onFinish: {})
        .preferredColorScheme(.dark)
}
