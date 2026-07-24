import Foundation

// MARK: - Parsed value types

/// A `<wpt>` from a GPX file (a named point — a camp/day marker or a POI). Coordinates are in
/// the domain's GeoJSON order `[lng, lat, ele?]`, so day-seeding and camp creation never have to
/// re-swap. GPX writes `lat` first; the swap happens once, here, and is pinned by tests.
struct GPXWaypoint: Equatable {
    var name: String?
    /// `[lng, lat]` or `[lng, lat, ele]` — GeoJSON order (NOT GPX's lat-first order).
    var coordinates: [Double]
    var elevation: Double?
    var desc: String?
    var time: Date?

    var longitude: Double { coordinates.first ?? 0 }
    var latitude: Double { coordinates.count > 1 ? coordinates[1] : 0 }
}

/// The result of parsing a GPX document: a route (LineString in domain shape), its named
/// waypoints, and file metadata. `droppedPointCount` records track/way points that carried
/// out-of-range coordinates and were dropped rather than written out as a plausible-looking
/// wrong location (mirrors `GPXBuilder.point(from:)`'s range guard on the export side).
struct GPXFile: Equatable {
    /// Route in domain shape: `type == "LineString"`, coordinates `[lng, lat, ele?]`.
    var route: Route
    var waypoints: [GPXWaypoint]
    var name: String?
    var time: Date?
    var droppedPointCount: Int

    /// True when the document produced neither a route nor any waypoints.
    var isEmpty: Bool { route.coordinates.isEmpty && waypoints.isEmpty }

    var trackPointCount: Int { route.coordinates.count }
}

/// Typed, user-presentable failures. The messages are safe to show verbatim in a sheet.
enum GPXParseError: Error, LocalizedError, Equatable {
    /// The file was empty or contained no readable XML.
    case empty
    /// `XMLParser` rejected the document (not well-formed XML).
    case malformed(String)
    /// The document parsed but carried neither track points nor waypoints.
    case noContent
    /// The file is larger than the import cap (protects the UI from a multi-hundred-MB pick).
    case tooLarge(maxBytes: Int)

    var errorDescription: String? {
        switch self {
        case .empty:
            return "This file is empty."
        case .malformed:
            return "This doesn't look like a valid GPX file — the XML couldn't be read."
        case .noContent:
            return "This GPX file has no track points or waypoints to import."
        case let .tooLarge(maxBytes):
            return "This GPX file is too large to import (over \(maxBytes / (1024 * 1024)) MB). "
                 + "Try a simplified or trimmed track."
        }
    }
}

// MARK: - Parser

/// Foundation `XMLParser`-based GPX reader (no third-party dependency). Handles GPX 1.0 and 1.1,
/// namespaced documents (Strava / Garmin / komoot add `xmlns` + `<extensions>`), CDATA in names,
/// multiple `<trk>`/`<trkseg>` (concatenated in document order), and points with or without
/// `<ele>`/`<time>`. It is the exact inverse of `GPXBuilder` and round-trips its output.
enum GPXParser {

    /// Largest GPX/XML file the importer will read into memory. A multi-day, 1-second-sampled
    /// track is a few MB; 25 MB covers real files while refusing a pick that would freeze the UI
    /// (whole-file `Data` load + full XML pass) or risk a jetsam. `.xml` is an allowed content
    /// type, so the user can pick any XML — the cap is the backstop. (quality gate: GPX import
    /// parses arbitrarily large user-picked files synchronously on the main thread.)
    static let maxFileBytes = 25 * 1024 * 1024

    static func parse(_ string: String) throws -> GPXFile {
        guard let data = string.data(using: .utf8) else { throw GPXParseError.empty }
        return try parse(data)
    }

    static func parse(contentsOf url: URL, maxBytes: Int = maxFileBytes) throws -> GPXFile {
        // Reject an over-cap file by its size before reading it into memory.
        if let size = try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize, size > maxBytes {
            throw GPXParseError.tooLarge(maxBytes: maxBytes)
        }
        let data = try Data(contentsOf: url)
        if data.count > maxBytes { throw GPXParseError.tooLarge(maxBytes: maxBytes) }
        return try parse(data)
    }

    static func parse(_ data: Data) throws -> GPXFile {
        // Reject a truly empty / whitespace-only file before invoking XMLParser (which would
        // otherwise report a generic "no element found" error for the same case).
        let nonWhitespace = data.contains { byte in
            byte != 0x20 && byte != 0x09 && byte != 0x0A && byte != 0x0D && byte != 0x00
        }
        guard nonWhitespace else { throw GPXParseError.empty }

        let parser = XMLParser(data: data)
        let delegate = GPXParserDelegate()
        parser.delegate = delegate
        // Leave namespace processing OFF: default-namespaced GPX (Strava/Garmin) then reports
        // plain `trkpt`/`wpt` element names, and prefixed extension tags keep their prefix so the
        // `<extensions>` subtree is trivially skippable.
        parser.shouldProcessNamespaces = false

        guard parser.parse() else {
            let message = parser.parserError?.localizedDescription ?? "unknown parse error"
            throw GPXParseError.malformed(message)
        }
        if let failure = delegate.failure { throw failure }

        let file = delegate.makeFile()
        guard !file.isEmpty else { throw GPXParseError.noContent }
        return file
    }
}

// MARK: - XMLParserDelegate

/// Accumulates the parse into a `GPXFile`. Kept internal (not private) so it can be unit-tested
/// directly if ever needed; `GPXParser.parse` is the public entry point.
final class GPXParserDelegate: NSObject, XMLParserDelegate {

    // Output accumulators.
    private var routeCoordinates: [[Double]] = []
    private var waypoints: [GPXWaypoint] = []
    private var metadataName: String?
    private var metadataTime: Date?
    private var droppedPointCount = 0
    private(set) var failure: GPXParseError?

    // Parse state.
    private var elementStack: [String] = []
    private var textBuffer = ""
    private var extensionsDepth = 0     // >0 while inside any <extensions> subtree

    /// The point currently being built (inside a `<trkpt>` or `<wpt>`).
    private struct PendingPoint {
        var latitude: Double?
        var longitude: Double?
        var elevation: Double?
        var name: String?
        var desc: String?
        var time: Date?
    }
    private var pendingTrackPoint: PendingPoint?
    private var pendingWaypoint: PendingPoint?
    /// Coordinates of the current `<trkseg>`, flushed into `routeCoordinates` on `</trkseg>`.
    private var currentSegment: [[Double]] = []
    private var trackName: String?

    func makeFile() -> GPXFile {
        GPXFile(route: Route(type: "LineString", coordinates: routeCoordinates),
                waypoints: waypoints,
                name: metadataName ?? trackName,
                time: metadataTime,
                droppedPointCount: droppedPointCount)
    }

    // MARK: Element start

    func parser(_ parser: XMLParser, didStartElement elementName: String,
                namespaceURI: String?, qualifiedName qName: String?,
                attributes attributeDict: [String: String]) {
        let name = elementName.lowercased()
        elementStack.append(name)
        textBuffer = ""

        if name == "extensions" { extensionsDepth += 1; return }
        guard extensionsDepth == 0 else { return }   // ignore everything inside <extensions>

        switch name {
        case "trkpt", "wpt", "rtept":
            let lat = doubleAttribute(attributeDict, key: "lat")
            let lon = doubleAttribute(attributeDict, key: "lon")
            var point = PendingPoint()
            point.latitude = lat
            point.longitude = lon
            // A <rtept> is a route point — it contributes to the route line exactly like a <trkpt>.
            if name == "wpt" { pendingWaypoint = point } else { pendingTrackPoint = point }
        case "trkseg", "rte":
            // A <rte> is a route (a LineString of <rtept>) with no <trkseg>; buffer it the same way.
            currentSegment = []
        default:
            break
        }
    }

    // MARK: Text / CDATA

    func parser(_ parser: XMLParser, foundCharacters string: String) {
        textBuffer += string
    }

    func parser(_ parser: XMLParser, foundCDATA CDATABlock: Data) {
        if let string = String(data: CDATABlock, encoding: .utf8) { textBuffer += string }
    }

    // MARK: Element end

    func parser(_ parser: XMLParser, didEndElement elementName: String,
                namespaceURI: String?, qualifiedName qName: String?) {
        defer { if !elementStack.isEmpty { elementStack.removeLast() } }
        let name = elementName.lowercased()

        if name == "extensions" {
            if extensionsDepth > 0 { extensionsDepth -= 1 }
            return
        }
        guard extensionsDepth == 0 else { return }

        let text = textBuffer.trimmingCharacters(in: .whitespacesAndNewlines)
        textBuffer = ""

        switch name {
        case "ele":
            let value = Double(text)
            if pendingWaypoint != nil { pendingWaypoint?.elevation = value }
            else if pendingTrackPoint != nil { pendingTrackPoint?.elevation = value }

        case "time":
            let date = Self.parseTime(text)
            if pendingWaypoint != nil { pendingWaypoint?.time = date }
            else if pendingTrackPoint != nil { pendingTrackPoint?.time = date }
            else if isInsideMetadata { metadataTime = date }

        case "name":
            if pendingWaypoint != nil { pendingWaypoint?.name = text }
            else if isInsideTrack { trackName = text }
            else if isInsideMetadata { metadataName = text }

        case "desc":
            if pendingWaypoint != nil { pendingWaypoint?.desc = text }

        case "trkpt", "rtept":
            finishTrackPoint()

        case "wpt":
            finishWaypoint()

        case "trkseg", "rte":
            routeCoordinates.append(contentsOf: currentSegment)
            currentSegment = []

        case "trk":
            // Flush any points that were emitted directly under <trk> without a wrapping <trkseg>
            // (a schema-invalid but real producer quirk). Without this, those parsed points would
            // be stranded in `currentSegment` and the file wrongly reported as having "no content".
            // (quality gate: trkpt outside a trkseg is silently discarded.)
            routeCoordinates.append(contentsOf: currentSegment)
            currentSegment = []

        default:
            break
        }
    }

    // MARK: Point finishing

    private func finishTrackPoint() {
        defer { pendingTrackPoint = nil }
        guard let point = pendingTrackPoint,
              let coordinate = coordinate(lat: point.latitude, lon: point.longitude,
                                          ele: point.elevation)
        else { droppedPointCount += 1; return }
        currentSegment.append(coordinate)
    }

    private func finishWaypoint() {
        defer { pendingWaypoint = nil }
        guard let point = pendingWaypoint,
              let coordinate = coordinate(lat: point.latitude, lon: point.longitude,
                                          ele: point.elevation)
        else { droppedPointCount += 1; return }
        waypoints.append(GPXWaypoint(name: point.name,
                                     coordinates: coordinate,
                                     elevation: point.elevation,
                                     desc: point.desc,
                                     time: point.time))
    }

    /// Validate + reorder to `[lng, lat, ele?]`. Returns nil (→ drop + count) when a coordinate is
    /// missing, non-finite, or out of range — the same guard `GPXBuilder.point(from:)` applies.
    private func coordinate(lat: Double?, lon: Double?, ele: Double?) -> [Double]? {
        guard let lat, let lon, lat.isFinite, lon.isFinite,
              (-90.0...90.0).contains(lat), (-180.0...180.0).contains(lon)
        else { return nil }
        if let ele, ele.isFinite { return [lon, lat, ele] }
        return [lon, lat]
    }

    // MARK: Context helpers

    /// True when the current element sits directly under `<metadata>`.
    private var isInsideMetadata: Bool { elementStack.dropLast().last == "metadata" }
    /// True when the current element sits under a `<trk>` (but not a `<trkpt>`, handled above).
    private var isInsideTrack: Bool {
        let ancestors = elementStack.dropLast()
        return ancestors.contains("trk") && pendingTrackPoint == nil
    }

    private func doubleAttribute(_ dict: [String: String], key: String) -> Double? {
        if let value = dict[key] { return Double(value) }
        // Tolerate an unexpected attribute casing (e.g. "Lat").
        for (k, v) in dict where k.lowercased() == key { return Double(v) }
        return nil
    }

    // MARK: Time parsing

    private static let isoWithFraction: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()
    private static let iso: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime]
        return f
    }()

    /// Lenient fallback for GPX writers that emit a zone-less `<time>` ("2023-09-29T06:00:00" with
    /// no Z/offset — nonconformant but real). `xsd:dateTime` allows the timezone to be absent, so
    /// such files are arguably valid; we parse them as UTC rather than dropping every date label.
    /// (quality gate: GPX <time> without a timezone designator parses to nil.)
    private static let zonelessLocal: DateFormatter = {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = TimeZone(identifier: "UTC")
        f.dateFormat = "yyyy-MM-dd'T'HH:mm:ss"
        return f
    }()
    private static let zonelessLocalFraction: DateFormatter = {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = TimeZone(identifier: "UTC")
        f.dateFormat = "yyyy-MM-dd'T'HH:mm:ss.SSS"
        return f
    }()

    static func parseTime(_ string: String) -> Date? {
        guard !string.isEmpty else { return nil }
        return iso.date(from: string)
            ?? isoWithFraction.date(from: string)
            ?? zonelessLocal.date(from: string)
            ?? zonelessLocalFraction.date(from: string)
    }
}
