import Foundation
import SwiftData

enum WorkoutStoreHelpers {
    static let isoFractional: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()
    static let isoBasic: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime]
        return f
    }()

    @MainActor
    static func ensureEquipment(named raw: String, in context: ModelContext) throws -> Equipment {
        let name = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty else { throw StoreError.invalidEquipment }
        let all = try context.fetch(FetchDescriptor<Equipment>())
        if let hit = all.first(where: { $0.name.compare(name, options: .caseInsensitive) == .orderedSame }) {
            return hit
        }
        let eq = Equipment(name: name)
        context.insert(eq)
        return eq
    }

    @MainActor
    static func logSet(
        equipmentName: String,
        weight: Double = 0,
        unit: WeightUnit,
        reps: Int = 0,
        notes: String? = nil,
        miles: Double? = nil,
        flights: Int? = nil,
        calories: Int? = nil,
        minutes: Double? = nil,
        kind: SetKind = .strength,
        in context: ModelContext
    ) throws -> WorkoutSet {
        let isCardio = kind == .cardio
            || (miles ?? 0) > 0
            || (flights ?? 0) > 0
            || (calories ?? 0) > 0
            || (minutes ?? 0) > 0
        if isCardio {
            guard (miles ?? 0) > 0 || (flights ?? 0) > 0 || (calories ?? 0) > 0 || (minutes ?? 0) > 0 else {
                throw StoreError.invalidCardio
            }
        } else {
            guard weight >= 0, !weight.isNaN else { throw StoreError.invalidWeight }
            guard reps > 0 else { throw StoreError.invalidReps }
        }
        let eq = try ensureEquipment(named: equipmentName, in: context)
        let set = WorkoutSet(
            equipmentName: eq.name,
            weight: isCardio ? 0 : weight,
            unit: unit,
            reps: isCardio ? 0 : reps,
            notes: notes,
            equipment: eq,
            miles: isCardio ? miles : nil,
            flights: isCardio ? flights : nil,
            calories: isCardio ? calories : nil,
            minutes: isCardio ? minutes : nil,
            kind: isCardio ? .cardio : .strength
        )
        context.insert(set)
        try context.save()
        return set
    }

    @MainActor
    static func equipmentNames(in context: ModelContext) -> [String] {
        (try? context.fetch(FetchDescriptor<Equipment>()))?.map(\.name) ?? []
    }

    @MainActor
    static func exportData(preferredUnit: WeightUnit, in context: ModelContext) throws -> Data {
        let equipment = try context.fetch(FetchDescriptor<Equipment>(sortBy: [SortDescriptor(\.name)]))
        let sets = try context.fetch(FetchDescriptor<WorkoutSet>(sortBy: [SortDescriptor(\.loggedAt)]))
        let payload = ExportPayload(
            version: 1,
            exportedAt: isoFractional.string(from: Date()),
            preferredUnit: preferredUnit.rawValue,
            equipment: equipment.map { ExportEquipment(id: $0.id.uuidString, name: $0.name) },
            sets: sets.map {
                ExportSet(
                    id: $0.id.uuidString,
                    equipmentName: $0.equipmentName,
                    weight: $0.weight,
                    unit: $0.unitRaw,
                    reps: $0.reps,
                    notes: $0.notes,
                    loggedAt: isoFractional.string(from: $0.loggedAt),
                    dayKey: $0.dayKey,
                    miles: $0.miles,
                    flights: $0.flights,
                    calories: $0.calories,
                    minutes: $0.minutes,
                    kind: $0.kindRaw
                )
            }
        )
        let enc = JSONEncoder()
        enc.outputFormatting = [.prettyPrinted, .sortedKeys]
        return try enc.encode(payload)
    }

    @MainActor
    static func importData(_ data: Data, into context: ModelContext) throws -> (equipment: Int, sets: Int) {
        let payload = try JSONDecoder().decode(ExportPayload.self, from: data)
        var byName: [String: Equipment] = [:]
        for e in try context.fetch(FetchDescriptor<Equipment>()) {
            byName[e.name.lowercased()] = e
        }
        var addedEq = 0
        for item in payload.equipment {
            let key = item.name.lowercased()
            if byName[key] == nil {
                let e = Equipment(name: item.name)
                context.insert(e)
                byName[key] = e
                addedEq += 1
            }
        }
        var addedSets = 0
        for s in payload.sets {
            let name = s.equipmentName.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !name.isEmpty else { continue }
            let key = name.lowercased()
            let eq = byName[key] ?? {
                let e = Equipment(name: name)
                context.insert(e)
                byName[key] = e
                return e
            }()
            let logged = isoFractional.date(from: s.loggedAt)
                ?? isoBasic.date(from: s.loggedAt)
                ?? Date()
            let unit = WeightUnit(rawValue: s.unit) ?? .lb
            let importedKind = SetKind(rawValue: s.kind ?? "") ?? (
                (s.miles ?? 0) > 0 || (s.flights ?? 0) > 0 || (s.calories ?? 0) > 0 || (s.minutes ?? 0) > 0 ? .cardio : .strength
            )
            let set = WorkoutSet(
                equipmentName: eq.name,
                weight: importedKind == .cardio ? 0 : s.weight,
                unit: unit,
                reps: importedKind == .cardio ? 0 : max(1, s.reps),
                notes: s.notes,
                loggedAt: logged,
                equipment: eq,
                miles: s.miles,
                flights: s.flights,
                calories: s.calories,
                minutes: s.minutes,
                kind: importedKind
            )
            if !s.dayKey.isEmpty { set.dayKey = s.dayKey }
            context.insert(set)
            addedSets += 1
        }
        try context.save()
        return (addedEq, addedSets)
    }
}

enum StoreError: LocalizedError {
    case invalidEquipment, invalidWeight, invalidReps, invalidCardio
    var errorDescription: String? {
        switch self {
        case .invalidEquipment: return "Enter an equipment name."
        case .invalidWeight: return "Enter a valid weight."
        case .invalidReps: return "Reps must be a positive whole number."
        case .invalidCardio: return "Add miles/flights, calories, or minutes for cardio."
        }
    }
}
