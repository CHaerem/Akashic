import Foundation

// App-only bridge from the domain `Journey` to the widget's `WidgetSnapshot`. Kept out of the
// shared `WidgetSnapshot.swift` (which the widget target compiles) because the widget never
// sees a `Journey` — it only decodes snapshots.

extension WidgetSnapshot {
    /// Build a snapshot from a domain `Journey`.
    /// - Parameters:
    ///   - sampleCount: max sparkline resolution (route elevations are downsampled to this).
    ///   - thumbnailPath: absolute path to a thumbnail already copied into the shared container.
    static func make(from journey: Journey,
                     sampleCount: Int = 48,
                     thumbnailPath: String? = nil) -> WidgetSnapshot {
        let distance = journey.totalDistance ?? journey.stats.totalDistance
        let days = journey.totalDays ?? journey.stats.duration
        let summitElevation = journey.summitElevation ?? journey.stats.highestPoint?.elevation
        let summitName = journey.stats.highestPoint?.name
        let samples = sampleElevations(journey.route.coordinates, count: sampleCount)

        return WidgetSnapshot(
            id: journey.id,
            name: journey.shortName,
            country: journey.country,
            flag: journey.countryFlag,
            distanceKm: distance,
            days: days,
            summitElevation: summitElevation,
            summitName: summitName,
            elevationSamples: samples,
            thumbnailPath: thumbnailPath,
            distanceText: kilometresText(distance),
            daysText: "\(days) day\(days == 1 ? "" : "s")",
            summitText: summitElevation.map { "\(groupedThousands($0)) m" })
    }
}

/// App-only orchestration: turn journeys into snapshots, copy any hero thumbnails into the
/// shared container, persist, and nudge WidgetKit. No-op (aside from a harmless reload ping)
/// when there is no App Group container — the case tonight on the unsigned simulator build.
enum WidgetPublisher {
    static func publish(_ journeys: [Journey],
                        store: WidgetDataStore = .shared,
                        thumbnailSources: [String: String] = [:]) {
        guard let container = store.directory else {
            store.reloadTimelines()   // nothing to write; widget keeps showing the placeholder
            return
        }

        let thumbsDirectory = container.appendingPathComponent("thumbs", isDirectory: true)
        try? FileManager.default.createDirectory(at: thumbsDirectory, withIntermediateDirectories: true)

        let snapshots = journeys.map { journey -> WidgetSnapshot in
            var copiedPath: String?
            if let source = thumbnailSources[journey.id] {
                let destination = thumbsDirectory.appendingPathComponent(fileSafe(journey.id) + ".jpg")
                try? FileManager.default.removeItem(at: destination)
                if (try? FileManager.default.copyItem(
                    at: URL(fileURLWithPath: source), to: destination)) != nil {
                    copiedPath = destination.path
                }
            }
            return WidgetSnapshot.make(from: journey, thumbnailPath: copiedPath)
        }

        store.write(snapshots)
        store.reloadTimelines()
    }

    private static func fileSafe(_ identifier: String) -> String {
        identifier.replacingOccurrences(of: "/", with: "_")
    }
}
