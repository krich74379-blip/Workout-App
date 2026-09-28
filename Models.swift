import Foundation
import SwiftData

enum WeightUnit: String, Codable, CaseIterable, Identifiable, Sendable {
    case lb, kg
    var id: String { rawValue }
    var label: String { rawValue }
}

enum SetKind: String, Codable, CaseIterable, Sendable {
    case strength, cardio
}

@Model
final class Equipment {
    @Attribute(.unique) var id: UUID
    var name: String
    var createdAt: Date
    var updatedAt: Date

    @Relationship(deleteRule: .nullify, inverse: \WorkoutSet.equipment)
    var sets: [WorkoutSet] = []

    init(name: String) {
        self.id = UUID()
        self.name = name.trimmingCharacters(in: .whitespacesAndNewlines)
        let now = Date()
        self.createdAt = now
        self.updatedAt = now
    }
}

@Model
final class WorkoutSet {
    @Attribute(.unique) var id: UUID
    var equipmentName: String
    var weight: Double
    var unitRaw: String
    var reps: Int
    var notes: String?
    var loggedAt: Date
    var dayKey: String
    var equipment: Equipment?
    /// Cardio fields (optional; unused for strength).
    var miles: Double?
    var flights: Int?
    var calories: Int?
    var minutes: Double?
    var kindRaw: String?

    var unit: WeightUnit {
        get { WeightUnit(rawValue: unitRaw) ?? .lb }
        set { unitRaw = newValue.rawValue }
    }

    var kind: SetKind {
        get {
            if let kindRaw, let k = SetKind(rawValue: kindRaw) { return k }
            if (miles ?? 0) > 0 || (flights ?? 0) > 0 || (calories ?? 0) > 0 || (minutes ?? 0) > 0 {
                return .cardio
            }
            return .strength
        }
        set { kindRaw = newValue.rawValue }
    }

    var isCardio: Bool { kind == .cardio }

    var loadSummary: String {
        if isCardio {
            var parts: [String] = []
            if let flights, flights > 0 {
                parts.append("\(flights) flights")
            } else if let miles, miles > 0 {
                parts.append(miles.rounded() == miles ? "\(Int(miles)) mi" : String(format: "%.1f mi", miles))
            }
            if let calories, calories > 0 { parts.append("\(calories) cal") }
            if let minutes, minutes > 0 {
                parts.append(minutes.rounded() == minutes ? "\(Int(minutes)) min" : String(format: "%.1f min", minutes))
            }
            return parts.isEmpty ? "cardio" : parts.joined(separator: " · ")
        }
        let w = weight.rounded() == weight ? "\(Int(weight))" : String(format: "%.1f", weight)
        return "\(w) \(unit.label) × \(reps)"
    }

    init(
        equipmentName: String,
        weight: Double,
        unit: WeightUnit,
        reps: Int,
        notes: String? = nil,
        loggedAt: Date = .now,
        equipment: Equipment? = nil,
        miles: Double? = nil,
        flights: Int? = nil,
        calories: Int? = nil,
        minutes: Double? = nil,
        kind: SetKind = .strength
    ) {
        self.id = UUID()
        self.equipmentName = equipmentName
        self.weight = weight
        self.unitRaw = unit.rawValue
        self.reps = reps
        self.notes = notes
        self.loggedAt = loggedAt
        self.dayKey = Self.dayKey(for: loggedAt)
        self.equipment = equipment
        self.miles = miles
        self.flights = flights
        self.calories = calories
        self.minutes = minutes
        self.kindRaw = kind.rawValue
    }

    static func dayKey(for date: Date, calendar: Calendar = .current) -> String {
        let c = calendar.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", c.year ?? 0, c.month ?? 0, c.day ?? 0)
    }
}

struct ExportPayload: Codable {
    var version: Int
    var exportedAt: String
    var preferredUnit: String
    var equipment: [ExportEquipment]
    var sets: [ExportSet]
}

struct ExportEquipment: Codable {
    var id: String
    var name: String
}

struct ExportSet: Codable {
    var id: String
    var equipmentName: String
    var weight: Double
    var unit: String
    var reps: Int
    var notes: String?
    var loggedAt: String
    var dayKey: String
    var miles: Double?
    var flights: Int?
    var calories: Int?
    var minutes: Double?
    var kind: String?
}
