import Foundation

enum SpeechEngine: String, Sendable {
    case apple
    case whisper

    var displayLabel: String {
        switch self {
        case .apple: return "Used Apple speech"
        case .whisper: return "Used Whisper"
        }
    }
}

struct ScoredParseCandidate: Sendable {
    var engine: SpeechEngine
    var transcript: String
    var parsed: ParsedSetUtterance?
}

struct BestParseResult: Sendable {
    var engine: SpeechEngine
    var transcript: String
    var parsed: ParsedSetUtterance?
    var score: Double
    var engineLabel: String
}

/// Mirrors web `pickBestParse.ts` — Apple primary, Whisper backup.
enum DualSpeechScorer {
    static func score(_ parsed: ParsedSetUtterance?) -> Double {
        guard let parsed else { return 0 }
        var score = 0.0
        if parsed.matchedLibrary && !parsed.equipmentName.trimmingCharacters(in: .whitespaces).isEmpty {
            score += 40
        } else if !parsed.equipmentName.trimmingCharacters(in: .whitespaces).isEmpty {
            score += 15
        }
        if parsed.isCardio {
            if (parsed.miles ?? 0) > 0 { score += 10 }
            if (parsed.flights ?? 0) > 0 { score += 10 }
            if (parsed.calories ?? 0) > 0 { score += 10 }
            if (parsed.minutes ?? 0) > 0 { score += 10 }
        } else {
            if parsed.weight > 0 { score += 15 }
            if parsed.reps > 0 { score += 15 }
        }
        score += min(1, max(0, parsed.confidence)) * 20
        return score
    }

    static func isStrongAppleCatalogParse(_ parsed: ParsedSetUtterance?) -> Bool {
        guard let parsed else { return false }
        let metricsOk = parsed.isCardio
            ? ((parsed.miles ?? 0) > 0 || (parsed.flights ?? 0) > 0 || (parsed.calories ?? 0) > 0 || (parsed.minutes ?? 0) > 0)
            : (parsed.weight > 0 && parsed.reps > 0)
        return parsed.matchedLibrary
            && !parsed.equipmentName.trimmingCharacters(in: .whitespaces).isEmpty
            && metricsOk
            && parsed.confidence >= 0.55
    }

    /// Apple-primary: higher score wins; tie → Apple.
    /// If Apple has a catalog match and Whisper does not, prefer Apple unless
    /// Whisper's score is more than 5 points higher.
    static func pickBest(
        _ candidates: [ScoredParseCandidate],
        preferAppleOnTie: Bool = true
    ) -> BestParseResult? {
        let usable = candidates.filter {
            !$0.transcript.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        }
        guard !usable.isEmpty else { return nil }

        var scored = usable.map { c -> (ScoredParseCandidate, Double) in
            (c, score(c.parsed))
        }

        let apple = scored.first { $0.0.engine == .apple }
        let whisper = scored.first { $0.0.engine == .whisper }

        if preferAppleOnTie,
           let apple,
           let whisper,
           let appleParsed = apple.0.parsed,
           appleParsed.matchedLibrary,
           !appleParsed.equipmentName.trimmingCharacters(in: .whitespaces).isEmpty
        {
            let whisperHasCatalog =
                (whisper.0.parsed?.matchedLibrary == true)
                && !(whisper.0.parsed?.equipmentName.trimmingCharacters(in: .whitespaces).isEmpty ?? true)
            if !whisperHasCatalog, apple.1 + 5 >= whisper.1 {
                return BestParseResult(
                    engine: .apple,
                    transcript: apple.0.transcript,
                    parsed: apple.0.parsed,
                    score: apple.1,
                    engineLabel: SpeechEngine.apple.displayLabel
                )
            }
        }

        scored.sort { a, b in
            if a.1 != b.1 { return a.1 > b.1 }
            if preferAppleOnTie {
                if a.0.engine == .apple && b.0.engine != .apple { return true }
                if b.0.engine == .apple && a.0.engine != .apple { return false }
            } else {
                if a.0.engine == .whisper && b.0.engine != .whisper { return true }
                if b.0.engine == .whisper && a.0.engine != .whisper { return false }
            }
            return false
        }
        let best = scored[0]
        return BestParseResult(
            engine: best.0.engine,
            transcript: best.0.transcript,
            parsed: best.0.parsed,
            score: best.1,
            engineLabel: best.0.engine.displayLabel
        )
    }
}
