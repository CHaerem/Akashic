import XCTest
@testable import Akashic

/// SHIP-07 — the parser that decides whether an incoming URL is a journey deep link.
///
/// This exists because the entitlement is only half the feature. `onOpenURL` was GPX-only, so adding
/// `associated-domains` on its own would have made a tapped showcase link open the app, fail to parse
/// as GPX, and show "Couldn't open this file" — a worse outcome than the link staying in Safari. These
/// tests pin the branch that prevents that.
final class UniversalLinkTests: XCTestCase {

    private func slug(_ string: String) -> String? {
        guard let url = URL(string: string) else { return nil }
        return AkashicApp.showcaseJourneySlug(from: url)
    }

    // MARK: - What must be recognised

    /// The exact shape `AppInfo.showcaseURL` builds. If this test and that function ever disagree, the
    /// share button produces links the app cannot open — which is the whole failure this guards.
    func testTheLinkTheAppItselfBuildsIsRecognised() throws {
        let url = try XCTUnwrap(AppInfo.showcaseURL(slug: "kilimanjaro"))
        XCTAssertEqual(AkashicApp.showcaseJourneySlug(from: url), "kilimanjaro",
                       "the app must be able to open the links it hands out")
    }

    func testApexAndWwwBothResolve() {
        XCTAssertEqual(slug("https://akashic.no/?journey=kilimanjaro"), "kilimanjaro")
        XCTAssertEqual(slug("https://www.akashic.no/?journey=kilimanjaro"), "kilimanjaro")
    }

    func testCaseInsensitiveHost() {
        XCTAssertEqual(slug("https://AKASHIC.NO/?journey=inca-trail"), "inca-trail")
    }

    /// Extra query parameters must not defeat the match — analytics or campaign tags get appended to
    /// shared links in the wild.
    func testOtherQueryParametersAreIgnored() {
        XCTAssertEqual(slug("https://akashic.no/?utm_source=sms&journey=mount-kenya&ref=x"), "mount-kenya")
    }

    /// A disambiguated published slug is what a cross-owner collision produces, and it is the value the
    /// link actually carries — see the note on `AppInfo.showcaseURL`.
    func testOwnerDisambiguatedSlugSurvives() {
        XCTAssertEqual(slug("https://akashic.no/?journey=kilimanjaro-2"), "kilimanjaro-2")
    }

    // MARK: - What must fall through to the GPX path

    /// **The security-relevant case.** Without the host check, any site could hand the app a
    /// `?journey=` link and steer what it opens.
    func testAnotherHostIsRefused() {
        XCTAssertNil(slug("https://evil.example.com/?journey=kilimanjaro"))
        XCTAssertNil(slug("https://akashic.no.evil.example.com/?journey=kilimanjaro"),
                     "a suffix attack on the host must not match")
    }

    func testAFileURLFallsThrough() {
        XCTAssertNil(slug("file:///var/mobile/Containers/Data/tmp/route.gpx"),
                     "a GPX import must still reach handleOpenedGPX")
    }

    func testTheBareSiteIsNotADeepLink() {
        XCTAssertNil(slug("https://akashic.no/"))
        XCTAssertNil(slug("https://akashic.no/privacy.html"))
    }

    /// An empty value returns nil on purpose: selecting nothing would look like the app ignored the
    /// tap, whereas falling through surfaces the existing error.
    func testAnEmptyJourneyValueIsNotADeepLink() {
        XCTAssertNil(slug("https://akashic.no/?journey="))
        XCTAssertNil(slug("https://akashic.no/?journey"))
    }

    /// The AASA pattern is `"?": {"journey": "?*"}`, so a path-addressed link is not something the
    /// system would route here — and if one arrives anyway it must not be treated as a deep link.
    func testPathAddressedLinksAreNotMatched() {
        XCTAssertNil(slug("https://akashic.no/journey/kilimanjaro"))
    }

    // MARK: - The entitlement itself

    /// The parser and the entitlement have to agree on the domain, and they live in different files —
    /// exactly the pair that drifts. This reads the shipped entitlement rather than trusting it.
    func testEveryEntitlementDeclaresTheApplinksDomain() throws {
        // The three configs that can run signed: Debug-CloudKit, Release-CloudKit, Production.
        for name in ["Akashic", "Akashic-Release", "Akashic-Production"] {
            let url = URL(fileURLWithPath: #filePath)
                .deletingLastPathComponent()          // AkashicTests/
                .deletingLastPathComponent()          // apple/
                .appendingPathComponent("Akashic/Support/\(name).entitlements")
            guard let data = try? Data(contentsOf: url) else {
                throw XCTSkip("entitlements not readable from the test bundle: \(name)")
            }
            let plist = try XCTUnwrap(
                try PropertyListSerialization.propertyList(from: data, format: nil) as? [String: Any])
            let domains = plist["com.apple.developer.associated-domains"] as? [String]
            XCTAssertEqual(domains, ["applinks:akashic.no"],
                           "\(name).entitlements must declare exactly the apex applinks domain")
        }
    }
}
