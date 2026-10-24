import Foundation

/// Drawings live as JSON files in Application Support/Drawings (one document + one small meta file each).
final class DrawingStore {
    private let fm = FileManager.default
    private let dir: URL
    private let settingsURL: URL

    init() {
        let base = (try? fm.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true))
            ?? fm.temporaryDirectory
        dir = base.appendingPathComponent("Drawings", isDirectory: true)
        settingsURL = base.appendingPathComponent("settings.json")
        try? fm.createDirectory(at: dir, withIntermediateDirectories: true)
    }

    private func safe(_ id: String) -> String {
        String(id.unicodeScalars.filter { CharacterSet.alphanumerics.contains($0) || $0 == "-" || $0 == "_" })
    }
    private func docURL(_ id: String) -> URL { dir.appendingPathComponent(safe(id) + ".axiom") }
    private func metaURL(_ id: String) -> URL { dir.appendingPathComponent(safe(id) + ".meta.json") }

    /// JSON array (as a string) of every drawing's meta record.
    func listMeta() -> String {
        let files = (try? fm.contentsOfDirectory(at: dir, includingPropertiesForKeys: nil)) ?? []
        let metas = files.filter { $0.lastPathComponent.hasSuffix(".meta.json") }
            .compactMap { try? String(contentsOf: $0, encoding: .utf8) }
        return "[" + metas.joined(separator: ",") + "]"
    }

    func loadDoc(_ id: String) -> Any {
        (try? String(contentsOf: docURL(id), encoding: .utf8)) ?? NSNull()
    }

    func save(id: String, doc: String, meta: String) throws {
        guard !safe(id).isEmpty else { return }
        try doc.write(to: docURL(id), atomically: true, encoding: .utf8)
        try meta.write(to: metaURL(id), atomically: true, encoding: .utf8)
    }

    func saveMeta(id: String, meta: String) throws {
        guard !safe(id).isEmpty else { return }
        try meta.write(to: metaURL(id), atomically: true, encoding: .utf8)
    }

    func delete(_ id: String) {
        try? fm.removeItem(at: docURL(id))
        try? fm.removeItem(at: metaURL(id))
    }

    private var filesDir: URL {
        let d = dir.deletingLastPathComponent().appendingPathComponent("Files", isDirectory: true)
        try? fm.createDirectory(at: d, withIntermediateDirectories: true)
        return d
    }

    func saveFile(id: String, base64: String) throws {
        guard !safe(id).isEmpty, let data = Data(base64Encoded: base64) else { return }
        try data.write(to: filesDir.appendingPathComponent(safe(id) + ".bin"), options: .atomic)
    }

    func fileURL(_ id: String) -> URL { filesDir.appendingPathComponent(safe(id) + ".bin") }

    func writeFile(id: String, data: Data) throws {
        guard !safe(id).isEmpty else { return }
        try data.write(to: fileURL(id), options: .atomic)
    }

    func loadFile(_ id: String) -> Any {
        guard let data = try? Data(contentsOf: filesDir.appendingPathComponent(safe(id) + ".bin")) else { return NSNull() }
        return data.base64EncodedString()
    }

    func deleteFile(_ id: String) {
        try? fm.removeItem(at: filesDir.appendingPathComponent(safe(id) + ".bin"))
    }

    func loadSettings() -> String? {
        guard let s = try? String(contentsOf: settingsURL, encoding: .utf8),
              let data = s.data(using: .utf8),
              (try? JSONSerialization.jsonObject(with: data)) != nil else { return nil }
        return s
    }

    func saveSettings(_ json: String) {
        try? json.write(to: settingsURL, atomically: true, encoding: .utf8)
    }
}
