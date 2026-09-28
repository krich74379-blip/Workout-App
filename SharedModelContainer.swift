import SwiftData
import Foundation

enum SharedModelContainer {
    private static var cached: ModelContainer?

    @MainActor
    static func shared() throws -> ModelContainer {
        if let cached { return cached }
        let schema = Schema([Equipment.self, WorkoutSet.self])
        let config = ModelConfiguration(schema: schema, isStoredInMemoryOnly: false)
        let container = try ModelContainer(for: schema, configurations: [config])
        cached = container
        return container
    }
}
