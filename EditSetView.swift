import SwiftUI
import SwiftData

struct EditSetView: View {
    @Environment(\.modelContext) private var context
    @Environment(\.dismiss) private var dismiss
    @Bindable var set: WorkoutSet
    @State private var weightText = ""
    @State private var repsText = ""
    @State private var milesText = ""
    @State private var flightsText = ""
    @State private var distanceAsFlights = false
    @State private var caloriesText = ""
    @State private var minutesText = ""
    @State private var error: String?

    var body: some View {
        Form {
            TextField("Equipment", text: $set.equipmentName)
            if set.isCardio {
                TextField("miles / flights", text: Binding(
                    get: { distanceAsFlights ? flightsText : milesText },
                    set: { v in
                        if distanceAsFlights { flightsText = v; milesText = "" }
                        else { milesText = v; flightsText = "" }
                    }
                )).keyboardType(.decimalPad)
                TextField("Calories", text: $caloriesText).keyboardType(.numberPad)
                TextField("Minutes", text: $minutesText).keyboardType(.decimalPad)
            } else {
                HStack {
                    TextField("Weight", text: $weightText).keyboardType(.decimalPad)
                    Picker("Unit", selection: $set.unit) {
                        ForEach(WeightUnit.allCases) { Text($0.label).tag($0) }
                    }
                    .pickerStyle(.segmented)
                    .frame(maxWidth: 120)
                }
                TextField("Reps", text: $repsText).keyboardType(.numberPad)
            }
            TextField("Notes", text: Binding(
                get: { set.notes ?? "" },
                set: { set.notes = $0.isEmpty ? nil : $0 }
            ))
            if let error { Text(error).foregroundStyle(.red) }
            Button("Save changes") { save() }.buttonStyle(.borderedProminent)
            Button("Delete set", role: .destructive) {
                context.delete(set)
                try? context.save()
                dismiss()
            }
        }
        .navigationTitle(set.isCardio ? "Edit cardio" : "Edit set")
        .onAppear {
            weightText = set.weight.rounded() == set.weight
                ? String(Int(set.weight)) : String(format: "%.1f", set.weight)
            repsText = String(set.reps)
            if let f = set.flights, f > 0 {
                flightsText = String(f)
                milesText = ""
                distanceAsFlights = true
            } else if let m = set.miles {
                milesText = m.rounded() == m ? String(Int(m)) : String(format: "%.1f", m)
                flightsText = ""
                distanceAsFlights = false
            }
            if let c = set.calories { caloriesText = String(c) }
            if let m = set.minutes {
                minutesText = m.rounded() == m ? String(Int(m)) : String(format: "%.1f", m)
            }
        }
    }

    private func save() {
        if set.isCardio {
            let miles = distanceAsFlights ? nil : Double(milesText.replacingOccurrences(of: ",", with: "."))
            let flights = distanceAsFlights ? Int(flightsText) : nil
            let calories = Int(caloriesText)
            let minutes = Double(minutesText.replacingOccurrences(of: ",", with: "."))
            guard (miles ?? 0) > 0 || (flights ?? 0) > 0 || (calories ?? 0) > 0 || (minutes ?? 0) > 0 else {
                error = "Add miles/flights, calories, or minutes."; return
            }
            set.miles = miles
            set.flights = flights
            set.calories = calories
            set.minutes = minutes
            set.weight = 0
            set.reps = 0
            set.kind = .cardio
        } else {
            guard let w = Double(weightText.replacingOccurrences(of: ",", with: ".")), w >= 0 else {
                error = "Enter a valid weight."; return
            }
            guard let r = Int(repsText), r > 0 else {
                error = "Reps must be a positive whole number."; return
            }
            set.weight = w
            set.reps = r
        }
        set.dayKey = WorkoutSet.dayKey(for: set.loggedAt)
        try? context.save()
        dismiss()
    }
}
