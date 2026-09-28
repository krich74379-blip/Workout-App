import Foundation

enum WhisperAPIError: LocalizedError {
    case notConfigured
    case badStatus(Int, String)
    case emptyTranscript
    case network(String)

    var errorDescription: String? {
        switch self {
        case .notConfigured:
            return "Whisper server URL not set (Settings)."
        case .badStatus(let code, let body):
            return body.isEmpty ? "Whisper HTTP \(code)" : body
        case .emptyTranscript:
            return "Whisper returned empty transcript."
        case .network(let msg):
            return msg
        }
    }
}

enum WhisperAPIClient {
    /// POST WAV bytes to `{base}/api/transcribe` (same contract as the PWA).
    static func transcribe(wav: Data, to url: URL) async throws -> String {
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("audio/wav", forHTTPHeaderField: "Content-Type")
        request.timeoutInterval = 60
        request.httpBody = wav

        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await URLSession.shared.data(for: request)
        } catch {
            throw WhisperAPIError.network(
                "Could not reach Whisper server. Check the URL / tunnel, or use Apple-only."
            )
        }
        guard let http = response as? HTTPURLResponse else {
            throw WhisperAPIError.network("Invalid response from Whisper server.")
        }
        let payload = (try? JSONSerialization.jsonObject(with: data) as? [String: Any]) ?? [:]
        if !(200...299).contains(http.statusCode) {
            let err = (payload["error"] as? String) ?? ""
            throw WhisperAPIError.badStatus(http.statusCode, err)
        }
        let text = ((payload["text"] as? String) ?? "")
            .replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { throw WhisperAPIError.emptyTranscript }
        return text
    }
}
