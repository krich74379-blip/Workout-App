# Workout Log (iOS)

Native SwiftUI workout logger for Kenneth with **SwiftData** persistence and **Siri / App Intents**.

Bundle ID: `com.kenneth.workoutlog` · Deployment: **iOS 17+**

This project is separate from the web PWA at `/workspace/workout-log`.

## Open in Xcode (Mac)

1. Copy or clone this folder to a Mac.
2. Double-click **`WorkoutLog.xcodeproj`** (or open it from Xcode → File → Open).
3. Select the **WorkoutLog** target.
4. **Signing & Capabilities**
   - Team: choose **Kenneth’s Apple Developer team**
   - Confirm bundle id `com.kenneth.workoutlog`
   - Capability **Siri** should already be enabled via `WorkoutLog.entitlements`
5. Choose an **iPhone Simulator** or a physical device.
6. Press **Run** (⌘R).

### If the project fails to open
Use [XcodeGen](https://github.com/yonaskolb/XcodeGen):

```bash
brew install xcodegen
cd WorkoutLogIOS
xcodegen generate
open WorkoutLog.xcodeproj
```

(`project.yml` is included as a regeneratable source of truth.)

## Features

- Log sets: equipment, weight (lb/kg), reps, optional notes
- Today: list / edit / delete today’s sets
- Equipment library: add / rename / delete
- History by day with volume totals
- SwiftData on-device storage
- Dark gym-friendly UI
- Export / import JSON (Settings)
- **Siri**: `LogWorkoutSetIntent` — phrase *or* equipment + weight + reps
- In-app **Speech** mic on the Log tab: **SFSpeechRecognizer (Apple) primary**; optional Whisper server URL in Settings as backup (DualSpeechScorer)

## Siri / “Add to Siri”

### What the intent does
`LogWorkoutSetIntent` accepts:

- **Phrase** — e.g. `bench press 185 for 8`, `squat two twenty five for five`
- **Or** structured **Equipment**, **Weight**, **Reps**, optional **Unit**

It parses the phrase (same style heuristics as the web app), creates/finds equipment in SwiftData, inserts a `WorkoutSet`, and Siri speaks a confirmation like “Logged Bench Press 185 lb × 8.”

App Shortcuts phrases (donated via `WorkoutLogShortcuts`):

- “Log a set in Workout Log”
- “Log workout set in Workout Log”
- “Log ⟨phrase⟩ in Workout Log”

### Add a custom Siri phrase

1. Install the app on a device signed with your team (Simulator has limited Siri).
2. Open **Settings → Siri & Search → Workout Log**  
   — or open the **Shortcuts** app → look for App Shortcut **Log Set**.
3. Tap **Add to Siri** / record a phrase such as **“Log my set”**.
4. Say: **“Hey Siri, log my set”** → when prompted, **“bench press 185 for 8”**.

You can also run the intent from the Shortcuts app with a Dictate Text action filling the Phrase parameter.

## App Store / TestFlight

- Running on your own iPhone with a free Apple ID is possible for short-lived development installs.
- **TestFlight and App Store distribution require the paid [Apple Developer Program](https://developer.apple.com/programs/)** (Kenneth’s team account).
- Enable the **Siri** capability on the App ID in the developer portal if Xcode doesn’t sync it automatically.

## Privacy

- Sets stay on-device (SwiftData).
- Microphone / Speech are only used if you tap the in-app mic.
- Siri audio is handled by the system; the app receives the resulting text/parameters.

## Layout

```
WorkoutLogIOS/
  README.md
  project.yml                 # XcodeGen
  WorkoutLog.xcodeproj/
  WorkoutLog/
    WorkoutLogApp.swift
    Info.plist
    WorkoutLog.entitlements
    Assets.xcassets/
    Models/Models.swift
    Services/…                # parser, store helpers, preferred unit
    Views/…                   # Today, Log, Gear, History, Settings
    Intents/…                 # LogWorkoutSetIntent + shared container
```

## Limitations

- Cannot compile with `xcodebuild` on Linux (no Xcode / iOS SDK here).
- Siri App Shortcuts need a real device for the best experience.
- First App Intent donation may require opening the app once after install.
- In-app mic uses Apple’s Speech framework (on-device/network per system settings), not the web Whisper server.
- No iCloud sync in v1 (local only).
