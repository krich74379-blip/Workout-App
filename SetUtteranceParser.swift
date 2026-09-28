import Foundation

struct ParsedSetUtterance: Equatable, Sendable {
    var equipmentName: String
    var weight: Double
    var reps: Int
    var unit: WeightUnit
    var confidence: Double
    var matchedLibrary: Bool
    var raw: String
    var miles: Double? = nil
    var flights: Int? = nil
    var calories: Int? = nil
    var minutes: Double? = nil
    var kind: SetKind = .strength

    var isCardio: Bool {
        kind == .cardio || (miles ?? 0) > 0 || (flights ?? 0) > 0 || (calories ?? 0) > 0 || (minutes ?? 0) > 0
    }

    var isComplete: Bool {
        if isCardio {
            return !equipmentName.isEmpty && ((miles ?? 0) > 0 || (flights ?? 0) > 0 || (calories ?? 0) > 0 || (minutes ?? 0) > 0)
        }
        return !equipmentName.isEmpty && weight > 0 && reps > 0
    }
}

enum SetUtteranceParser {
    private static let ones: [String: Int] = [
        "zero": 0, "oh": 0, "o": 0,
        "one": 1, "two": 2, "three": 3, "four": 4, "five": 5,
        "six": 6, "seven": 7, "eight": 8, "nine": 9, "ten": 10,
        "eleven": 11, "twelve": 12, "thirteen": 13, "fourteen": 14,
        "fifteen": 15, "sixteen": 16, "seventeen": 17, "eighteen": 18, "nineteen": 19,
    ]
    private static let tens: [String: Int] = [
        "twenty": 20, "thirty": 30, "forty": 40, "fifty": 50,
        "sixty": 60, "seventy": 70, "eighty": 80, "ninety": 90,
    ]
    private static let unitWords: Set<String> = [
        "pound", "pounds", "lb", "lbs", "kilo", "kilos", "kilogram", "kilograms", "kg",
    ]
    private static let repWords: Set<String> = ["rep", "reps", "repetition", "repetitions"]
    private static let connectors: Set<String> = [
        "for", "fore", "by", "times", "x", "of", "at", "with", "and",
    ]
    private static let mileWords: Set<String> = ["mile", "miles", "mi"]
    private static let flightWords: Set<String> = ["flight", "flights"]
    private static let calWords: Set<String> = ["calorie", "calories", "cal", "cals", "kcal", "kcals"]
    private static let minWords: Set<String> = ["minute", "minutes", "min", "mins"]

    static func parse(
        _ raw: String,
        equipmentNames: [String] = [],
        preferredUnit: WeightUnit = .lb,
        lockedEquipment: String? = nil,
        lockedKind: SetKind? = nil
    ) -> ParsedSetUtterance? {
        let normalized = normalize(raw)
        guard !normalized.isEmpty else { return nil }
        let tokens = normalized.split(separator: " ").map(String.init)
        guard !tokens.isEmpty else { return nil }
        let locked = lockedEquipment?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let preferCardio = lockedKind != .strength
        if preferCardio {
            if let cardio = parseCardio(raw: raw, tokens: tokens, library: equipmentNames, preferredUnit: preferredUnit) {
                return applyLocked(cardio, locked: locked, lockedKind: lockedKind)
            }
            if !locked.isEmpty, lockedKind == .cardio {
                return nil
            }
        }

        let unit = detectUnit(tokens, fallback: preferredUnit)

        var spans: [(value: Double, start: Int, end: Int)] = []
        var i = 0
        while i < tokens.count {
            let t = tokens[i]
            if unitWords.contains(t) || repWords.contains(t) || connectors.contains(t) {
                i += 1
                continue
            }
            if let num = parseNumber(tokens, at: i) {
                spans.append((Double(num.value), i, num.next))
                i = num.next
            } else {
                i += 1
            }
        }
        guard !spans.isEmpty else { return nil }
        guard let picked = pickWeightReps(spans: spans, tokens: tokens) else { return nil }
        let weight = picked.weight
        let reps = Int(picked.reps.rounded())
        guard weight >= 0, weight <= 2000, reps >= 0, reps <= 100 else { return nil }

        var equipWords: [String] = []
        for (idx, t) in tokens.prefix(picked.weightStart).enumerated() {
            if unitWords.contains(t) || connectors.contains(t) || repWords.contains(t) { continue }
            if t.range(of: #"^\d+(\.\d+)?$"#, options: .regularExpression) != nil { continue }
            if ones[t] != nil || tens[t] != nil || t == "hundred" { continue }
            var inside = false
            for s in spans where idx >= s.start && idx < s.end { inside = true }
            if inside { continue }
            equipWords.append(t)
        }
        let equipRaw = equipWords.joined(separator: " ")
        if equipRaw.isEmpty && !(weight > 0 || reps > 0) { return nil }

        let matched = matchEquipment(equipRaw, library: equipmentNames)
        var confidence = 0.4
        if matched.matched { confidence += 0.35 * matched.score }
        else if !matched.name.isEmpty { confidence += 0.1 }
        if weight > 0 && reps > 0 { confidence += 0.15 }
        confidence += picked.boost
        confidence = min(1, max(0.05, confidence))

        let parsed = ParsedSetUtterance(
            equipmentName: matched.name,
            weight: weight,
            reps: reps,
            unit: unit,
            confidence: confidence,
            matchedLibrary: matched.matched,
            raw: raw.trimmingCharacters(in: .whitespacesAndNewlines)
        )
        return applyLocked(parsed, locked: locked, lockedKind: lockedKind)
    }


    private static func parseCardio(
        raw: String,
        tokens: [String],
        library: [String],
        preferredUnit: WeightUnit
    ) -> ParsedSetUtterance? {
        var miles: Double? = nil
        var flights: Int? = nil
        var calories: Int? = nil
        var minutes: Double? = nil
        var consumed = Set<Int>()
        var i = 0
        var saw = false
        while i < tokens.count {
            if let num = parseNumber(tokens, at: i), num.next < tokens.count {
                let unitTok = tokens[num.next]
                if mileWords.contains(unitTok) {
                    miles = Double(num.value); saw = true
                    for k in i...num.next { consumed.insert(k) }
                    i = num.next + 1; continue
                }
                if flightWords.contains(unitTok) {
                    flights = num.value; saw = true
                    var end = num.next + 1
                    if end + 1 < tokens.count, tokens[end] == "of",
                       tokens[end + 1] == "stairs" || tokens[end + 1] == "stair" {
                        end += 2
                    }
                    for k in i..<end { consumed.insert(k) }
                    i = end; continue
                }
                if calWords.contains(unitTok) {
                    calories = num.value; saw = true
                    for k in i...num.next { consumed.insert(k) }
                    i = num.next + 1; continue
                }
                if minWords.contains(unitTok) {
                    minutes = Double(num.value); saw = true
                    for k in i...num.next { consumed.insert(k) }
                    i = num.next + 1; continue
                }
            }
            // Double parse for decimals already handled via Int rounded — also try Double token
            let t0 = tokens[i]
            if t0.range(of: #"^\d+(\.\d+)?$"#, options: .regularExpression) != nil,
               let d = Double(t0), i + 1 < tokens.count {
                let unitTok = tokens[i + 1]
                if mileWords.contains(unitTok) {
                    miles = d; saw = true
                    consumed.insert(i); consumed.insert(i + 1)
                    i += 2; continue
                }
                if flightWords.contains(unitTok) {
                    flights = Int(d.rounded()); saw = true
                    var end = i + 2
                    if end + 1 < tokens.count, tokens[end] == "of",
                       tokens[end + 1] == "stairs" || tokens[end + 1] == "stair" {
                        end += 2
                    }
                    for k in i..<end { consumed.insert(k) }
                    i = end; continue
                }
                if calWords.contains(unitTok) {
                    calories = Int(d.rounded()); saw = true
                    consumed.insert(i); consumed.insert(i + 1)
                    i += 2; continue
                }
                if minWords.contains(unitTok) {
                    minutes = d; saw = true
                    consumed.insert(i); consumed.insert(i + 1)
                    i += 2; continue
                }
            }
            i += 1
        }
        guard saw else { return nil }

        let stop: Set<String> = connectors.union(unitWords).union(repWords)
            .union(mileWords).union(flightWords).union(calWords).union(minWords)
            .union(["sets", "set", "stair", "stairs"])
        var equipWords: [String] = []
        for (idx, t) in tokens.enumerated() {
            if consumed.contains(idx) { continue }
            if stop.contains(t) { continue }
            if ones[t] != nil || tens[t] != nil || t == "hundred" { continue }
            if t.range(of: #"^\d+(\.\d+)?$"#, options: .regularExpression) != nil { continue }
            equipWords.append(t)
        }
        let equipRaw = equipWords.joined(separator: " ")
        let matched = matchEquipment(equipRaw, library: library)
        var confidence = 0.45
        if matched.matched { confidence += 0.35 * matched.score }
        else if !matched.name.isEmpty { confidence += 0.1 }
        let metricCount = [miles != nil, flights != nil, calories != nil, minutes != nil].filter { $0 }.count
        confidence += 0.08 * Double(metricCount)
        confidence = min(1, max(0.05, confidence))

        return ParsedSetUtterance(
            equipmentName: matched.name,
            weight: 0,
            reps: 0,
            unit: preferredUnit,
            confidence: confidence,
            matchedLibrary: matched.matched,
            raw: raw.trimmingCharacters(in: .whitespacesAndNewlines),
            miles: miles,
            flights: flights,
            calories: calories,
            minutes: minutes,
            kind: .cardio
        )
    }


    private static func applyLocked(
        _ parsed: ParsedSetUtterance,
        locked: String,
        lockedKind: SetKind?
    ) -> ParsedSetUtterance {
        guard !locked.isEmpty else { return parsed }
        var out = parsed
        out.equipmentName = locked
        out.matchedLibrary = true
        if let lockedKind { out.kind = lockedKind }
        out.confidence = max(parsed.confidence, 0.85)
        return out
    }

    private static func normalize(_ raw: String) -> String {
        var s = raw.lowercased()
        s = s.replacingOccurrences(of: "×", with: " x ")
        s = s.replacingOccurrences(of: #"(\d)\s*[xX]\s*(\d)"#, with: "$1 x $2", options: .regularExpression)
        s = s.replacingOccurrences(of: #"(\d)\s*/\s*(\d)"#, with: "$1 x $2", options: .regularExpression)
        s = s.replacingOccurrences(of: #"(\d)(miles?|mi|flights?|calories?|cals?|kcals?|minutes?|mins?)\b"#, with: "$1 $2", options: .regularExpression)
        s = s.replacingOccurrences(of: #"\bflights?\s+of\s+stairs?\b"#, with: "flights", options: .regularExpression)
        s = s.replacingOccurrences(of: #"[^\w\s]"#, with: " ", options: .regularExpression)
        s = s.replacingOccurrences(of: #"\b(please|log|set|a|an|the|and)\b"#, with: " ", options: .regularExpression)
        s = s.replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression)
        return s.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private static func parseNumber(_ tokens: [String], at i: Int) -> (value: Int, next: Int)? {
        guard i < tokens.count else { return nil }
        let t0 = tokens[i]
        if t0.range(of: #"^\d+(\.\d+)?$"#, options: .regularExpression) != nil, let d = Double(t0) {
            return (Int(d.rounded()), i + 1)
        }
        if let o = ones[t0], o < 10, i + 1 < tokens.count, tokens[i + 1] == "hundred" {
            var value = o * 100
            let j = i + 2
            if let rest = parseNumber(tokens, at: j), rest.value < 100 {
                value += rest.value
                return (value, rest.next)
            }
            return (value, j)
        }
        if let o = ones[t0], (1...9).contains(o) {
            var j = i + 1
            if j < tokens.count, let t = tens[tokens[j]] {
                var value = o * 100 + t
                j += 1
                if j < tokens.count, let u = ones[tokens[j]], u < 10 {
                    value += u; j += 1
                }
                return (value, j)
            }
            if j < tokens.count, let u = ones[tokens[j]], u >= 10 {
                return (o * 100 + u, j + 1)
            }
        }
        if let t = tens[t0] {
            var value = t
            var j = i + 1
            if j < tokens.count, let u = ones[tokens[j]], u < 10 {
                value += u; j += 1
            }
            return (value, j)
        }
        if let o = ones[t0] { return (o, i + 1) }
        return nil
    }

    private static func detectUnit(_ tokens: [String], fallback: WeightUnit) -> WeightUnit {
        for t in tokens {
            if ["kg", "kilo", "kilos", "kilogram", "kilograms"].contains(t) { return .kg }
            if ["lb", "lbs", "pound", "pounds"].contains(t) { return .lb }
        }
        return fallback
    }

    private static func pickWeightReps(
        spans: [(value: Double, start: Int, end: Int)],
        tokens: [String]
    ) -> (weight: Double, reps: Double, weightStart: Int, boost: Double)? {
        if spans.count == 1 { return (spans[0].value, 0, spans[0].start, -0.25) }
        for s in 1..<spans.count {
            let between = tokens[spans[s - 1].end..<spans[s].start]
            if between.contains(where: { connectors.contains($0) }) {
                return (spans[s - 1].value, spans[s].value, spans[s - 1].start, 0.1)
            }
        }
        if spans.count >= 3 {
            let a = spans[spans.count - 3]
            let mid = spans[spans.count - 2]
            let b = spans[spans.count - 1]
            let midTok = tokens[mid.start]
            let fourish = (1...9).contains(Int(mid.value))
                && (midTok == "four" || midTok == "fore" || midTok == "for" || Int(mid.value) == 4)
            if fourish, a.value >= 15, (1...50).contains(Int(b.value)), a.value > b.value {
                return (a.value, b.value, a.start, 0.05)
            }
        }
        let w = spans[spans.count - 2]
        let r = spans[spans.count - 1]
        if w.value >= 15, (1...50).contains(Int(r.value)) {
            return (w.value, r.value, w.start, 0.05)
        }
        if r.value >= 15, (1...50).contains(Int(w.value)), r.value > w.value {
            return (r.value, w.value, r.start, 0)
        }
        return (w.value, r.value, w.start, 0)
    }

    private static func titleCase(_ name: String) -> String {
        name.split(separator: " ").map { w in
            guard let f = w.first else { return String(w) }
            return String(f).uppercased() + w.dropFirst()
        }.joined(separator: " ")
    }

    private static func score(_ spoken: String, _ libraryName: String) -> Double {
        let a = spoken.lowercased().trimmingCharacters(in: .whitespaces)
        let b = libraryName.lowercased().trimmingCharacters(in: .whitespaces)
        guard !a.isEmpty, !b.isEmpty else { return 0 }
        if a == b { return 1 }
        if b.contains(a) || a.contains(b) {
            return 0.85 + 0.1 * Double(min(a.count, b.count)) / Double(max(a.count, b.count))
        }
        let aw = Set(a.split(separator: " ").map(String.init))
        let bw = b.split(separator: " ").map(String.init)
        let hit = bw.filter { aw.contains($0) }.count
        if hit == 0 { return 0 }
        return Double(hit) / Double(max(bw.count, aw.count)) * 0.75
    }

    private static func matchEquipment(_ candidate: String, library: [String]) -> (name: String, matched: Bool, score: Double) {
        let cleaned = candidate
            .replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression)
            .trimmingCharacters(in: .whitespaces)
        guard !cleaned.isEmpty else { return ("", false, 0) }
        var best: (name: String, score: Double)?
        for name in library {
            let s = score(cleaned, name)
            if best == nil || s > best!.score { best = (name, s) }
        }
        if let best, best.score >= 0.45 { return (best.name, true, best.score) }
        return (titleCase(cleaned), false, 0.35)
    }
}
