import SwiftUI
import SwiftData
import UniformTypeIdentifiers

struct SettingsView: View {
    @Environment(\.modelContext) private var context
    @Environment(PreferredUnitStore.self) private var preferredUnit
    @Environment(WhisperServerStore.self) private var whisperServer
    @State private var exportURL: URL?
    @State private var showImporter = false
    @State private var showExporter = false
    @State private var message: String?

    var body: some View {
        NavigationStack {
            Form {
                Section("Preferences") {
                    Picker("Preferred unit", selection: Bindable(preferredUnit).unit) {
                        ForEach(WeightUnit.allCases) { Text($0.label.uppercased()).tag($0) }
                    }
                    .pickerStyle(.segmented)
                }
                Section {
                    TextField(
                        "https://your-tunnel.trycloudflare.com",
                        text: Bindable(whisperServer).baseURLString
                    )
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .keyboardType(.URL)
                    Text(
                        whisperServer.isConfigured
                            ? "Whisper backup ready. Mic still uses Apple speech first."
                            : "Leave blank for Apple-only. Paste the PWA tunnel base URL to enable Whisper backup."
                    )
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                } header: {
                    Text("Whisper backup (optional)")
                } footer: {
                    Text("Apple / SFSpeechRecognizer is always primary. Whisper only runs when a server URL is set, and only wins if it scores better.")
                        .font(.footnote)
                }
                Section("Siri") {
                    Text("Add a Siri phrase for “Log Workout Set” in Settings → Siri & Search → Workout Log, or via the Shortcuts app (App Shortcut: Log Set).")
                        .font(.footnote).foregroundStyle(.secondary)
                    Text("Example: “Hey Siri, log a set in Workout Log” → “bench press 185 for 8”.")
                        .font(.footnote)
                }
                Section("Data") {
                    Button("Export JSON") { exportJSON() }
                    Button("Import JSON") { showImporter = true }
                }
                if let message { Section { Text(message).font(.footnote) } }
                Section("About") {
                    Text("Everything stays on-device (SwiftData). App Store / TestFlight requires the paid Apple Developer Program.")
                        .font(.footnote).foregroundStyle(.secondary)
                }
            }
            .navigationTitle("Settings")
            .fileImporter(isPresented: $showImporter, allowedContentTypes: [.json]) { result in
                switch result {
                case .success(let urls):
                    if let url = urls.first { importJSON(url) }
                case .failure(let err):
                    message = err.localizedDescription
                }
            }
            .sheet(isPresented: $showExporter) {
                if let exportURL {
                    ShareLink(item: exportURL) { Text("Share export") }.padding()
                }
            }
        }
    }

    private func exportJSON() {
        do {
            let data = try WorkoutStoreHelpers.exportData(preferredUnit: preferredUnit.unit, in: context)
            let url = FileManager.default.temporaryDirectory.appendingPathComponent("workout-log-export.json")
            try data.write(to: url, options: .atomic)
            exportURL = url
            showExporter = true
            message = "Export ready."
        } catch { message = error.localizedDescription }
    }

    private func importJSON(_ url: URL) {
        do {
            let ok = url.startAccessingSecurityScopedResource()
            defer { if ok { url.stopAccessingSecurityScopedResource() } }
            let data = try Data(contentsOf: url)
            let result = try WorkoutStoreHelpers.importData(data, into: context)
            message = "Imported \(result.equipment) equipment, \(result.sets) sets."
        } catch { message = error.localizedDescription }
    }
}
