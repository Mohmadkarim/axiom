import Foundation
import UIKit

/// Everything on disk, in the same places and formats as earlier versions of Axiom:
/// Application Support/Drawings/<id>.axiom (document JSON) + <id>.meta.json, Files/<id>.bin (books, ink, pictures),
/// settings.json (books list, courses, preferences).
final class Store {
    static let shared = Store()
    private let fm = FileManager.default
    let base: URL
    let drawings: URL
    let files: URL
    let settingsURL: URL

    private init() {
        base = (try? fm.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)) ?? fm.temporaryDirectory
        drawings = base.appendingPathComponent("Drawings", isDirectory: true)
        files = base.appendingPathComponent("Files", isDirectory: true)
        settingsURL = base.appendingPathComponent("settings.json")
        try? fm.createDirectory(at: drawings, withIntermediateDirectories: true)
        try? fm.createDirectory(at: files, withIntermediateDirectories: true)
    }

    static func safe(_ id: String) -> String {
        String(id.unicodeScalars.filter { CharacterSet.alphanumerics.contains($0) || $0 == "-" || $0 == "_" })
    }
    private func docURL(_ id: String) -> URL { drawings.appendingPathComponent(Self.safe(id) + ".axiom") }
    private func metaURL(_ id: String) -> URL { drawings.appendingPathComponent(Self.safe(id) + ".meta.json") }
    func fileURL(_ id: String) -> URL { files.appendingPathComponent(Self.safe(id) + ".bin") }

    // MARK: documents

    func listMeta() -> [JSON] {
        let urls = (try? fm.contentsOfDirectory(at: drawings, includingPropertiesForKeys: nil)) ?? []
        return urls.filter { $0.lastPathComponent.hasSuffix(".meta.json") }.compactMap { (try? Data(contentsOf: $0)).flatMap(JSONIO.object) }
    }
    func loadDoc(_ id: String) -> JSON? { (try? Data(contentsOf: docURL(id))).flatMap(JSONIO.object) }
    func saveDoc(_ doc: JSON, meta: JSON) {
        guard let id = doc.str("id"), !Self.safe(id).isEmpty, let d = JSONIO.data(doc), let m = JSONIO.data(meta) else { return }
        try? d.write(to: docURL(id), options: .atomic)
        try? m.write(to: metaURL(id), options: .atomic)
    }
    func saveMeta(_ meta: JSON) {
        guard let id = meta.str("id"), let m = JSONIO.data(meta) else { return }
        try? m.write(to: metaURL(id), options: .atomic)
    }
    /// the document and its library entry only (its ink stays, for Recently Deleted)
    func removeDocFiles(_ id: String) { try? fm.removeItem(at: docURL(id)); try? fm.removeItem(at: metaURL(id)) }
    func deleteDoc(_ id: String) {
        try? fm.removeItem(at: docURL(id)); try? fm.removeItem(at: metaURL(id))
        for f in ["ink_" + id, "inkbak_" + id] { deleteFile(f) }
    }

    // MARK: files

    func loadFile(_ id: String) -> Data? { try? Data(contentsOf: fileURL(id)) }
    func saveFile(_ id: String, _ data: Data) { try? data.write(to: fileURL(id), options: .atomic) }
    func deleteFile(_ id: String) { try? fm.removeItem(at: fileURL(id)) }
    func hasFile(_ id: String) -> Bool { fm.fileExists(atPath: fileURL(id).path) }

    // MARK: settings

    func loadSettings() -> JSON { (try? Data(contentsOf: settingsURL)).flatMap(JSONIO.object) ?? [:] }
    func saveSettings(_ s: JSON) { if let d = JSONIO.data(s) { try? d.write(to: settingsURL, options: .atomic) } }
}

extension String {
    /// "data:image/png;base64,...." → bytes
    var dataURLBytes: Data? {
        guard hasPrefix("data:"), let comma = firstIndex(of: ",") else { return nil }
        return Data(base64Encoded: String(self[index(after: comma)...]), options: .ignoreUnknownCharacters)
    }
}
extension Data {
    func dataURL(mime: String) -> String { "data:\(mime);base64," + base64EncodedString() }
}
