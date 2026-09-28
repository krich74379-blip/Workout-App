import SwiftUI
import SwiftData
import Speech
import AVFoundation

struct LogSetView: View {
    @Environment(\.modelContext) private var context
    @Environment(PreferredUnitStore.self) private var preferredUnit
    @Environment(WhisperServerStore.self) private var whisperServer
    @Query(sort: \Equipment.name) private var equipment: [Equipment]

    @State private var equipmentName = ""
    @State private var weightText = ""
    @State private var repsText = ""
    @State private var milesText = ""
    @State private var flightsText = ""
    @State private var distanceAsFlights = false
    @State private var caloriesText = ""
    @State private var minutesText = ""
    @State private var isCardio = false
    @State private var notes = ""
    @State private var unit: WeightUnit = .lb
    @State private var phrase = ""
    @State private var flash: String?
    @State private var error: String?
    @State private var engineNote: String?
    @State private var isTranscribing = false
    @State private var speech = SpeechCapture()
    /// Guided (optional): pick equipment first, speak numbers only. Default off = freeform.
    @State private var guidedMode = false

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Toggle("Guided (optional): pick equipment, then say numbers", isOn: $guidedMode)
                    Text(
                        guidedMode
                            ? "Select equipment below, then mic. Say only numbers (strength: weight/reps/sets; cardio: flights|miles, calories, minutes)."
                            : "Freeform (default): say the full set including equipment name."
                    )
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                }

                Section(isCardio ? "1. Equipment / Cardio" : "1. Equipment / Set") {
                    TextField("Equipment", text: $equipmentName)
                        .onChange(of: equipmentName) { _, new in
                            // Auto-flip cardio when catalog cardio name is chosen
                            let lower = new.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
                            if lower.contains("stair") || lower.contains("treadmill") || lower.contains("bike") || lower.contains("elliptical") || lower.contains("rower") || lower.contains("row erg") {
                                isCardio = true
                                if lower.contains("stair") { distanceAsFlights = true }
                            }
                        }
                    if !suggestions.isEmpty {
                        ScrollView(.horizontal, showsIndicators: false) {
                            HStack {
                                ForEach(suggestions, id: \.id) { eq in
                                    Button(eq.name) {
                                        equipmentName = eq.name
                                        let lower = eq.name.lowercased()
                                        if lower.contains("stair") || lower.contains("treadmill") || lower.contains("bike") || lower.contains("elliptical") || lower.contains("rower") {
                                            isCardio = true
                                            if lower.contains("stair") { distanceAsFlights = true }
                                        }
                                    }
                                    .buttonStyle(.bordered)
                                    .tint(equipmentName == eq.name ? .orange : .secondary)
                                }
                            }
                        }
                    }
                    Toggle("Cardio (miles/flights / cal / min)", isOn: $isCardio)
                    if isCardio {
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
                            Picker("Unit", selection: $unit) {
                                ForEach(WeightUnit.allCases) { Text($0.label).tag($0) }
                            }
                            .pickerStyle(.segmented)
                            .frame(maxWidth: 120)
                        }
                        TextField("Reps", text: $repsText).keyboardType(.numberPad)
                    }
                    TextField("Notes (optional)", text: $notes)
                }

                Section("2. Voice numbers") {
                    if guidedMode {
                        Text(
                            isCardio
                                ? "Say e.g. “10 flights 200 calories 35 minutes”"
                                : "Say e.g. “90 for 15 for 3 sets”"
                        )
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                    } else {
                        TextField("bench press 185 for 8", text: $phrase, axis: .vertical)
                            .lineLimit(2...4)
                    }
                    if guidedMode, !phrase.isEmpty {
                        Text("Heard: \(phrase)")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    }
                    HStack {
                        if !guidedMode {
                            Button("Parse & fill") { applyPhrase() }
                        }
                        Spacer()
                        Button {
                            Task { await toggleMic() }
                        } label: {
                            Label(
                                speech.isRunning ? "Stop" : (isTranscribing ? "…" : "Mic"),
                                systemImage: speech.isRunning
                                    ? "stop.circle.fill"
                                    : "mic.circle.fill"
                            )
                        }
                        .tint(speech.isRunning ? .red : .orange)
                        .disabled(isTranscribing || (guidedMode && equipmentName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !speech.isRunning))
                    }
                    if let engineNote {
                        Text(engineNote)
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    }
                    Text(
                        whisperServer.isConfigured
                            ? "Apple SFSpeech primary · Whisper backup. Status shows which engine won."
                            : "Apple SFSpeech primary. Optional Whisper backup: set server URL in Settings."
                    )
                    .font(.footnote).foregroundStyle(.secondary)
                }

                if let error { Text(error).foregroundStyle(.red) }
                if let flash { Text(flash).foregroundStyle(.green) }

                Button(isCardio ? "Save cardio" : "Save set") { save() }
                    .buttonStyle(.borderedProminent)
                    .tint(.orange)
            }
            .navigationTitle("Log")
            .onAppear { unit = preferredUnit.unit }
            .onChange(of: speech.transcript) { _, new in
                // Live Apple interim — final dual pick happens on stop.
                if speech.isRunning, !new.isEmpty { phrase = new }
            }
        }
    }


    private var lockedEquipmentForParse: String? {
        guard guidedMode else { return nil }
        let n = equipmentName.trimmingCharacters(in: .whitespacesAndNewlines)
        return n.isEmpty ? nil : n
    }

    private var lockedKindForParse: SetKind? {
        guard guidedMode, lockedEquipmentForParse != nil else { return nil }
        return isCardio ? .cardio : .strength
    }

    private var suggestions: [Equipment] {
        let q = equipmentName.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        if q.isEmpty { return Array(equipment.prefix(8)) }
        return equipment.filter { $0.name.lowercased().contains(q) }.prefix(8).map { $0 }
    }

    @MainActor
    private func toggleMic() async {
        if speech.isRunning {
            await finishDualSpeech()
            return
        }
        if guidedMode && equipmentName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            error = "Pick equipment first, then tap Mic and say the numbers only."
            return
        }
        error = nil
        engineNote = nil
        flash = nil
        speech.start { err in
            self.error = err
        }
    }

    @MainActor
    private func finishDualSpeech() async {
        isTranscribing = true
        engineNote = "Apple speech (primary)…"
        let result = speech.stopAndCollect()
        let appleRaw = result.transcript.trimmingCharacters(in: .whitespacesAndNewlines)
        let names = equipment.map(\.name)

        var appleClean = ""
        if !appleRaw.isEmpty {
            appleClean = GymTranscriptCleanup.correct(appleRaw)
            if appleClean.isEmpty { appleClean = appleRaw }
        }

        var whisperClean = ""
        if whisperServer.isConfigured,
           let url = whisperServer.transcribeURL,
           let wav = result.wavData,
           wav.count > 44
        {
            engineNote = appleClean.isEmpty
                ? "Apple empty — Whisper backup…"
                : "Checking Whisper backup…"
            do {
                let whisperRaw = try await WhisperAPIClient.transcribe(wav: wav, to: url)
                whisperClean = GymTranscriptCleanup.correct(whisperRaw)
                if whisperClean.isEmpty { whisperClean = whisperRaw }
            } catch {
                // Graceful Apple-only fallback
                engineNote = "Whisper unreachable — Apple only"
            }
        }

        var candidates: [ScoredParseCandidate] = []
        if !appleClean.isEmpty {
            candidates.append(
                ScoredParseCandidate(
                    engine: .apple,
                    transcript: appleClean,
                    parsed: SetUtteranceParser.parse(
                        appleClean,
                        equipmentNames: names,
                        preferredUnit: unit,
                        lockedEquipment: lockedEquipmentForParse,
                        lockedKind: lockedKindForParse
                    )
                )
            )
        }
        if !whisperClean.isEmpty {
            candidates.append(
                ScoredParseCandidate(
                    engine: .whisper,
                    transcript: whisperClean,
                    parsed: SetUtteranceParser.parse(
                        whisperClean,
                        equipmentNames: names,
                        preferredUnit: unit,
                        lockedEquipment: lockedEquipmentForParse,
                        lockedKind: lockedKindForParse
                    )
                )
            )
        }

        isTranscribing = false

        guard let best = DualSpeechScorer.pickBest(candidates, preferAppleOnTie: true) else {
            if engineNote?.contains("Whisper unreachable") == true {
                error = "No Apple transcript and Whisper unreachable. Try again or type the phrase."
            } else {
                error = "No speech detected — try again."
            }
            engineNote = nil
            return
        }

        phrase = best.transcript
        engineNote = best.engineLabel
        applyParsed(best.parsed, fallbackTranscript: best.transcript)
    }

    private func applyPhrase() {
        error = nil
        engineNote = nil
        let cleaned = GymTranscriptCleanup.correct(phrase)
        let heard = cleaned.isEmpty ? phrase : cleaned
        phrase = heard
        let parsed = SetUtteranceParser.parse(
            heard,
            equipmentNames: equipment.map(\.name),
            preferredUnit: unit,
            lockedEquipment: lockedEquipmentForParse,
            lockedKind: lockedKindForParse
        )
        applyParsed(parsed, fallbackTranscript: heard)
    }

    private func applyParsed(_ parsed: ParsedSetUtterance?, fallbackTranscript: String) {
        guard let parsed else {
            error = "Couldn’t parse “\(fallbackTranscript)”."
            return
        }
        // Guided: locked equipment wins; freeform uses parse (blank if unmatched).
        if guidedMode {
            let locked = equipmentName.trimmingCharacters(in: .whitespacesAndNewlines)
            if locked.isEmpty {
                equipmentName = parsed.equipmentName
            }
            // keep isCardio from toggle / equipment pick unless parse is clearly cardio
            if parsed.isCardio { isCardio = true }
        } else {
            equipmentName = parsed.equipmentName
            isCardio = parsed.isCardio
        }
        if parsed.isCardio {
            if let f = parsed.flights, f > 0 {
                flightsText = String(f)
                milesText = ""
                distanceAsFlights = true
            } else if let m = parsed.miles, m > 0 {
                milesText = m.rounded() == m ? String(Int(m)) : String(format: "%.1f", m)
                flightsText = ""
                distanceAsFlights = false
            }
            if let c = parsed.calories, c > 0 { caloriesText = String(c) }
            if let min = parsed.minutes, min > 0 {
                minutesText = min.rounded() == min ? String(Int(min)) : String(format: "%.1f", min)
            }
            weightText = ""
            repsText = ""
        } else {
            if parsed.weight > 0 {
                weightText = parsed.weight.rounded() == parsed.weight
                    ? String(Int(parsed.weight)) : String(format: "%.1f", parsed.weight)
            }
            if parsed.reps > 0 { repsText = String(parsed.reps) }
            milesText = ""; flightsText = ""; distanceAsFlights = false
            caloriesText = ""; minutesText = ""
        }
        unit = parsed.unit
        if parsed.equipmentName.isEmpty {
            error = "Heard: “\(fallbackTranscript)” — pick equipment, then save."
        } else {
            error = nil
        }
    }

    private func save() {
        error = nil
        flash = nil
        do {
            if isCardio {
                let miles = distanceAsFlights ? nil : Double(milesText.replacingOccurrences(of: ",", with: "."))
                let flights = distanceAsFlights ? Int(flightsText) : nil
                let calories = Int(caloriesText)
                let minutes = Double(minutesText.replacingOccurrences(of: ",", with: "."))
                _ = try WorkoutStoreHelpers.logSet(
                    equipmentName: equipmentName,
                    unit: unit,
                    notes: notes.isEmpty
                        ? (phrase.isEmpty ? nil : "Voice: \(phrase)")
                        : notes,
                    miles: miles,
                    flights: flights,
                    calories: calories,
                    minutes: minutes,
                    kind: .cardio,
                    in: context
                )
                milesText = ""; flightsText = ""; distanceAsFlights = false
                caloriesText = ""; minutesText = ""
            } else {
                let w = Double(weightText.replacingOccurrences(of: ",", with: ".")) ?? -1
                let r = Int(repsText) ?? -1
                _ = try WorkoutStoreHelpers.logSet(
                    equipmentName: equipmentName,
                    weight: w,
                    unit: unit,
                    reps: r,
                    notes: notes.isEmpty
                        ? (phrase.isEmpty ? nil : "Voice: \(phrase)")
                        : notes,
                    in: context
                )
                preferredUnit.unit = unit
                repsText = ""
            }
            flash = "Logged"
            notes = ""
            phrase = ""
            engineNote = nil
        } catch {
            self.error = error.localizedDescription
        }
    }
}

struct SpeechCaptureResult: Sendable {
    var transcript: String
    var wavData: Data?
}

@Observable
final class SpeechCapture {
    private let recognizer = SFSpeechRecognizer(locale: Locale(identifier: "en-US"))
    private let audioEngine = AVAudioEngine()
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var task: SFSpeechRecognitionTask?
    private var pcmSamples: [Float] = []
    private var captureSampleRate: Double = 16_000
    var transcript = ""
    var isRunning = false

    func start(onError: @escaping (String) -> Void) {
        SFSpeechRecognizer.requestAuthorization { status in
            DispatchQueue.main.async {
                guard status == .authorized else {
                    onError("Enable Speech Recognition in Settings.")
                    return
                }
                AVAudioApplication.requestRecordPermission { ok in
                    DispatchQueue.main.async {
                        guard ok else { onError("Microphone permission denied."); return }
                        self.begin(onError: onError)
                    }
                }
            }
        }
    }

    private func begin(onError: @escaping (String) -> Void) {
        _ = stopAndCollect()
        guard let recognizer, recognizer.isAvailable else {
            onError("Speech recognizer unavailable."); return
        }
        do {
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.record, mode: .measurement, options: .duckOthers)
            try session.setActive(true, options: .notifyOthersOnDeactivation)
        } catch {
            onError("Audio session error."); return
        }
        let request = SFSpeechAudioBufferRecognitionRequest()
        request.shouldReportPartialResults = true
        if recognizer.supportsOnDeviceRecognition {
            request.requiresOnDeviceRecognition = false // allow network Apple ASR quality
        }
        self.request = request
        transcript = ""
        pcmSamples = []
        isRunning = true
        let input = audioEngine.inputNode
        let format = input.outputFormat(forBus: 0)
        captureSampleRate = format.sampleRate > 0 ? format.sampleRate : 44_100
        input.installTap(onBus: 0, bufferSize: 1024, format: format) { [weak self] buffer, _ in
            request.append(buffer)
            let floats = WavEncoder.floats(from: buffer)
            if !floats.isEmpty {
                DispatchQueue.main.async {
                    self?.pcmSamples.append(contentsOf: floats)
                }
            }
        }
        audioEngine.prepare()
        do { try audioEngine.start() }
        catch { onError("Couldn’t start microphone."); _ = stopAndCollect(); return }
        task = recognizer.recognitionTask(with: request) { [weak self] result, error in
            guard let self else { return }
            if let result { self.transcript = result.bestTranscription.formattedString }
            if error != nil || (result?.isFinal ?? false) {
                // Don't auto-stop on partial final while user still holds session —
                // only stop when caller invokes stopAndCollect, or on hard error.
                if error != nil { _ = self.stopAndCollect() }
            }
        }
    }

    /// Stop mic + recognizer; return Apple transcript and WAV for Whisper (if any).
    @discardableResult
    func stopAndCollect() -> SpeechCaptureResult {
        let apple = transcript
        var wav: Data?
        if audioEngine.isRunning {
            audioEngine.stop()
            audioEngine.inputNode.removeTap(onBus: 0)
        }
        request?.endAudio()
        // finish() delivers final results; cancel() discards them.
        if task != nil {
            task?.finish()
        }
        request = nil
        task = nil
        isRunning = false

        if pcmSamples.count > Int(captureSampleRate * 0.2) {
            let resampled = WavEncoder.resampleTo16k(pcmSamples, sampleRate: captureSampleRate)
            wav = WavEncoder.monoFloat32ToWav(resampled, sampleRate: 16_000)
        }
        pcmSamples = []
        return SpeechCaptureResult(transcript: apple, wavData: wav)
    }

    func stop() {
        _ = stopAndCollect()
    }
}
