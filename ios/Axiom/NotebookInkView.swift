import PencilKit
import UIKit
import WebKit

/// A notebook drawn with Apple's PencilKit: the pages (paper, templates, pictures and text, rendered by the page
/// code as images) sit under a PKCanvasView that owns the ink, the Pencil and finger scrolling/zooming.
/// The web interface floats above with transparent holes over the pages.
final class NotebookInkView: UIView, PKCanvasViewDelegate, UIScrollViewDelegate {
    let canvas = PKCanvasView()
    private let pages = UIView()                 // page images, scaled with the zoom
    private var pageViews: [UIImageView] = []
    private var pageRects: [CGRect] = []
    private var pageScale: [CGFloat] = []        // resolution each page image was rendered at
    private var dirty = Set<Int>()
    private var docId: String?
    private var loading = false
    private var saveWork: DispatchWorkItem?
    private var mirrorWork: DispatchWorkItem?
    private var insets = UIEdgeInsets(top: 70, left: 16, bottom: 90, right: 66)
    private var minFit: CGFloat = 1

    /// Callbacks to the page code
    var onView: ((CGFloat, CGFloat, CGFloat) -> Void)?          // zoom, tx, ty (stage coordinates)
    var onNeedPage: ((Int, CGFloat) -> Void)?                   // page index, scale
    var onStrokes: ((String) -> Void)?                          // mirrored strokes as JSON
    var onChanged: (() -> Void)?                                // a user edit (for the undo stack)
    var save: ((String, Data) -> Void)?
    var load: ((String) -> Data?)?

    override init(frame: CGRect) {
        super.init(frame: frame)
        backgroundColor = .clear
        isHidden = true
        canvas.delegate = self
        canvas.backgroundColor = .clear
        canvas.isOpaque = false
        canvas.drawingPolicy = .pencilOnly
        canvas.minimumZoomScale = 0.2
        canvas.maximumZoomScale = 6
        canvas.contentInsetAdjustmentBehavior = .never
        canvas.showsVerticalScrollIndicator = true
        canvas.showsHorizontalScrollIndicator = false
        canvas.bouncesZoom = true
        canvas.alwaysBounceVertical = true
        pages.layer.anchorPoint = .zero
        // the paper sits behind PencilKit (a sibling, moved with every scroll and zoom), never inside its view
        addSubview(pages)
        canvas.frame = bounds
        canvas.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        addSubview(canvas)
        let dbl = UITapGestureRecognizer(target: self, action: #selector(doubleTap(_:)))
        dbl.numberOfTapsRequired = 2
        dbl.allowedTouchTypes = [NSNumber(value: UITouch.TouchType.direct.rawValue)]
        canvas.addGestureRecognizer(dbl)
    }
    required init?(coder: NSCoder) { fatalError() }

    // MARK: - open / close

    func open(id: String, rects: [CGRect], zoom: CGFloat, tx: CGFloat, ty: CGFloat, legacy: [[String: Any]], dark: Bool, desk: UIColor, insets: UIEdgeInsets) {
        close()
        docId = id
        self.insets = insets
        superview?.backgroundColor = desk
        canvas.overrideUserInterfaceStyle = dark ? .dark : .light
        loading = true
        var drawing = PKDrawing()
        if let data = load?("ink_" + id), let d = try? PKDrawing(data: data) { drawing = d }
        else if !legacy.isEmpty { drawing = PKDrawing(strokes: legacy.compactMap(Self.stroke)) }
        canvas.drawing = drawing
        loading = false
        setPages(rects)
        isHidden = false
        setView(zoom: zoom, tx: tx, ty: ty)
        if !legacy.isEmpty && load?("ink_" + id) == nil { scheduleSave() }
        scheduleMirror(0.05)
    }

    func close() {
        guard let id = docId else { return }
        saveWork?.cancel(); mirrorWork?.cancel()
        save?("ink_" + id, canvas.drawing.dataRepresentation())
        docId = nil
        isHidden = true
        canvas.drawing = PKDrawing()
        pageViews.forEach { $0.removeFromSuperview() }
        pageViews = []; pageRects = []; pageScale = []; dirty = []
    }
    var isOpen: Bool { docId != nil }

    func flush() { if let id = docId { save?("ink_" + id, canvas.drawing.dataRepresentation()) } }

    // MARK: - pages

    func setPages(_ rects: [CGRect]) {
        pageRects = rects
        while pageViews.count < rects.count { let v = UIImageView(); v.contentMode = .scaleToFill; v.backgroundColor = .white; v.layer.shadowColor = UIColor.black.cgColor; v.layer.shadowOpacity = 0.18; v.layer.shadowRadius = 10; v.layer.shadowOffset = CGSize(width: 0, height: 4); pages.addSubview(v); pageViews.append(v); pageScale.append(0) }
        while pageViews.count > rects.count { pageViews.removeLast().removeFromSuperview(); pageScale.removeLast() }
        let bb = rects.reduce(CGRect.null) { $0.union($1) }
        pages.bounds = CGRect(x: 0, y: 0, width: bb.maxX, height: bb.maxY)
        for (i, r) in rects.enumerated() { pageViews[i].frame = r }
        dirty = Set(0..<rects.count)
        layoutContent()
        requestVisible()
    }

    func setPageImage(_ i: Int, data: Data, scale: CGFloat) {
        guard i < pageViews.count, let img = UIImage(data: data) else { return }
        pageViews[i].image = img
        pageViews[i].backgroundColor = .clear
        pageScale[i] = scale
        dirty.remove(i)
    }

    func markDirty(_ all: Bool, _ list: [Int]) {
        if all { dirty = Set(0..<pageRects.count) } else { list.forEach { dirty.insert($0) } }
        requestVisible()
    }

    private var wantedScale: CGFloat { min(3, max(1, (canvas.zoomScale * UIScreen.main.scale * 2).rounded() / 2)) }

    private func requestVisible() {
        guard isOpen else { return }
        let z = canvas.zoomScale
        let visible = CGRect(x: canvas.contentOffset.x / z, y: canvas.contentOffset.y / z, width: canvas.bounds.width / z, height: canvas.bounds.height / z).insetBy(dx: 0, dy: -canvas.bounds.height / z)
        let want = wantedScale
        for (i, r) in pageRects.enumerated() where r.intersects(visible) {
            if dirty.contains(i) || pageScale[i] + 0.01 < want { onNeedPage?(i, want); pageScale[i] = want; dirty.remove(i) }
        }
    }

    // MARK: - view

    private func layoutContent() {
        let bb = pageRects.reduce(CGRect.null) { $0.union($1) }
        guard !bb.isNull else { return }
        let z = canvas.zoomScale
        canvas.contentSize = CGSize(width: bb.maxX * z, height: bb.maxY * z)
        // centre narrow pages like Notability; keep room for the top bar and the tool rail
        let w = bb.maxX * z, side = max(insets.left, (bounds.width - w) / 2)
        let left = w + insets.left + insets.right <= bounds.width ? max(side, insets.left) : insets.left
        let right = w + insets.left + insets.right <= bounds.width ? max(0, bounds.width - w - left) : insets.right
        canvas.contentInset = UIEdgeInsets(top: insets.top, left: left, bottom: insets.bottom, right: right)
        minFit = (bounds.width - insets.left - insets.right - 40) / max(1, bb.width)
        canvas.minimumZoomScale = max(0.2, minFit * 0.35)
        canvas.maximumZoomScale = max(4, minFit * 6)
    }

    func setView(zoom: CGFloat, tx: CGFloat, ty: CGFloat) {
        canvas.zoomScale = zoom
        layoutContent()
        canvas.contentOffset = CGPoint(x: -tx, y: -ty)
        report()
    }

    func setInsets(_ i: UIEdgeInsets) { insets = i; layoutContent(); report() }

    func currentView() -> [Double] { [Double(canvas.zoomScale), Double(-canvas.contentOffset.x), Double(-canvas.contentOffset.y)] }

    private func report() {
        placePages()
        let z = canvas.zoomScale
        onView?(z, -canvas.contentOffset.x, -canvas.contentOffset.y)
    }

    @objc private func doubleTap(_ g: UITapGestureRecognizer) {
        let target = canvas.zoomScale > minFit * 1.05 ? minFit : minFit * 2
        let p = g.location(in: canvas)
        let z0 = canvas.zoomScale
        let wx = p.x / z0, wy = p.y / z0
        UIView.animate(withDuration: 0.25) {
            self.canvas.zoomScale = target
            self.layoutContent()
            if target > self.minFit * 1.05 { self.canvas.contentOffset = CGPoint(x: wx * target - g.location(in: self).x, y: wy * target - g.location(in: self).y) }
        }
    }

    private func placePages() {
        let z = canvas.zoomScale
        CATransaction.begin(); CATransaction.setDisableActions(true)
        pages.transform = CGAffineTransform(scaleX: z, y: z)
        pages.frame.origin = CGPoint(x: -canvas.contentOffset.x, y: -canvas.contentOffset.y)
        CATransaction.commit()
    }
    func scrollViewDidZoom(_ scrollView: UIScrollView) { layoutContent(); placePages(); report() }
    func scrollViewDidScroll(_ scrollView: UIScrollView) { placePages(); report() }
    func scrollViewDidEndZooming(_ scrollView: UIScrollView, with view: UIView?, atScale scale: CGFloat) { requestVisible() }
    func scrollViewDidEndDecelerating(_ scrollView: UIScrollView) { requestVisible() }
    func scrollViewDidEndDragging(_ scrollView: UIScrollView, willDecelerate decelerate: Bool) { if !decelerate { requestVisible() } }

    override func layoutSubviews() { super.layoutSubviews(); layoutContent() }

    // MARK: - tools

    func setTool(_ t: [String: Any]) {
        let kind = t["tool"] as? String ?? "none"
        canvas.drawingGestureRecognizer.isEnabled = kind != "none"
        canvas.drawingPolicy = (t["finger"] as? Bool ?? false) ? .anyInput : .pencilOnly
        canvas.isRulerActive = t["ruler"] as? Bool ?? false
        switch kind {
        case "eraser":
            if (t["mode"] as? String) == "bitmap" { canvas.tool = PKEraserTool(.bitmap, width: CGFloat(t["width"] as? Double ?? 20)) }
            else { canvas.tool = PKEraserTool(.vector) }
        case "lasso":
            canvas.tool = PKLassoTool()
        case "ink":
            let type = Self.inkType(t["ink"] as? String ?? "pen")
            let color = CanvasViewController.color(t["color"] as? String ?? "#000000").withAlphaComponent(CGFloat(t["alpha"] as? Double ?? 1))
            let w = CGFloat(t["width"] as? Double ?? 3)
            let range = type.validWidthRange
            canvas.tool = PKInkingTool(type, color: color, width: min(max(w, range.lowerBound), range.upperBound))
        default: break
        }
    }

    static func inkType(_ s: String) -> PKInkingTool.InkType {
        switch s {
        case "pencil": return .pencil
        case "marker", "highlighter": return .marker
        case "fountain": return .fountainPen
        case "monoline": return .monoline
        case "crayon": return .crayon
        case "watercolor": return .watercolor
        default: return .pen
        }
    }
    static func brushName(_ t: PKInkingTool.InkType) -> String {
        switch t {
        case .pencil: return "pencil"
        case .marker: return "marker"
        case .fountainPen: return "fountain"
        default: return "pen"
        }
    }

    // MARK: - pages moved, removed or duplicated: their ink follows

    func move(_ moves: [(CGRect, CGPoint)]) {
        var strokes = canvas.drawing.strokes
        for i in strokes.indices {
            let b = strokes[i].renderBounds, c = CGPoint(x: b.midX, y: b.midY)
            if let m = moves.first(where: { $0.0.contains(c) }) {
                strokes[i].transform = strokes[i].transform.concatenating(CGAffineTransform(translationX: m.1.x - m.0.minX, y: m.1.y - m.0.minY))
            }
        }
        replace(strokes)
    }

    func copy(from r: CGRect, to p: CGPoint) {
        var strokes = canvas.drawing.strokes
        let t = CGAffineTransform(translationX: p.x - r.minX, y: p.y - r.minY)
        for s in canvas.drawing.strokes {
            let b = s.renderBounds
            if r.contains(CGPoint(x: b.midX, y: b.midY)) { var c = s; c.transform = c.transform.concatenating(t); strokes.append(c) }
        }
        replace(strokes)
    }

    private func replace(_ strokes: [PKStroke]) {
        loading = true
        canvas.drawing = PKDrawing(strokes: strokes)
        loading = false
        scheduleSave(); scheduleMirror(0.1)
    }

    func setAppearance(dark: Bool, desk: UIColor) {
        canvas.overrideUserInterfaceStyle = dark ? .dark : .light
        superview?.backgroundColor = desk
    }

    // MARK: - undo

    func undo() { canvas.undoManager?.undo() }
    func redo() { canvas.undoManager?.redo() }

    // MARK: - changes

    func canvasViewDrawingDidChange(_ canvasView: PKCanvasView) {
        guard !loading, isOpen else { return }
        onChanged?()
        scheduleSave()
        scheduleMirror(0.35)
    }

    private func scheduleSave() {
        saveWork?.cancel()
        let w = DispatchWorkItem { [weak self] in self?.flush() }
        saveWork = w
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.0, execute: w)
    }

    private func scheduleMirror(_ delay: Double) {
        mirrorWork?.cancel()
        let w = DispatchWorkItem { [weak self] in self?.sendMirror() }
        mirrorWork = w
        DispatchQueue.main.asyncAfter(deadline: .now() + delay, execute: w)
    }

    /// The page code keeps a copy of the ink (as its own strokes) for page pictures, the tutor and export.
    private func sendMirror() {
        let strokes = canvas.drawing.strokes
        DispatchQueue.global(qos: .utility).async { [weak self] in
            var out: [[String: Any]] = []
            out.reserveCapacity(strokes.count)
            for s in strokes {
                var pts: [Double] = []
                var wMax: CGFloat = 0.1
                let samples = Array(s.path.interpolatedPoints(by: .distance(2.5)))
                for p in samples { wMax = max(wMax, p.size.width) }
                for p in samples {
                    let q = p.location.applying(s.transform)
                    pts.append((Double(q.x) * 10).rounded() / 10)
                    pts.append((Double(q.y) * 10).rounded() / 10)
                    pts.append((Double(p.size.width / wMax) * 100).rounded() / 100)
                }
                if pts.isEmpty { continue }
                var r: CGFloat = 0, g: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 1
                s.ink.color.resolvedColor(with: UITraitCollection(userInterfaceStyle: .light)).getRed(&r, green: &g, blue: &b, alpha: &a)
                out.append([
                    "b": Self.brushName(s.ink.inkType),
                    "c": String(format: "#%02x%02x%02x", Int(r * 255), Int(g * 255), Int(b * 255)),
                    "o": Double(a), "w": Double(wMax), "pts": pts,
                ])
            }
            let json = (try? JSONSerialization.data(withJSONObject: out)).flatMap { String(data: $0, encoding: .utf8) } ?? "[]"
            DispatchQueue.main.async { self?.onStrokes?(json) }
        }
    }

    /// One of the page code's strokes (x, y, width multiplier triples in world units) as a PencilKit stroke.
    static func stroke(_ d: [String: Any]) -> PKStroke? {
        guard let pts = d["pts"] as? [Double], pts.count >= 3 else { return nil }
        let w = CGFloat(d["w"] as? Double ?? 3)
        let o = CGFloat(d["o"] as? Double ?? 1)
        let color = CanvasViewController.color(d["c"] as? String ?? "#000000")
        let ink = PKInk(inkType(d["b"] as? String ?? "pen"), color: color)
        var points: [PKStrokePoint] = []
        var i = 0, k = 0
        while i + 2 < pts.count {
            // the page's own width multipliers are ~0.6 for a steady pen; PencilKit sizes are the full nib width
            let m = CGFloat(pts[i + 2])
            let size = max(1.0, w * 1.6 * (m > 0 ? min(1.4, m / 0.64) : 1))
            points.append(PKStrokePoint(location: CGPoint(x: pts[i], y: pts[i + 1]), timeOffset: TimeInterval(k) * 0.008, size: CGSize(width: size, height: size), opacity: o, force: min(1, max(0.1, m)), azimuth: 0, altitude: .pi / 2))
            i += 3; k += 1
        }
        if points.count == 1 { let p = points[0]; points.append(PKStrokePoint(location: CGPoint(x: p.location.x + 0.1, y: p.location.y), timeOffset: 0.01, size: p.size, opacity: p.opacity, force: p.force, azimuth: 0, altitude: .pi / 2)) }
        return PKStroke(ink: ink, path: PKStrokePath(controlPoints: points, creationDate: Date()))
    }
}

/// The web view, with transparent holes: touches over the notebook pages go to the PencilKit view underneath,
/// touches over the interface (bars, menus, panels, dialogs) stay with the page.
final class PassthroughWebView: WKWebView {
    var passthrough = false
    var chrome: [CGRect] = []
    override func hitTest(_ point: CGPoint, with event: UIEvent?) -> UIView? {
        if passthrough && !chrome.contains(where: { $0.contains(point) }) { return nil }
        return super.hitTest(point, with: event)
    }
}
