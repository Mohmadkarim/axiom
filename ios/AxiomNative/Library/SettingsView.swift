import SwiftUI

struct SettingsView: View {
    @Environment(Library.self) private var lib
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Form {
                Section("Appearance") {
                    Picker("Theme", selection: binding("theme", "dark")) { Text("Dark").tag("dark"); Text("Light").tag("light"); Text("Match iPad").tag("system") }
                }
                Section {
                    Toggle("Two-finger tap to undo", isOn: boolBinding("twoFingerUndo", true))
                    Toggle("Three-finger tap to redo", isOn: boolBinding("threeFingerRedo", true))
                    Toggle("Draw and hold to make shapes", isOn: boolBinding("shapeHold", true))
                    Picker("Pencil double-tap", selection: binding("pencilTap", "system")) {
                        Text("iPad setting").tag("system"); Text("Eraser").tag("switchEraser"); Text("Last tool").tag("switchPrevious"); Text("Colours").tag("showColorPalette"); Text("Undo").tag("undo")
                    }
                } header: { Text("Pencil and gestures") } footer: { Text("Press and hold with a finger on ink or a picture to select it; on empty paper it opens the page menu.") }
                Section("Tutor") {
                    SecureField("Claude API key", text: binding("aiKey", ""))
                    Picker("Model", selection: binding("aiModel", "claude-opus-5-5")) {
                        Text("Claude Opus 5.5").tag("claude-opus-5-5"); Text("Claude Sonnet 5.5").tag("claude-sonnet-5-5"); Text("Claude Haiku 5.5").tag("claude-haiku-5-5")
                    }
                }
            }
            .navigationTitle("Settings").navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
        }
    }

    private func binding(_ key: String, _ def: String) -> Binding<String> {
        Binding(get: { lib.settings.str(key) ?? def }, set: { lib.set(key, $0) })
    }
    private func boolBinding(_ key: String, _ def: Bool) -> Binding<Bool> {
        Binding(get: { (lib.settings[key] as? Bool) ?? def }, set: { lib.set(key, $0) })
    }
}
