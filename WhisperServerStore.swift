import Foundation
import Observation

/// Base URL for the workout-log Node server (e.g. Cloudflare tunnel).
/// When empty, native mic uses Apple speech only.
@Observable
final class WhisperServerStore {
    static let defaultsKey = "workoutlog.whisperServerURL"

    var baseURLString: String {
        didSet {
            let trimmed = baseURLString.trimmingCharacters(in: .whitespacesAndNewlines)
            if trimmed != baseURLString { baseURLString = trimmed; return }
            UserDefaults.standard.set(trimmed, forKey: Self.defaultsKey)
        }
    }

    var isConfigured: Bool {
        guard let url = URL(string: baseURLString),
              let scheme = url.scheme?.lowercased(),
              scheme == "http" || scheme == "https",
              url.host != nil
        else { return false }
        return true
    }

    var transcribeURL: URL? {
        guard isConfigured, var url = URL(string: baseURLString) else { return nil }
        // Normalize trailing slash then append /api/transcribe
        if url.path.hasSuffix("/") {
            url = url.deletingLastPathComponent()
            // deletingLastPathComponent on "https://host/" can drop host path oddly — rebuild
            if let rebuilt = URL(string: baseURLString.trimmingCharacters(in: CharacterSet(charactersIn: "/"))) {
                url = rebuilt
            }
        }
        return url.appendingPathComponent("api/transcribe")
    }

    init() {
        baseURLString =
            UserDefaults.standard.string(forKey: Self.defaultsKey)
            ?? ""
    }
}
