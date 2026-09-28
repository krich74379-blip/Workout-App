import SwiftUI
import SwiftData

struct EquipmentLibraryView: View {
    @Environment(\.modelContext) private var context
    @Query(sort: \Equipment.name) private var items: [Equipment]
    @State private var newName = ""
    @State private var renameTarget: Equipment?
    @State private var renameText = ""

    var body: some View {
        NavigationStack {
            List {
                Section("Add") {
                    HStack {
                        TextField("New equipment", text: $newName)
                        Button("Add") { add() }
                            .disabled(newName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    }
                }
                Section("Library (\(items.count))") {
                    ForEach(items, id: \.id) { eq in
                        HStack {
                            Text(eq.name)
                            Spacer()
                            Text("\(eq.sets.count) sets")
                                .font(.footnote).foregroundStyle(.secondary)
                        }
                        .swipeActions {
                            Button("Rename") {
                                renameTarget = eq
                                renameText = eq.name
                            }.tint(.orange)
                            Button("Delete", role: .destructive) {
                                context.delete(eq)
                                try? context.save()
                            }
                        }
                    }
                }
            }
            .navigationTitle("Gear")
            .alert("Rename", isPresented: Binding(
                get: { renameTarget != nil },
                set: { if !$0 { renameTarget = nil } }
            )) {
                TextField("Name", text: $renameText)
                Button("Save") { commitRename() }
                Button("Cancel", role: .cancel) { renameTarget = nil }
            }
        }
    }

    private func add() {
        let name = newName.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty else { return }
        if items.contains(where: { $0.name.compare(name, options: .caseInsensitive) == .orderedSame }) {
            newName = ""; return
        }
        context.insert(Equipment(name: name))
        try? context.save()
        newName = ""
    }

    private func commitRename() {
        guard let eq = renameTarget else { return }
        let name = renameText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty else { return }
        eq.name = name
        eq.updatedAt = Date()
        for s in eq.sets { s.equipmentName = name }
        try? context.save()
        renameTarget = nil
    }
}
