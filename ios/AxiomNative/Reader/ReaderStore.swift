import PDFKit
import PencilKit
import UIKit

/// A book's annotations, in the same file as before (ann_<id>: highlights with page-relative rects, tutor chats),
/// and its handwriting: one PencilKit drawing per page in page points (rdink_<id>).
final class ReaderStore {
    let bookID: String
    var ann: JSON
    var highlights: [Highlight]
    private(set) var ink: [Int: PKDrawing] = [:]     // page index (0-based) → drawing in page points

    struct Highlight: Identifiable {
        let id: String
        var page: Int                // 1-based, as stored
        var rects: [CGRect]          // page-relative fractions, top-left origin
        var color: String            // yellow | green | blue | pink
        var text: String
        var created: Double
        var json: JSON { ["id": id, "page": page, "rect": rects.first.map { [$0.minX, $0.minY, $0.maxX, $0.maxY] } ?? [], "rects": rects.map { [$0.minX, $0.minY, $0.maxX, $0.maxY] }, "color": color, "text": text, "created": created] }
        init(id: String = UID.make(), page: Int, rects: [CGRect], color: String, text: String) { self.id = id; self.page = page; self.rects = rects; self.color = color; self.text = text; created = Date().ms }
        init?(_ j: JSON) {
            guard let p = j.int("page") else { return nil }
            id = j.str("id") ?? UID.make(); page = p; color = j.str("color") ?? "yellow"; text = j.str("text") ?? ""; created = j.num("created") ?? 0
            func rect(_ a: [Double]) -> CGRect? { a.count == 4 ? CGRect(x: a[0], y: a[1], width: a[2] - a[0], height: a[3] - a[1]) : nil }
            let rs = (j["rects"] as? [Any])?.compactMap { ($0 as? [Any])?.compactMap { ($0 as? NSNumber)?.doubleValue } }.compactMap(rect) ?? []
            rects = rs.isEmpty ? (rect(j.nums("rect")).map { [$0] } ?? []) : rs
        }
    }

    static let colors: [String: UIColor] = [
        "yellow": UIColor(red: 1, green: 210 / 255, blue: 0, alpha: 0.36), "green": UIColor(red: 70 / 255, green: 205 / 255, blue: 110 / 255, alpha: 0.30),
        "blue": UIColor(red: 70 / 255, green: 150 / 255, blue: 1, alpha: 0.28), "pink": UIColor(red: 1, green: 90 / 255, blue: 160 / 255, alpha: 0.26),
    ]

    init(bookID: String) {
        self.bookID = bookID
        ann = Store.shared.loadFile("ann_" + bookID).flatMap(JSONIO.object) ?? [:]
        highlights = ann.arr("highlights").compactMap(Highlight.init)
    }

    func saveAnnotations() {
        ann["highlights"] = highlights.map(\.json)
        if let d = JSONIO.data(ann) { Store.shared.saveFile("ann_" + bookID, d) }
    }

    // MARK: ink

    /// load the handwriting; written by earlier versions it is converted once (their stacked PencilKit drawing, or
    /// their own strokes stored as page fractions)
    func loadInk(document: PDFDocument) {
        if let d = Store.shared.loadFile("rdink_" + bookID), let j = JSONIO.object(d) {
            for (k, v) in j { if let i = Int(k), let s = v as? String, let data = Data(base64Encoded: s), let drawing = try? PKDrawing(data: data) { ink[i] = drawing } }
            return
        }
        let pageSizes = (0..<document.pageCount).map { document.page(at: $0)?.bounds(for: .cropBox).size ?? CGSize(width: 612, height: 792) }
        if let d = Store.shared.loadFile("ink_rd_" + bookID), let stacked = try? PKDrawing(data: d) {
            // pages were 1000 units wide, stacked with a 24-unit gap
            var tops: [CGFloat] = [], y: CGFloat = 0
            for s in pageSizes { tops.append(y); y += 1000 * s.height / max(1, s.width) + 24 }
            for st in stacked.strokes {
                let b = st.renderBounds
                var idx = tops.lastIndex { $0 <= b.midY + 12 } ?? 0
                idx = min(max(0, idx), pageSizes.count - 1)
                let k = pageSizes[idx].width / 1000
                let t = CGAffineTransform(translationX: 0, y: -tops[idx]).concatenating(CGAffineTransform(scaleX: k, y: k))
                let moved = PKStroke(ink: st.ink, path: st.path, transform: st.transform.concatenating(t), mask: st.mask)
                ink[idx, default: PKDrawing()].strokes.append(moved)
            }
            saveInk(); return
        }
        if let pages = ann.obj("ink") {
            for (k, v) in pages {
                guard let n = Int(k), n >= 1, n <= pageSizes.count, let list = v as? [Any] else { continue }
                let size = pageSizes[n - 1]
                var strokes: [PKStroke] = []
                for case let s as JSON in list {
                    let pts = s.nums("pts"); guard pts.count >= 6 else { continue }
                    let w = CGFloat(s.num("w") ?? 0.0026) * size.width
                    var points: [PKStrokePoint] = []
                    var i = 0, kk = 0
                    while i + 2 < pts.count {
                        let p = CGFloat(pts[i + 2]), size2 = max(0.8, w * 1.6 * (0.35 + 0.65 * p))
                        points.append(PKStrokePoint(location: CGPoint(x: pts[i] * size.width, y: pts[i + 1] * size.height), timeOffset: Double(kk) * 0.008, size: CGSize(width: size2, height: size2), opacity: 1, force: max(0.1, p), azimuth: 0, altitude: .pi / 2))
                        i += 3; kk += 1
                    }
                    strokes.append(PKStroke(ink: PKInk(.pen, color: UIColor(css: s.str("c") ?? "#1b1d22")), path: PKStrokePath(controlPoints: points, creationDate: Date())))
                }
                if !strokes.isEmpty { ink[n - 1] = PKDrawing(strokes: strokes) }
            }
            if !ink.isEmpty { saveInk() }
        }
    }
    func drawing(for page: Int) -> PKDrawing { ink[page] ?? PKDrawing() }
    func setDrawing(_ d: PKDrawing, for page: Int) { ink[page] = d.strokes.isEmpty ? nil : d }
    func saveInk() {
        var j: JSON = [:]
        for (k, v) in ink where !v.strokes.isEmpty { j[String(k)] = v.dataRepresentation().base64EncodedString() }
        if let d = JSONIO.data(j) { Store.shared.saveFile("rdink_" + bookID, d) }
    }
}
