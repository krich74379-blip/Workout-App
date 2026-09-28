import AppIntents
import SwiftData
import Foundation

struct LogWorkoutSetIntent: AppIntent {
    static var title: LocalizedStringResource = "Log Workout Set"
    static var description = IntentDescription(
        "Logs a gym set from a spoken phrase like “bench press 185 for 8”, or from equipment, weight, and reps."
    )
    static var openAppWhenRun: Bool = false

    @Parameter(title: "Phrase", description: "e.g. bench press 185 for 8")
    var phrase: String?

    @Parameter(title: "Equipment")
    var equipment: String?

    @Parameter(title: "Weight")
    var weight: Double?

    @Parameter(title: "Reps")
    var reps: Int?

    @Parameter(title: "Unit")
    var unit: WeightUnitAppEnum?

    static var parameterSummary: some ParameterSummary {
        Summary("Log \(\.$phrase)") {
            \.$equipment
            \.$weight
            \.$reps
            \.$unit
        }
    }

    @MainActor
    func perform() async throws -> some IntentResult & ProvidesDialog {
        let container = try SharedModelContainer.shared()
        let context = ModelContext(container)
        let names = WorkoutStoreHelpers.equipmentNames(in: context)
        let preferred =
            WeightUnit(rawValue: UserDefaults.standard.string(forKey: "workoutlog.preferredUnit") ?? "lb")
            ?? .lb

        let parsed: ParsedSetUtterance?
        if let phrase, !phrase.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            parsed = SetUtteranceParser.parse(
                phrase,
                equipmentNames: names,
                preferredUnit: preferred
            )
        } else if let equipment, let weight, let reps {
            parsed = ParsedSetUtterance(
                equipmentName: equipment,
                weight: weight,
                reps: reps,
                unit: unit?.asUnit ?? preferred,
                confidence: 0.95,
                matchedLibrary: names.contains {
                    $0.compare(equipment, options: .caseInsensitive) == .orderedSame
                },
                raw: "\(equipment) \(Int(weight)) for \(reps)"
            )
        } else {
            throw IntentFailure.missingInput
        }

        guard let parsed, parsed.isComplete else { throw IntentFailure.couldNotParse }

        let set = try WorkoutStoreHelpers.logSet(
            equipmentName: parsed.equipmentName,
            weight: parsed.weight,
            unit: parsed.unit,
            reps: parsed.reps,
            notes: "Siri: \(parsed.raw)",
            in: context
        )

        let w = set.weight.rounded() == set.weight
            ? String(Int(set.weight))
            : String(format: "%.1f", set.weight)
        return .result(
            dialog: IntentDialog(
                stringLiteral: "Logged \(set.equipmentName) \(w) \(set.unit.label) × \(set.reps)."
            )
        )
    }
}

enum WeightUnitAppEnum: String, AppEnum {
    case lb, kg
    static var typeDisplayRepresentation = TypeDisplayRepresentation(name: "Weight Unit")
    static var caseDisplayRepresentations: [WeightUnitAppEnum: DisplayRepresentation] = [
        .lb: "Pounds",
        .kg: "Kilograms",
    ]
    var asUnit: WeightUnit { self == .kg ? .kg : .lb }
}

enum IntentFailure: Error, CustomLocalizedStringResourceConvertible {
    case missingInput, couldNotParse
    var localizedStringResource: LocalizedStringResource {
        switch self {
        case .missingInput:
            return "Provide a phrase like “bench press 185 for 8”, or equipment, weight, and reps."
        case .couldNotParse:
            return "Couldn’t understand that set. Try “bench press 185 for 8”."
        }
    }
}

struct WorkoutLogShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: LogWorkoutSetIntent(),
            phrases: [
                "Log a set in \(.applicationName)",
                "Log workout set in \(.applicationName)",
                "Log \(\.$phrase) in \(.applicationName)",
            ],
            shortTitle: "Log Set",
            systemImageName: "dumbbell.fill"
        )
    }
}
