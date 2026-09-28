import SwiftUI

struct RootTabView: View {
    @State private var preferredUnit = PreferredUnitStore()
    @State private var whisperServer = WhisperServerStore()

    var body: some View {
        TabView {
            TodayView()
                .tabItem { Label("Today", systemImage: "sun.max.fill") }
            LogSetView()
                .tabItem { Label("Log", systemImage: "plus.circle.fill") }
            EquipmentLibraryView()
                .tabItem { Label("Gear", systemImage: "list.bullet") }
            HistoryView()
                .tabItem { Label("History", systemImage: "calendar") }
            SettingsView()
                .tabItem { Label("Settings", systemImage: "gearshape.fill") }
        }
        .environment(preferredUnit)
        .environment(whisperServer)
        .preferredColorScheme(.dark)
        .tint(.orange)
    }
}
