import Foundation

/// Lightweight mirror of web `correctGymTranscript` for native dual-path.
/// Full accent / phrase maps live in the PWA shared JS; this covers common
/// fillers and a few high-value gym mishears so Apple + Whisper both get cleanup.
enum GymTranscriptCleanup {
    static func correct(_ raw: String) -> String {
        var s = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !s.isEmpty else { return s }

        s = s.replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression)

        // Strip common ASR lead-ins
        let leadIns: [String] = [
            #"^(please\s+)?log(\s+a)?\s+"#,
            #"^(hey\s+siri[, ]*)+"#,
            #"^(ok(ay)?\s+)"#,
            #"^(um+|uh+)\s+"#,
        ]
        for pat in leadIns {
            s = s.replacingOccurrences(
                of: pat,
                with: "",
                options: [.regularExpression, .caseInsensitive]
            )
        }

        // High-value gym phrase fixes (case-insensitive)
        let phraseFixes: [(String, String)] = [
            // Class: by|bi|bye said curl → bicep curl; force it → 4 sets; for the pounds → 40
            (#"\b(by|bi|bye|buy)\s+(said|say|sed)\s+(lag |leg )?curls?\b"#, "bicep curl"),
            (#"\bforce(d)?\s+it\b"#, "4 sets"),
            (#"\bfor\s+(the|tha|da)\s+pounds?\b"#, "40 pounds"),
            (#"\bleg curls?\b"#, "leg curl"),
            (#"\blag (curl|press)\b"#, "leg $1"),
            (#"\bcalf presses?\b"#, "calf press"),
            (#"\bcalf raise?s?\b"#, "calf raise"),
            (#"\bbench presses?\b"#, "bench press"),
            (#"\bchest presses?\b"#, "chest press"),
            (#"\bleg presses?\b"#, "leg press"),
            (#"\bglute bridges?\b"#, "glute bridge"),
            (#"\bpounds?\b"#, "pounds"),
            (#"\blbs?\b"#, "lbs"),
            (#"\b(\d)\s*[xX]\s*(\d)\b"#, "$1 x $2"),
            (#"\bfor\s+for\b"#, "for"),
            (#"\band\s+and\b"#, "and"),
        ]
        for (pat, rep) in phraseFixes {
            s = s.replacingOccurrences(
                of: pat,
                with: rep,
                options: [.regularExpression, .caseInsensitive]
            )
        }

        s = s.replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression)
        return s.trimmingCharacters(in: .whitespacesAndNewlines)
    }
}
