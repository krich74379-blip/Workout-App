import SwiftUI
import SwiftData

struct TodayView: View {
    @Environment(\.modelContext) private var context
    @Query(sort: \WorkoutSet.loggedAt, order: .reverse) private var allSets: [WorkoutSet]

    private var todayKey: String { WorkoutSet.dayKey(for: Date()) }
    private var todaySets: [WorkoutSet] { allSets.filter { $0.dayKey == todayKey } }

    var body: some View {
        NavigationStack {
            Group {
                if todaySets.isEmpty {
                    ContentUnavailableView(
                        "No sets yet today",
                        systemImage: "dumbbell",
                        description: Text("Log from the Log tab or ask Siri.")
                    )
                } else {
                    List {
                        Section(summary) {
                            ForEach(todaySets, id: \.id) { set in
                                NavigationLink { EditSetView(set: set) } label: {
                                    SetRowView(set: set)
                                }
                            }
                            .onDelete(perform: delete)
                        }
                    }
                    .listStyle(.insetGrouped)
                }
            }
            .navigationTitle("Today")
        }
    }

    private var summary: String {
        let n = todaySets.count
        let vol = todaySets.reduce(0.0) { $0 + $1.weight * Double($1.reps) }
        return "\(n) set\(n == 1 ? "" : "s") · volume \(Int(vol.rounded()))"
    }

    private func delete(at offsets: IndexSet) {
        for i in offsets { context.delete(todaySets[i]) }
        try? context.save()
    }
}

struct SetRowView: View {
    let set: WorkoutSet
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(set.equipmentName).font(.headline)
            Text(
                set.loadSummary
                + (set.notes.map { " · \($0)" } ?? "")
            )
            .font(.subheadline)
            .foregroundStyle(.secondary)
        }
        .padding(.vertical, 2)
    }
    private func fmt(_ w: Double) -> String {
        w.rounded() == w ? String(Int(w)) : String(format: "%.1f", w)
    }
}
