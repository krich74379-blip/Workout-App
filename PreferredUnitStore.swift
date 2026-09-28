import Foundation
import Observation

@Observable
final class PreferredUnitStore {
    private let key = "workoutlog.preferredUnit"
    var unit: WeightUnit {
        didSet { UserDefaults.standard.set(unit.rawValue, forKey: key) }
    }

    init() {
        if let raw = UserDefaults.standard.string(forKey: key), let u = WeightUnit(rawValue: raw) {
            unit = u
        } else {
            unit = .lb
        }
    }
}
