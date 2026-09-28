import SwiftUI
import SwiftData

struct HistoryView: View {
    @Query(sort: \WorkoutSet.loggedAt, order: .reverse) private var allSets: [WorkoutSet]

    private var days: [(key: String, sets: [WorkoutSet])] {
        var map: [String: [WorkoutSet]] = [:]
        for s in allSets { map[s.dayKey, default: []].append(s) }
        return map.keys.sorted(by: >).map { key in
            (key, (map[key] ?? []).sorted { $0.loggedAt > $1.loggedAt })
        }
    }

    var body: some View {
        NavigationStack {
            List {
                if days.isEmpty {
                    ContentUnavailableView("No history yet", systemImage: "calendar")
                } else {
                    ForEach(days, id: \.key) { day in
                        NavigationLink {
                            DayDetailView(dayKey: day.key, sets: day.sets)
                        } label: {
                            VStack(alignment: .leading, spacing: 4) {
                                Text(pretty(day.key)).font(.headline)
                                let vol = day.sets.reduce(0.0) { $0 + $1.weight * Double($1.reps) }
                                Text("\(day.sets.count) sets · vol \(Int(vol))")
                                    .font(.subheadline).foregroundStyle(.secondary)
                            }
                        }
                    }
                }
            }
            .navigationTitle("History")
        }
    }

    private func pretty(_ key: String) -> String {
        let parts = key.split(separator: "-").compactMap { Int($0) }
        guard parts.count == 3 else { return key }
        var c = DateComponents(); c.year = parts[0]; c.month = parts[1]; c.day = parts[2]
        guard let date = Calendar.current.date(from: c) else { return key }
        return date.formatted(date: .complete, time: .omitted)
    }
}

struct DayDetailView: View {
    let dayKey: String
    let sets: [WorkoutSet]
    var body: some View {
        List {
            Section("Totals") {
                Text("\(sets.count) sets")
                Text("Volume \(Int(sets.reduce(0.0) { $0 + $1.weight * Double($1.reps) }))")
            }
            Section("Sets") {
                ForEach(sets, id: \.id) { SetRowView(set: $0) }
            }
        }
        .navigationTitle(dayKey)
    }
}
