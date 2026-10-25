import PencilKit
import UIKit

/// A picture or a text box on the page (the ink lives in PencilKit). Same fields as earlier versions:
/// images {t:"i", src, iw, ih, m, o, crop?}, text {t:"x", text, fs, font, c, o, iw, ih, m, bg?}.
final class Element: Identifiable {
    enum Kind { case image, text }
    let id: String
    var kind: Kind
    var raw: JSON
    var m: CGAffineTransform          // item space (0…iw, 0…ih) → world
    var iw: CGFloat
    var ih: CGFloat
    var opacity: CGFloat
    // image
    var src: String?
    var crop: CGRect?                 // in original image units
    var cropBase: CGSize?             // original image size the crop refers to
    private(set) var image: UIImage?
    // text
    var text: String = ""
    var fontSize: CGFloat = 20
    var font: String = "sans"
    var color: String = "#1b1d22"
    var bg: String?

    init?(_ j: JSON) {
        guard let t = j.str("t"), t == "i" || t == "x", let id = j.str("id") else { return nil }
        self.id = id
        kind = t == "i" ? .image : .text
        raw = j
        let mm = j.nums("m")
        m = mm.count == 6 ? CGAffineTransform(a: mm[0], b: mm[1], c: mm[2], d: mm[3], tx: mm[4], ty: mm[5]) : .identity
        iw = CGFloat(j.num("iw") ?? 100); ih = CGFloat(j.num("ih") ?? 100)
        opacity = CGFloat(j.num("o") ?? 1)
        if kind == .image {
            src = j.str("src")
            if let c = j.obj("crop"), let x = c.num("x"), let y = c.num("y"), let w = c.num("w"), let h = c.num("h") {
                crop = CGRect(x: x, y: y, width: w, height: h)
                cropBase = CGSize(width: c.num("iw0") ?? Double(iw), height: c.num("ih0") ?? Double(ih))
            }
        } else {
            text = j.str("text") ?? ""; fontSize = CGFloat(j.num("fs") ?? 20); font = j.str("font") ?? "sans"
            color = j.str("c") ?? "#1b1d22"; bg = j.str("bg")
        }
    }

    static func image(src: String, size: CGSize, at origin: CGPoint, width: CGFloat) -> Element {
        let s = width / max(1, size.width)
        let e = Element(["t": "i", "id": UID.make(), "src": src, "iw": size.width, "ih": size.height, "m": [s, 0, 0, s, origin.x, origin.y], "o": 1])!
        return e
    }
    static func textBox(at p: CGPoint, width: CGFloat, size: CGFloat, color: String, font: String = "sans") -> Element {
        Element(["t": "x", "id": UID.make(), "text": "", "fs": size, "font": font, "c": color, "o": 1, "iw": width, "ih": size * 1.36 + 12, "m": [1, 0, 0, 1, p.x, p.y]])!
    }

    func copy(newID: Bool = true) -> Element {
        var j = json
        if newID { j["id"] = UID.make() }
        let e = Element(j)!
        e.image = image
        return e
    }

    /// decoded once, then kept
    func loadImage() -> UIImage? {
        if image == nil, let s = src { image = UIImage.fromDataURL(s) }
        return image
    }
    func setImage(_ img: UIImage, src: String) { image = img; self.src = src }

    var json: JSON {
        var j = raw
        j["m"] = [m.a, m.b, m.c, m.d, m.tx, m.ty]
        j["iw"] = iw; j["ih"] = ih; j["o"] = opacity
        if kind == .image {
            j["src"] = src ?? ""
            if let c = crop, let b = cropBase { j["crop"] = ["x": c.minX, "y": c.minY, "w": c.width, "h": c.height, "iw0": b.width, "ih0": b.height] as JSON } else { j.removeValue(forKey: "crop") }
        } else {
            j["text"] = text; j["fs"] = fontSize; j["font"] = font; j["c"] = color
            if let bg { j["bg"] = bg } else { j.removeValue(forKey: "bg") }
        }
        j["bb"] = [bounds.minX, bounds.minY, bounds.maxX, bounds.maxY]
        return j
    }

    /// world-space bounding box
    var bounds: CGRect { CGRect(x: 0, y: 0, width: iw, height: ih).applying(m) }
    var corners: [CGPoint] { [CGPoint(x: 0, y: 0), CGPoint(x: iw, y: 0), CGPoint(x: iw, y: ih), CGPoint(x: 0, y: ih)].map { $0.applying(m) } }
    func contains(_ p: CGPoint) -> Bool { CGRect(x: 0, y: 0, width: iw, height: ih).contains(p.applying(m.inverted())) }

    // text layout
    var uiFont: UIFont {
        switch font {
        case "serif": return UIFont(descriptor: UIFont.systemFont(ofSize: fontSize).fontDescriptor.withDesign(.serif)!, size: fontSize)
        case "mono": return .monospacedSystemFont(ofSize: fontSize, weight: .regular)
        case "round": return UIFont(descriptor: UIFont.systemFont(ofSize: fontSize).fontDescriptor.withDesign(.rounded)!, size: fontSize)
        default: return .systemFont(ofSize: fontSize)
        }
    }
    var textPad: CGFloat { max(4, fontSize * 0.3) }
    func fitTextHeight() {
        let w = iw - textPad * 2
        let r = (text.isEmpty ? " " : text as NSString).boundingRect(with: CGSize(width: max(10, w), height: 10000), options: [.usesLineFragmentOrigin], attributes: [.font: uiFont, .paragraphStyle: Self.para(fontSize)], context: nil)
        ih = max(fontSize * 1.36, ceil(r.height)) + textPad * 2
    }
    static func para(_ fs: CGFloat) -> NSParagraphStyle { let p = NSMutableParagraphStyle(); p.minimumLineHeight = fs * 1.36; p.maximumLineHeight = fs * 1.36; return p }
}

struct PageInfo {
    var id: String
    var template: String?
    var color: String?
    var bookmark: Bool
    var raw: JSON
    init(_ j: JSON) { id = j.str("id") ?? UID.make(); template = j.str("template"); color = j.str("color"); bookmark = j.bool("bm") || j.bool("bookmark"); raw = j }
    init(id: String = UID.make(), template: String? = nil, color: String? = nil) { self.id = id; self.template = template; self.color = color; bookmark = false; raw = [:] }
    var json: JSON {
        var j = raw; j["id"] = id
        if let template { j["template"] = template } else { j.removeValue(forKey: "template") }
        if let color { j["color"] = color } else { j.removeValue(forKey: "color") }
        if bookmark { j["bm"] = true } else { j.removeValue(forKey: "bm") }; j.removeValue(forKey: "bookmark")
        return j
    }
}

/// A notebook or canvas being edited.
final class NoteDocument {
    static let pageGap: CGFloat = 28
    static let canvasHalf: CGFloat = 25000

    private(set) var raw: JSON
    let id: String
    var name: String
    let isNotebook: Bool
    var format: PageFormat
    var landscape: Bool
    var template: String
    var pageColor: String
    var pages: [PageInfo]
    var elements: [Element]
    var subject: String?
    var recordings: [JSON]
    var artboards: [JSON]
    // canvas
    var paperColor: String
    var gridType: String
    var gridSpacing: CGFloat
    var gridDivisions: Int
    var view: (zoom: CGFloat, tx: CGFloat, ty: CGFloat, rot: CGFloat)
    var viewTop: CGFloat?            // notebooks: world y at the top of the screen (saved by this version)
    var fitZoom: CGFloat?            // notebooks: zoom relative to the fitted page width
    /// strokes written before PencilKit, to convert once
    private(set) var legacyStrokes: [JSON] = []

    init?(id: String) {
        guard let j = Library.shared.loadDoc(id) else { return nil }
        raw = j
        self.id = id
        name = j.str("name") ?? "Untitled"
        isNotebook = j.str("kind") == "notebook"
        let page = j.obj("page") ?? [:]
        format = PageFormat(rawValue: page.str("size") ?? "a4") ?? .a4
        landscape = page.str("orient") == "landscape"
        template = page.str("template") ?? "lined"
        pageColor = page.str("color") ?? "#ffffff"
        pages = j.arr("pages").map(PageInfo.init)
        if isNotebook && pages.isEmpty { pages = [PageInfo()] }
        subject = j.str("subject")
        recordings = j.arr("recordings")
        artboards = j.arr("artboards")
        let paper = j.obj("paper") ?? [:]
        paperColor = paper.str("bg") ?? (isNotebook ? pageColor : "#15171c")
        let g = paper.obj("grid") ?? [:]
        gridType = g.str("type") ?? "dot"
        gridSpacing = CGFloat(g.num("spacing") ?? 24)
        gridDivisions = g.int("divisions") ?? 5
        if (j.obj("precision")?["grid"] as? Bool) == false && !isNotebook { gridType = "none" }
        let v = j.obj("view") ?? [:]
        view = (CGFloat(v.num("zoom") ?? 1), CGFloat(v.num("tx") ?? 0), CGFloat(v.num("ty") ?? 0), CGFloat(v.num("rot") ?? 0))
        viewTop = v.num("top").map { CGFloat($0) }
        fitZoom = v.num("fz").map { CGFloat($0) }
        var els: [Element] = []
        let converted = j.bool("pkInk")
        for l in j.arr("layers") {
            if l.bool("pk") { continue }        // the copy of PencilKit's ink kept by earlier versions
            for it in l.arr("items") {
                if let e = Element(it) { els.append(e) }
                else if !converted, it.str("t") == "s" { legacyStrokes.append(it) }
            }
        }
        elements = els
    }

    var pageSize: CGSize { format.size(landscape: landscape) }
    func pageRect(_ i: Int) -> CGRect {
        let s = pageSize
        return CGRect(x: 0, y: CGFloat(i) * (s.height + Self.pageGap), width: s.width, height: s.height)
    }
    var pageRects: [CGRect] { pages.indices.map(pageRect) }
    func pageIndex(at p: CGPoint) -> Int {
        let s = pageSize
        return min(max(0, Int(floor(p.y / (s.height + Self.pageGap)))), max(0, pages.count - 1))
    }
    func template(of i: Int) -> String { pages.indices.contains(i) ? (pages[i].template ?? template) : template }
    func color(of i: Int) -> String { pages.indices.contains(i) ? (pages[i].color ?? pageColor) : pageColor }
    /// world origin inside the PencilKit drawing (canvases are centred in a huge drawing)
    var origin: CGPoint { isNotebook ? .zero : CGPoint(x: Self.canvasHalf, y: Self.canvasHalf) }

    // MARK: ink

    var inkFileID: String { "ink_" + id }
    func loadInk() -> PKDrawing {
        if let d = Store.shared.loadFile(inkFileID), let drawing = try? PKDrawing(data: d) { return drawing }
        guard !legacyStrokes.isEmpty else { return PKDrawing() }
        // older strokes become PencilKit ink once (a backup copy is kept)
        if let b = JSONIO.data(legacyStrokes) { Store.shared.saveFile("inkbak_" + id, b) }
        let o = origin
        return PKDrawing(strokes: legacyStrokes.compactMap { InkConvert.stroke(from: $0, offset: o) })
    }

    // MARK: saving

    var savedFit: CGFloat = 1
    func json(viewState: (CGFloat, CGFloat, CGFloat, CGFloat)) -> JSON {
        var j = raw
        j["name"] = name
        j["pkInk"] = true
        j["subject"] = subject ?? NSNull()
        j["recordings"] = recordings
        var v: JSON = ["zoom": viewState.0, "tx": viewState.1, "ty": viewState.2, "rot": viewState.3]
        if isNotebook { v["top"] = viewState.2; v["fz"] = viewState.0 / max(0.01, savedFit) }
        j["view"] = v
        if isNotebook {
            var page = j.obj("page") ?? [:]
            page["size"] = format.rawValue; page["orient"] = landscape ? "landscape" : "portrait"; page["template"] = template; page["color"] = pageColor
            j["page"] = page
            j["pages"] = pages.map(\.json)
            var paper = j.obj("paper") ?? [:]; paper["bg"] = pageColor; j["paper"] = paper
        } else {
            var paper = j.obj("paper") ?? [:]
            paper["bg"] = paperColor
            var g = paper.obj("grid") ?? [:]; g["type"] = gridType; g["spacing"] = gridSpacing; g["divisions"] = gridDivisions
            paper["grid"] = g; j["paper"] = paper
        }
        // elements go into the first ordinary layer; the old ink copy layer is emptied (the ink lives in its own file)
        var layers = j.arr("layers")
        if layers.isEmpty { layers = [["id": UID.make(), "name": "Layer 1", "visible": true, "locked": false, "opacity": 1, "items": []]] }
        var placed = false
        for i in layers.indices {
            if layers[i].bool("pk") { layers[i]["items"] = [] as [Any]; continue }
            if !placed { layers[i]["items"] = elements.map(\.json); placed = true } else { layers[i]["items"] = [] as [Any] }
        }
        j["layers"] = layers
        raw = j
        return j
    }
}

/// Earlier versions' strokes (x, y, width-multiplier triples in world units) as PencilKit strokes.
enum InkConvert {
    static func inkType(_ s: String) -> PKInkingTool.InkType {
        switch s {
        case "pencil": return .pencil
        case "marker", "highlighter": return .marker
        case "fountain", "brushpen": return .fountainPen
        case "monoline", "ballpoint": return .monoline
        case "crayon": return .crayon
        case "watercolor": return .watercolor
        default: return .pen
        }
    }
    /// - mirrored: the copy of PencilKit ink kept by the earlier app (w = the stroke's widest point, m = size / w)
    static func stroke(from d: JSON, offset: CGPoint = .zero, mirrored: Bool = false) -> PKStroke? {
        var pts = d.nums("pts")
        guard pts.count >= 3 else { return nil }
        if let mm = Optional(d.nums("m")), mm.count == 6 {
            let t = CGAffineTransform(a: mm[0], b: mm[1], c: mm[2], d: mm[3], tx: mm[4], ty: mm[5])
            var i = 0
            while i + 1 < pts.count { let p = CGPoint(x: pts[i], y: pts[i + 1]).applying(t); pts[i] = p.x; pts[i + 1] = p.y; i += 3 }
        }
        let w = CGFloat(d.num("w") ?? 3), o = CGFloat(d.num("o") ?? 1)
        let ink = PKInk(inkType(d.str("b") ?? "pen"), color: UIColor(css: d.str("c") ?? "#000000"))
        var points: [PKStrokePoint] = []
        var i = 0, k = 0
        while i + 2 < pts.count {
            let m = CGFloat(pts[i + 2])
            let size = mirrored ? max(0.5, w * max(0.05, m)) : max(1.0, w * 1.6 * (m > 0 ? min(1.4, m / 0.64) : 1))
            points.append(PKStrokePoint(location: CGPoint(x: pts[i] + offset.x, y: pts[i + 1] + offset.y), timeOffset: TimeInterval(k) * 0.008, size: CGSize(width: size, height: size), opacity: o, force: min(1, max(0.1, m)), azimuth: 0, altitude: .pi / 2))
            i += 3; k += 1
        }
        if points.count == 1 { let p = points[0]; points.append(PKStrokePoint(location: CGPoint(x: p.location.x + 0.1, y: p.location.y), timeOffset: 0.01, size: p.size, opacity: p.opacity, force: p.force, azimuth: 0, altitude: .pi / 2)) }
        return PKStroke(ink: ink, path: PKStrokePath(controlPoints: points, creationDate: Date()))
    }
}
