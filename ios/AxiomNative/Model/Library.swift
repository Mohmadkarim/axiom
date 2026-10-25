import Foundation
import Observation
import UIKit

struct Subject: Identifiable, Hashable {
    let id: String
    var name: String
    var color: String
    var uiColor: UIColor { UIColor(css: color) }
}

/// A notebook or canvas as listed in the library (its meta file).
struct NoteMeta: Identifiable, Hashable {
    let id: String
    var name: String
    var kind: String            // "notebook" | "canvas"
    var created: Double
    var updated: Double
    var subject: String?
    var folder: String?
    var fav: Bool
    var pages: Int?
    var paper: String?
    var thumb: String?          // data URL
    var raw: JSON
    static func == (a: NoteMeta, b: NoteMeta) -> Bool { a.id == b.id && a.updated == b.updated && a.name == b.name && a.subject == b.subject && a.fav == b.fav && a.thumb?.count == b.thumb?.count }
    func hash(into h: inout Hasher) { h.combine(id) }

    init?(_ j: JSON) {
        guard let id = j.str("id") else { return nil }
        self.id = id
        name = j.str("name") ?? "Untitled"
        kind = j.str("kind") ?? "canvas"
        created = j.num("created") ?? 0
        updated = j.num("updated") ?? created
        subject = j.str("subject")
        folder = j.str("folder")
        fav = j.bool("fav")
        pages = j.int("pages")
        paper = j.str("paper")
        thumb = j.str("thumb")
        raw = j
    }
    var isNotebook: Bool { kind == "notebook" }
}

/// A book, problem sheet or picture added to the library (settings.documents).
struct BookMeta: Identifiable, Hashable {
    let id: String
    var name: String
    var type: String            // "pdf" | "epub" | "image"
    var subject: String?
    var lastPage: Int
    var added: Double
    var lastRead: Double?
    var pages: Int?
    var cover: String?
    var author: String?
    var raw: JSON
    static func == (a: BookMeta, b: BookMeta) -> Bool { a.id == b.id && a.name == b.name && a.lastPage == b.lastPage && a.subject == b.subject && a.cover?.count == b.cover?.count }
    func hash(into h: inout Hasher) { h.combine(id) }
    init?(_ j: JSON) {
        guard let id = j.str("id") else { return nil }
        self.id = id
        name = j.str("title") ?? j.str("name") ?? "Document"
        type = j.str("type") ?? "pdf"
        subject = j.str("subject")
        lastPage = j.int("lastPage") ?? 1
        added = j.num("added") ?? 0
        lastRead = j.num("lastRead")
        pages = j.int("pages")
        cover = j.str("cover")
        author = j.str("author")
        raw = j
    }
    var fileID: String { "doc_" + id }
}

enum PaperTemplate: String, CaseIterable, Identifiable {
    case blank, lined, narrow, wide, grid, smallgrid, graph, dot, cornell, eng, iso, music, polar, todo
    var id: String { rawValue }
    var label: String {
        switch self {
        case .blank: "Blank"; case .lined: "Lined"; case .narrow: "Narrow ruled"; case .wide: "Wide ruled"
        case .grid: "Grid 5 mm"; case .smallgrid: "Grid 4 mm"; case .graph: "Graph (mm)"; case .dot: "Dot grid"
        case .cornell: "Cornell"; case .eng: "Engineering"; case .iso: "Isometric"; case .music: "Music staff"
        case .polar: "Polar"; case .todo: "Checklist"
        }
    }
}

enum PageFormat: String, CaseIterable, Identifiable {
    case a4, letter, a5, a3, legal, square, wide, card
    var id: String { rawValue }
    var name: String { ["a4": "A4", "letter": "US Letter", "a5": "A5", "a3": "A3", "legal": "US Legal", "square": "Square", "wide": "16:9 Slide", "card": "Index card"][rawValue]! }
    /// millimetres, portrait
    var mm: CGSize {
        switch self {
        case .a4: CGSize(width: 210, height: 297); case .letter: CGSize(width: 215.9, height: 279.4); case .a5: CGSize(width: 148, height: 210)
        case .a3: CGSize(width: 297, height: 420); case .legal: CGSize(width: 215.9, height: 355.6); case .square: CGSize(width: 210, height: 210)
        case .wide: CGSize(width: 338.7, height: 190.5); case .card: CGSize(width: 127, height: 76.2)
        }
    }
    /// world units (CSS px at 96 dpi)
    func size(landscape: Bool) -> CGSize {
        let mm: CGFloat = 96 / 25.4, s = self.mm
        let w = s.width * mm, h = s.height * mm
        return landscape ? CGSize(width: max(w, h), height: min(w, h)) : CGSize(width: min(w, h), height: max(w, h))
    }
}

@Observable
final class Library {
    static let shared = Library()
    private let store = Store.shared
    var notes: [NoteMeta] = []
    var books: [BookMeta] = []
    var subjects: [Subject] = []
    private(set) var settings: JSON = [:]

    private init() { reload() }

    func reload() {
        settings = store.loadSettings()
        notes = store.listMeta().compactMap(NoteMeta.init).sorted { $0.updated > $1.updated }
        books = settings.arr("documents").compactMap(BookMeta.init)
        subjects = settings.arr("subjects").compactMap { j in j.str("id").map { Subject(id: $0, name: j.str("name") ?? "Course", color: j.str("color") ?? "#6f9bff") } }
    }

    // MARK: settings

    func setting<T>(_ key: String) -> T? { settings[key] as? T }
    func set(_ key: String, _ value: Any?) {
        settings[key] = value
        saveSettings()
    }
    private var saveWork: DispatchWorkItem?
    func saveSettings() {
        saveWork?.cancel()
        let w = DispatchWorkItem { [weak self] in guard let self else { return }; self.store.saveSettings(self.settings) }
        saveWork = w
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.3, execute: w)
    }
    func flushSettings() { saveWork?.perform(); saveWork?.cancel(); saveWork = nil }

    // MARK: courses

    static let courseColors = ["#3f7be0", "#e0574a", "#2f9e6b", "#c48a1e", "#8a5cd6", "#d6588f", "#2a9db0", "#6b7282"]
    @discardableResult
    func addSubject(_ name: String, color: String? = nil) -> Subject? {
        let n = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !n.isEmpty else { return nil }
        if let ex = subjects.first(where: { $0.name.lowercased() == n.lowercased() }) { return ex }
        let s = Subject(id: UID.make(), name: String(n.prefix(48)), color: color ?? Self.courseColors[subjects.count % Self.courseColors.count])
        subjects.append(s)
        writeSubjects()
        return s
    }
    func removeSubject(_ id: String) { subjects.removeAll { $0.id == id }; writeSubjects() }
    func renameSubject(_ id: String, _ name: String) { if let i = subjects.firstIndex(where: { $0.id == id }) { subjects[i].name = name; writeSubjects() } }
    private func writeSubjects() { set("subjects", subjects.map { ["id": $0.id, "name": $0.name, "color": $0.color] as JSON }) }
    func subject(_ id: String?) -> Subject? { id.flatMap { i in subjects.first { $0.id == i } } }

    // MARK: notebooks and canvases

    func newNotebook(name: String = "Untitled notebook", format: PageFormat = .a4, landscape: Bool = false, template: PaperTemplate = .lined, color: String = "#ffffff", subject: String? = nil) -> String {
        let now = Date().ms, layer = UID.make()
        var doc: JSON = [
            "id": UID.make(), "name": name, "created": now, "updated": now, "v": 1, "kind": "notebook",
            "layers": [["id": layer, "name": "Layer 1", "visible": true, "locked": false, "opacity": 1, "items": []] as JSON],
            "activeLayerId": layer, "layerMode": "manual",
            "view": ["tx": 0, "ty": 0, "zoom": 1, "rot": 0] as JSON,
            "paper": ["bg": color, "grid": ["type": "none", "spacing": 24, "divisions": 5, "opacity": 1] as JSON] as JSON,
            "precision": ["grid": false, "snap": false, "recog": false, "guide": false, "guideType": "line"] as JSON,
            "guides": [:] as JSON, "artboards": [] as [Any],
            "page": ["size": format.rawValue, "orient": landscape ? "landscape" : "portrait", "template": template.rawValue, "color": color, "scroll": "vertical"] as JSON,
            "pages": [["id": UID.make()] as JSON],
            "pkInk": true,
        ]
        if let subject { doc["subject"] = subject }
        save(doc: doc, thumb: nil)
        return doc.str("id")!
    }

    func newCanvas(name: String = "Untitled canvas", paper: String = "#15171c", grid: String = "dot", subject: String? = nil) -> String {
        let now = Date().ms, layer = UID.make()
        var doc: JSON = [
            "id": UID.make(), "name": name, "created": now, "updated": now, "v": 1, "kind": "canvas",
            "layers": [["id": layer, "name": "Layer 1", "visible": true, "locked": false, "opacity": 1, "items": []] as JSON],
            "activeLayerId": layer, "layerMode": "manual",
            "view": ["tx": 0, "ty": 0, "zoom": 1, "rot": 0] as JSON,
            "paper": ["bg": paper, "grid": ["type": grid, "spacing": 24, "divisions": 5, "opacity": 1] as JSON] as JSON,
            "precision": ["grid": grid != "none", "snap": false, "recog": true, "guide": false, "guideType": "line"] as JSON,
            "guides": [:] as JSON, "artboards": [] as [Any], "pkInk": true,
        ]
        if let subject { doc["subject"] = subject }
        save(doc: doc, thumb: nil)
        return doc.str("id")!
    }

    /// write a document and its library entry
    func save(doc: JSON, thumb: String?) {
        var d = doc
        d["updated"] = Date().ms
        let old = notes.first { $0.id == d.str("id") }
        let meta: JSON = [
            "id": d.str("id") ?? "", "name": d.str("name") ?? "Untitled", "created": d.num("created") ?? Date().ms, "updated": d.num("updated")!,
            "thumb": (thumb ?? old?.thumb) as Any, "paper": (d.obj("paper")?.str("bg") ?? "#ffffff"), "subject": d["subject"] ?? NSNull(),
            "kind": d.str("kind") ?? "canvas", "pages": (d.arr("pages").isEmpty ? NSNull() : d.arr("pages").count) as Any,
            "fav": d.bool("fav"), "folder": d["folder"] ?? NSNull(), "rec": d.arr("recordings").count,
        ]
        store.saveDoc(d, meta: meta)
        if let m = NoteMeta(meta) {
            if let i = notes.firstIndex(where: { $0.id == m.id }) { notes[i] = m } else { notes.insert(m, at: 0) }
            notes.sort { $0.updated > $1.updated }
        }
    }
    func loadDoc(_ id: String) -> JSON? { store.loadDoc(id) }

    func updateMeta(_ id: String, _ change: (inout JSON) -> Void) {
        guard var doc = store.loadDoc(id) else { return }
        change(&doc)
        save(doc: doc, thumb: nil)
    }
    func rename(_ id: String, _ name: String) { updateMeta(id) { $0["name"] = String(name.prefix(80)) } }
    func setSubject(_ id: String, _ subject: String?) { updateMeta(id) { $0["subject"] = subject ?? NSNull() } }
    func toggleFav(_ id: String) { updateMeta(id) { $0["fav"] = !$0.bool("fav") } }
    func duplicate(_ id: String) {
        guard var doc = store.loadDoc(id) else { return }
        let nid = UID.make()
        doc["id"] = nid; doc["name"] = (doc.str("name") ?? "Untitled") + " copy"; doc["created"] = Date().ms
        if let ink = store.loadFile("ink_" + id) { store.saveFile("ink_" + nid, ink) }
        save(doc: doc, thumb: notes.first { $0.id == id }?.thumb)
    }
    func delete(_ id: String) {
        store.deleteDoc(id)
        notes.removeAll { $0.id == id }
    }

    // MARK: books

    func importBook(from url: URL, subject: String? = nil) -> BookMeta? {
        let ok = url.startAccessingSecurityScopedResource()
        defer { if ok { url.stopAccessingSecurityScopedResource() } }
        guard let data = try? Data(contentsOf: url) else { return nil }
        let ext = url.pathExtension.lowercased()
        let type = ext == "pdf" ? "pdf" : ext == "epub" ? "epub" : "image"
        let id = UID.make()
        store.saveFile("doc_" + id, data)
        var meta: JSON = ["id": id, "name": String(url.deletingPathExtension().lastPathComponent.prefix(80)), "type": type,
                          "mime": type == "pdf" ? "application/pdf" : type == "epub" ? "application/epub+zip" : "image/jpeg",
                          "subject": subject ?? NSNull(), "size": data.count, "added": Date().ms, "lastPage": 1]
        if type == "epub" { meta["kind"] = "book" }
        if type == "pdf", let info = PDFInfo.read(data) {
            meta["pages"] = info.pages
            if let t = info.title, !t.isEmpty { meta["title"] = t }
            if let a = info.author { meta["author"] = a }
            if let c = info.cover { meta["cover"] = c }
        }
        var docs = settings.arr("documents")
        docs.append(meta)
        set("documents", docs)
        let b = BookMeta(meta)
        if let b { books.append(b) }
        return b
    }
    func updateBook(_ id: String, _ change: (inout JSON) -> Void) {
        var docs = settings.arr("documents")
        guard let i = docs.firstIndex(where: { $0.str("id") == id }) else { return }
        change(&docs[i])
        set("documents", docs)
        if let b = BookMeta(docs[i]), let j = books.firstIndex(where: { $0.id == id }) { books[j] = b }
    }
    func removeBook(_ id: String) {
        set("documents", settings.arr("documents").filter { $0.str("id") != id })
        books.removeAll { $0.id == id }
        store.deleteFile("doc_" + id)
    }
}
