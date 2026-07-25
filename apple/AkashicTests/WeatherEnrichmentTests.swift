import XCTest
@testable import Akashic

/// Assisted creation §3 — historical weather. The WeatherKit→WMO code mapping, and the critical
/// degradation contract: a provider that throws (capability not enabled / date out of range)
/// yields NO suggestion — never an error, never a broken row.
final class WeatherEnrichmentTests: XCTestCase {

    // MARK: Fakes

    private struct FakeWeather: HistoricalWeatherProviding {
        var byDayID: [String: WeatherData] = [:]
        /// dayIDs (matched via coordinate hack) that should throw.
        var thrower: Bool = false
        var value: WeatherData?
        func dailyWeather(lng: Double, lat: Double, date: Date) async throws -> WeatherData? {
            if thrower { throw NSError(domain: "weatherkit", code: 401) }
            return value
        }
    }

    private struct KeyedWeather: HistoricalWeatherProviding {
        var byLng: [Double: WeatherData]
        var throwingLngs: Set<Double> = []
        func dailyWeather(lng: Double, lat: Double, date: Date) async throws -> WeatherData? {
            if throwingLngs.contains(lng) { throw NSError(domain: "weatherkit", code: 401) }
            return byLng[lng]
        }
    }

    // MARK: WMO mapping

    func testWMOMappingCoversCommonConditions() {
        XCTAssertEqual(WeatherCodeMapping.wmoCode(for: "clear"), 0)
        XCTAssertEqual(WeatherCodeMapping.wmoCode(for: "partlyCloudy"), 2)
        XCTAssertEqual(WeatherCodeMapping.wmoCode(for: "cloudy"), 3)
        XCTAssertEqual(WeatherCodeMapping.wmoCode(for: "foggy"), 45)
        XCTAssertEqual(WeatherCodeMapping.wmoCode(for: "rain"), 63)
        XCTAssertEqual(WeatherCodeMapping.wmoCode(for: "heavyRain"), 65)
        XCTAssertEqual(WeatherCodeMapping.wmoCode(for: "snow"), 73)
        XCTAssertEqual(WeatherCodeMapping.wmoCode(for: "thunderstorms"), 95)
    }

    func testWMOMappingIsCaseInsensitiveAndNilForUnknown() {
        XCTAssertEqual(WeatherCodeMapping.wmoCode(for: "CLEAR"), 0)
        XCTAssertEqual(WeatherCodeMapping.wmoCode(for: "  rain "), 63)
        XCTAssertNil(WeatherCodeMapping.wmoCode(for: "moonquake"), "unknown → no code, never a wrong one")
        XCTAssertNil(WeatherCodeMapping.wmoCode(for: ""))
    }

    // MARK: Degradation

    func testThrowingProviderDegradesToNoSuggestion() async {
        let enrich = WeatherEnrichment(provider: FakeWeather(thrower: true), interCallDelayNanos: 0)
        let single = await enrich.suggestWeather(lng: 37, lat: -3, date: Date())
        XCTAssertNil(single, "a thrown error must degrade to nil, not propagate")
    }

    func testSuggestWeatherPerDaySkipsFailuresAndNoCoordinates() async {
        let good = WeatherData(temperatureMax: 12, temperatureMin: 3,
                               precipitationSum: 0, windSpeedMax: 20, weatherCode: 2)
        let provider = KeyedWeather(byLng: [37.0: good, 37.1: good], throwingLngs: [37.1])
        let enrich = WeatherEnrichment(provider: provider, interCallDelayNanos: 0)
        let days = [
            WeatherDayInput(dayID: "d1", coordinate: [37.0, -3.1], date: Date()),   // ok
            WeatherDayInput(dayID: "d2", coordinate: [37.1, -3.1], date: Date()),   // throws → skipped
            WeatherDayInput(dayID: "d3", coordinate: [], date: Date()),             // no coord → skipped
        ]
        let out = await enrich.suggestWeather(for: days)
        XCTAssertEqual(out.map(\.dayID), ["d1"])
        XCTAssertEqual(out.first?.weather.temperatureMax, 12)
    }

    func testSuccessfulProviderYieldsSuggestion() async {
        let value = WeatherData(temperatureMax: 8, temperatureMin: -2,
                                precipitationSum: 4, windSpeedMax: 15, weatherCode: 63)
        let enrich = WeatherEnrichment(provider: FakeWeather(value: value), interCallDelayNanos: 0)
        let out = await enrich.suggestWeather(lng: 37, lat: -3, date: Date())
        XCTAssertEqual(out?.weatherCode, 63)
        XCTAssertEqual(out?.temperatureMin, -2)
    }
}
