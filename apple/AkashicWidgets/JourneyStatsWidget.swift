import WidgetKit
import SwiftUI

// WidgetKit glue for the Journey Stats widget. The presentation lives in the shared,
// WidgetKit-free `JourneyStatsWidgetView`; this file supplies the timeline provider, the
// `Widget` configuration, and the extension's `@main` bundle.

/// One timeline entry = one journey snapshot to display.
struct JourneyEntry: TimelineEntry {
    let date: Date
    let snapshot: WidgetSnapshot
    /// True when we are showing the bundled placeholder rather than real app data.
    let isPlaceholder: Bool
}

/// Reads the latest snapshot the app wrote to the shared container. Falls back to the bundled
/// placeholder whenever there is no shared data yet (i.e. before the App Group is enabled).
struct JourneyStatsProvider: TimelineProvider {
    func placeholder(in context: Context) -> JourneyEntry {
        JourneyEntry(date: Date(), snapshot: WidgetPlaceholder.snapshot, isPlaceholder: true)
    }

    func getSnapshot(in context: Context, completion: @escaping (JourneyEntry) -> Void) {
        completion(currentEntry())
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<JourneyEntry>) -> Void) {
        // Data only changes when the app republishes (and it calls
        // `WidgetCenter.reloadAllTimelines()` when it does), so a lazy 6-hour refresh is plenty.
        let entry = currentEntry()
        let next = Calendar.current.date(byAdding: .hour, value: 6, to: entry.date)
            ?? entry.date.addingTimeInterval(6 * 3600)
        completion(Timeline(entries: [entry], policy: .after(next)))
    }

    private func currentEntry() -> JourneyEntry {
        if let snapshot = WidgetDataStore.shared.load().first {
            return JourneyEntry(date: Date(), snapshot: snapshot, isPlaceholder: false)
        }
        return JourneyEntry(date: Date(), snapshot: WidgetPlaceholder.snapshot, isPlaceholder: true)
    }
}

/// Maps the WidgetKit `\.widgetFamily` environment onto the shared view's size class.
struct JourneyStatsEntryView: View {
    @Environment(\.widgetFamily) private var family
    let entry: JourneyEntry

    var body: some View {
        JourneyStatsWidgetView(snapshot: entry.snapshot, size: sizeClass)
    }

    private var sizeClass: WidgetSizeClass {
        family == .systemSmall ? .small : .medium
    }
}

struct JourneyStatsWidget: Widget {
    let kind = "JourneyStatsWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: JourneyStatsProvider()) { entry in
            JourneyStatsEntryView(entry: entry)
                .containerBackground(for: .widget) { WidgetTheme.background }
        }
        .configurationDisplayName("Journey Stats")
        .description("Distance, days, and summit for your latest Akashic journey.")
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}

@main
struct AkashicWidgetsBundle: WidgetBundle {
    var body: some Widget {
        JourneyStatsWidget()
    }
}
