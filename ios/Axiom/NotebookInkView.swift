import PencilKit
import UIKit
import WebKit

/// A notebook drawn with Apple's PencilKit: the pages (paper, templates, pictures and text, rendered by the page
/// code as images) sit under a PKCanvasView that owns the ink, the Pencil and finger scrolling/zooming.
/// The web interface floats above with transparent holes over the pages.
final class NotebookInkView: UIView, PKCanvasViewDelegate, UIScrollViewDelegate, UIGestureRecognizerDelegate {
    let canvas = PKCanvasView()
    private let stage = UIView()                 // pages + ink; rotated as one on canvases
    private(set) var rot: CGFloat = 0
    var rotateEnabled = false
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
    private var placeholder = UIColor.white   // a page before its picture arrives
    // infinite canvases: world (0,0) sits at `origin` in PencilKit's coordinates; one background image around the view
    private(set) var isCanvas = false
    private var origin = CGPoint.zero
    private static let canvasHalf: CGFloat = 25000
    // canvases: the background (paper, grid, artboards, pictures, text) in square tiles around the view
    private var tiles: [String: (view: UIImageView, level: Int, rect: CGRect)] = [:]
    private var staleTiles = Set<String>()
    private var pendingTiles = Set<String>()
    private var tileLevel = 0
    private static let tilePx: CGFloat = 512
    private var lastTileAsk: CFTimeInterval = 0

    /// Callbacks to the page code
    var onView: ((CGFloat, CGFloat, CGFloat, CGFloat) -> Void)? // zoom, tx, ty (stage coordinates), rotation
    var onNeedPage: ((Int, CGFloat) -> Void)?                   // page index, scale
    var onNeedTiles: ((String) -> Void)?                        // canvases: background tiles wanted, as JSON
    var onStrokes: ((String) -> Void)?                          // mirrored strokes as JSON
    var onChanged: (() -> Void)?                                // a user edit (for the undo stack)
    var onRecognize: ((String) -> Void)?                        // a held stroke's points (world) for shape recognition
    var onTouch: ((CGPoint?) -> Void)?                          // a tap (point in this view) or a stroke began (nil)
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
        addSubview(stage)
        stage.addSubview(pages)
        canvas.frame = bounds
        canvas.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        stage.addSubview(canvas)
        let rg = UIRotationGestureRecognizer(target: self, action: #selector(rotated(_:)))
        rg.delegate = self
        addGestureRecognizer(rg)
        let dbl = UITapGestureRecognizer(target: self, action: #selector(doubleTap(_:)))
        dbl.numberOfTapsRequired = 2
        dbl.allowedTouchTypes = [NSNumber(value: UITouch.TouchType.direct.rawValue)]
        dbl.delegate = self
        canvas.addGestureRecognizer(dbl)
        // a tap or a stroke on the page tells the page code (menus close, the selection clears)
        let tap = UITapGestureRecognizer(target: self, action: #selector(tapped(_:)))
        tap.cancelsTouchesInView = false
        tap.delaysTouchesEnded = false
        tap.delegate = self
        addGestureRecognizer(tap)
    }
    required init?(coder: NSCoder) { fatalError() }

    // MARK: - open / close

    func open(id: String, rects: [CGRect], zoom: CGFloat, tx: CGFloat, ty: CGFloat, legacy: [[String: Any]], dark: Bool, desk: UIColor, insets: UIEdgeInsets, canvas isCanvas: Bool = false, rot startRot: CGFloat = 0) {
        close()
        docId = id
        self.insets = insets
        self.isCanvas = isCanvas
        rot = 0
        origin = isCanvas ? CGPoint(x: Self.canvasHalf, y: Self.canvasHalf) : .zero
        canvas.alwaysBounceVertical = !isCanvas
        canvas.showsVerticalScrollIndicator = !isCanvas
        clearTiles()
        superview?.backgroundColor = desk
        canvas.overrideUserInterfaceStyle = dark ? .dark : .light
        placeholder = dark ? UIColor(white: 0.11, alpha: 1) : .white
        loading = true
        var drawing = PKDrawing()
        if let data = load?("ink_" + id), let d = try? PKDrawing(data: data) { drawing = d }
        else if !legacy.isEmpty { let o = origin; drawing = PKDrawing(strokes: legacy.compactMap { Self.stroke($0, offset: o) }) }
        canvas.drawing = drawing
        loading = false
        setPages(isCanvas ? [] : rects)
        isHidden = false
        setView(zoom: zoom, tx: tx, ty: ty, rot: startRot)
        requestVisible()
        if !legacy.isEmpty && load?("ink_" + id) == nil { scheduleSave() }
        scheduleMirror(0.05)
    }

    func close() {
        guard let id = docId else { return }
        saveWork?.cancel(); mirrorWork?.cancel()
        replay(on: false, start: Date(), end: Date(), t: 0)
        save?("ink_" + id, canvas.drawing.dataRepresentation())
        docId = nil
        isHidden = true
        canvas.drawing = PKDrawing()
        pageViews.forEach { $0.removeFromSuperview() }
        pageViews = []; pageRects = []; pageScale = []; dirty = []
    }
    var isOpen: Bool { docId != nil }

    func flush() { if let id = docId { save?("ink_" + id, savedDrawing.dataRepresentation()) } }

    // MARK: - pages

    func setPages(_ rects: [CGRect]) {
        pageRects = rects
        while pageViews.count < rects.count { let v = UIImageView(); v.contentMode = .scaleToFill; v.backgroundColor = placeholder; v.layer.shadowColor = UIColor.black.cgColor; v.layer.shadowOpacity = 0.18; v.layer.shadowRadius = 10; v.layer.shadowOffset = CGSize(width: 0, height: 4); pages.addSubview(v); pageViews.append(v); pageScale.append(0) }
        while pageViews.count > rects.count { pageViews.removeLast().removeFromSuperview(); pageScale.removeLast() }
        let bb = rects.reduce(CGRect.null) { $0.union($1) }
        pages.bounds = isCanvas || bb.isNull ? CGRect(x: 0, y: 0, width: Self.canvasHalf * 2, height: Self.canvasHalf * 2) : CGRect(x: 0, y: 0, width: bb.maxX, height: bb.maxY)
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
        if all { dirty = Set(0..<pageRects.count); staleTiles = Set(tiles.keys); pendingTiles = [] } else { list.forEach { dirty.insert($0) } }
        requestVisible()
    }

    /// canvases: one background tile arrived (world rect, drawn at 2^level pixels per unit)
    func setTile(_ key: String, rect: CGRect, level: Int, data: Data) {
        guard isCanvas, isOpen, let img = UIImage(data: data) else { return }
        pendingTiles.remove(key)
        staleTiles.remove(key)
        let v: UIImageView
        if let t = tiles[key] { v = t.view } else { v = UIImageView(); v.contentMode = .scaleToFill; pages.addSubview(v) }
        v.image = img
        v.frame = rect.offsetBy(dx: origin.x, dy: origin.y)
        if level == tileLevel { pages.bringSubviewToFront(v) } else { pages.sendSubviewToBack(v) }
        tiles[key] = (v, level, rect)
        pruneTiles()
    }

    private func clearTiles() {
        tiles.values.forEach { $0.view.removeFromSuperview() }
        tiles = [:]; staleTiles = []; pendingTiles = []
    }

    /// the world rect on screen (rotated canvases: the square around it)
    private func visibleWorld() -> CGRect {
        let z = canvas.zoomScale
        let vis = CGRect(x: canvas.contentOffset.x / z - origin.x, y: canvas.contentOffset.y / z - origin.y, width: canvas.bounds.width / z, height: canvas.bounds.height / z)
        if rot == 0 { return vis }
        let d = hypot(vis.width, vis.height)
        return CGRect(x: vis.midX - d / 2, y: vis.midY - d / 2, width: d, height: d)
    }

    /// once the current sharpness covers the screen, drop tiles of other sharpness and far-away ones
    private func pruneTiles() {
        let vis = visibleWorld(), keep = vis.insetBy(dx: -vis.width * 1.5, dy: -vis.height * 1.5)
        let covered = neededTiles(vis).allSatisfy { k, _ in tiles[k] != nil && !staleTiles.contains(k) }
        for (k, t) in tiles where (covered && t.level != tileLevel) || !t.rect.intersects(keep) {
            t.view.removeFromSuperview(); tiles[k] = nil; staleTiles.remove(k)
        }
        if tiles.count > 90 {
            let c = CGPoint(x: vis.midX, y: vis.midY)
            let far = tiles.sorted { hypot($0.value.rect.midX - c.x, $0.value.rect.midY - c.y) > hypot($1.value.rect.midX - c.x, $1.value.rect.midY - c.y) }
            for (k, t) in far.prefix(tiles.count - 90) { t.view.removeFromSuperview(); tiles[k] = nil; staleTiles.remove(k) }
        }
    }

    private func neededTiles(_ area: CGRect) -> [(String, CGRect)] {
        let T = Self.tilePx / pow(2, CGFloat(tileLevel))
        let x0 = Int(floor(area.minX / T)), x1 = Int(floor(area.maxX / T)), y0 = Int(floor(area.minY / T)), y1 = Int(floor(area.maxY / T))
        guard x1 - x0 < 60, y1 - y0 < 60 else { return [] }
        var out: [(String, CGRect)] = []
        for iy in y0...y1 { for ix in x0...x1 { out.append(("\(tileLevel):\(ix):\(iy)", CGRect(x: CGFloat(ix) * T, y: CGFloat(iy) * T, width: T, height: T))) } }
        return out
    }

    private var wantedScale: CGFloat { min(3, max(1, (canvas.zoomScale * UIScreen.main.scale * 2).rounded() / 2)) }

    private func requestVisible() {
        guard isOpen else { return }
        if isCanvas { requestBg(); return }
        let z = canvas.zoomScale
        let visible = CGRect(x: canvas.contentOffset.x / z, y: canvas.contentOffset.y / z, width: canvas.bounds.width / z, height: canvas.bounds.height / z).insetBy(dx: 0, dy: -canvas.bounds.height / z)
        let want = wantedScale
        for (i, r) in pageRects.enumerated() where r.intersects(visible) {
            if dirty.contains(i) || pageScale[i] + 0.01 < want { onNeedPage?(i, want); pageScale[i] = want; dirty.remove(i) }
        }
    }

    private func requestBg() {
        let want = min(2, canvas.zoomScale * UIScreen.main.scale)
        tileLevel = max(-7, min(1, Int(ceil(log2(max(want, 0.008)) - 0.15))))
        let vis = visibleWorld()
        let c = CGPoint(x: vis.midX, y: vis.midY)
        let wanted = neededTiles(vis.insetBy(dx: -vis.width * 0.5, dy: -vis.height * 0.5))
            .filter { k, _ in tiles[k] == nil || staleTiles.contains(k) }
            .sorted { hypot($0.1.midX - c.x, $0.1.midY - c.y) < hypot($1.1.midX - c.x, $1.1.midY - c.y) }
        lastTileAsk = CACurrentMediaTime()
        if wanted.isEmpty { pruneTiles() }
        // the page keeps only the latest list (nearest first), so it never draws tiles the view has left
        let keys = Set(wanted.map { $0.0 })
        if keys == pendingTiles { return }
        pendingTiles = keys
        let s = pow(2, Double(tileLevel)), pad = 1 / s
        let list: [[String: Any]] = wanted.map { k, r in ["k": k, "l": tileLevel, "x": Double(r.minX) - pad, "y": Double(r.minY) - pad, "w": Double(r.width) + 2 * pad, "h": Double(r.height) + 2 * pad, "s": s] }
        if let json = try? JSONSerialization.data(withJSONObject: list), let str = String(data: json, encoding: .utf8) { onNeedTiles?(str) }
    }

    // MARK: - view

    private func layoutContent() {
        if isCanvas {
            let z = canvas.zoomScale
            canvas.contentSize = CGSize(width: Self.canvasHalf * 2 * z, height: Self.canvasHalf * 2 * z)
            canvas.contentInset = .zero
            canvas.minimumZoomScale = 0.05
            canvas.maximumZoomScale = 24
            minFit = 1
            return
        }
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

    func setView(zoom: CGFloat, tx: CGFloat, ty: CGFloat, rot newRot: CGFloat = 0) {
        rot = isCanvas ? newRot : 0
        applyRotation()
        canvas.zoomScale = zoom
        layoutContent()
        let z = canvas.zoomScale
        // the page's (tx, ty) are after rotation about the view centre; undo that to get the scroll position
        let c = CGPoint(x: bounds.midX, y: bounds.midY), co = cos(rot), si = sin(rot)
        let ux = c.x + co * (tx - c.x) + si * (ty - c.y), uy = c.y - si * (tx - c.x) + co * (ty - c.y)
        canvas.contentOffset = CGPoint(x: origin.x * z - ux, y: origin.y * z - uy)
        report()
    }

    private func applyRotation() {
        stage.bounds = bounds
        stage.center = CGPoint(x: bounds.midX, y: bounds.midY)
        stage.transform = CGAffineTransform(rotationAngle: rot)
    }

    func gestureRecognizer(_ g: UIGestureRecognizer, shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer) -> Bool { true }
    override func gestureRecognizerShouldBegin(_ g: UIGestureRecognizer) -> Bool {
        if g is UIRotationGestureRecognizer { return isOpen && isCanvas && rotateEnabled }
        return super.gestureRecognizerShouldBegin(g)
    }
    private var rot0: CGFloat = 0
    @objc private func rotated(_ g: UIRotationGestureRecognizer) {
        switch g.state {
        case .began: rot0 = rot
        case .changed:
            var r = rot0 + g.rotation
            let q = (r / (.pi / 2)).rounded() * (.pi / 2)
            if abs(r - q) < 3 * .pi / 180 { r = q } // snap to straight angles
            setRotationKeepingCentre(r)
        case .ended, .cancelled: requestVisible()
        default: break
        }
    }
    /// rotate about the middle of the screen without moving what is there
    private func setRotationKeepingCentre(_ r: CGFloat) {
        rot = r
        applyRotation()
        report()
    }

    func setInsets(_ i: UIEdgeInsets) { insets = i; layoutContent(); report() }

    func debugInfo() -> [String: Any] {
        let last = canvas.drawing.strokes.last
        let p = last.map { $0.path[0].location.applying($0.transform) } ?? .zero
        return ["zoom": canvas.zoomScale, "off": [canvas.contentOffset.x, canvas.contentOffset.y], "inset": [canvas.adjustedContentInset.left, canvas.adjustedContentInset.top], "frame": [frame.minX, frame.minY, canvas.frame.minX, canvas.frame.minY], "first": [p.x, p.y], "bounds": [canvas.bounds.minX, canvas.bounds.minY]]
    }
    private func rotatedT() -> (CGFloat, CGFloat) {
        let z = canvas.zoomScale
        let ux = origin.x * z - canvas.contentOffset.x, uy = origin.y * z - canvas.contentOffset.y
        let c = CGPoint(x: bounds.midX, y: bounds.midY), co = cos(rot), si = sin(rot)
        return (c.x + co * (ux - c.x) - si * (uy - c.y), c.y + si * (ux - c.x) + co * (uy - c.y))
    }
    func currentView() -> [Double] { let (tx, ty) = rotatedT(); return [Double(canvas.zoomScale), Double(tx), Double(ty), Double(rot)] }

    private func report() {
        placePages()
        let (tx, ty) = rotatedT()
        onView?(canvas.zoomScale, tx, ty, rot)
    }

    /// finger double-tap: zoom in around the finger, or back out to the fitted page (canvases: 100% and 200%);
    /// the scroll view's own zoom-to-rect keeps the place, instead of setting the scale and losing the position
    @objc private func doubleTap(_ g: UITapGestureRecognizer) {
        guard isOpen, g.state == .ended else { return }
        zoomToggle(at: g.location(in: canvas))
    }
    func zoomToggle(at p: CGPoint) {
        let z0 = canvas.zoomScale
        let base: CGFloat = isCanvas ? 1 : minFit
        let target = z0 > base * 1.05 ? base : base * 2
        let w = canvas.bounds.width / target, hgt = canvas.bounds.height / target
        var cx = p.x / z0, cy = p.y / z0
        let bb = pageRects.reduce(CGRect.null) { $0.union($1) }
        if !isCanvas && target <= base * 1.01 && !bb.isNull { cx = bb.midX; cy = max(cy, hgt / 2) }
        canvas.zoom(to: CGRect(x: cx - w / 2, y: cy - hgt / 2, width: w, height: hgt), animated: true)
    }

    @objc private func tapped(_ g: UITapGestureRecognizer) { if isOpen, g.state == .ended { onTouch?(g.location(in: self)) } }
    func canvasViewDidBeginUsingTool(_ canvasView: PKCanvasView) { if isOpen { onTouch?(nil) } }

    private func placePages() {
        let z = canvas.zoomScale
        CATransaction.begin(); CATransaction.setDisableActions(true)
        pages.transform = CGAffineTransform(scaleX: z, y: z)
        pages.frame.origin = CGPoint(x: -canvas.contentOffset.x, y: -canvas.contentOffset.y)
        CATransaction.commit()
    }
    func scrollViewDidZoom(_ scrollView: UIScrollView) { layoutContent(); placePages(); report(); if isCanvas, CACurrentMediaTime() - lastTileAsk > 0.2 { requestBg() } }
    func scrollViewDidScroll(_ scrollView: UIScrollView) { placePages(); report(); if isCanvas, CACurrentMediaTime() - lastTileAsk > 0.12 { requestBg() } }
    func scrollViewDidEndZooming(_ scrollView: UIScrollView, with view: UIView?, atScale scale: CGFloat) { requestVisible() }
    func scrollViewDidEndDecelerating(_ scrollView: UIScrollView) { requestVisible() }
    func scrollViewDidEndDragging(_ scrollView: UIScrollView, willDecelerate decelerate: Bool) { if !decelerate { requestVisible() } }

    override func layoutSubviews() { super.layoutSubviews(); applyRotation(); layoutContent() }

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

    // MARK: - draw and hold: the page recognises the shape, the stroke is replaced by the clean one

    private var lastMovePt = CGPoint.zero
    private var lastMoveT: TimeInterval = 0
    private var pendingShape = false
    var shapesEnabled = false

    func trackPencil(_ phase: String, _ touches: [UITouch]) {
        guard isOpen, shapesEnabled, canvas.tool is PKInkingTool, let first = touches.first else { return }
        switch phase {
        case "b":
            lastMovePt = first.location(in: canvas); lastMoveT = first.timestamp; pendingShape = false
        case "m":
            for t in touches { let p = t.location(in: canvas); if hypot(p.x - lastMovePt.x, p.y - lastMovePt.y) > 3 { lastMovePt = p; lastMoveT = t.timestamp } }
        case "e":
            let end = touches.last!.timestamp
            if end - lastMoveT > 0.55 { pendingShape = true; DispatchQueue.main.asyncAfter(deadline: .now() + 0.08) { [weak self] in self?.recognizeLast() } }
        default: pendingShape = false
        }
    }

    private func recognizeLast() {
        guard pendingShape, let s = canvas.drawing.strokes.last, Date().timeIntervalSince(s.path.creationDate) < 30 else { return }
        pendingShape = false
        var pts: [Double] = []
        for p in s.path.interpolatedPoints(by: .distance(2)) {
            let q = p.location.applying(s.transform)
            pts.append(Double(q.x - origin.x)); pts.append(Double(q.y - origin.y)); pts.append(0.64)
        }
        let z = Double(canvas.zoomScale)
        if let json = try? JSONSerialization.data(withJSONObject: ["pts": pts, "zoom": z]), let str = String(data: json, encoding: .utf8) { onRecognize?(str) }
    }

    /// replace the last stroke with a clean shape (world points; sharp corners kept by repeating them)
    func replaceLast(_ world: [Double], sharp: Bool) {
        var strokes = canvas.drawing.strokes
        guard let last = strokes.popLast(), world.count >= 6 else { return }
        let sizes = last.path.map { $0.size.width }
        let size = sizes.isEmpty ? 3 : sizes.reduce(0, +) / CGFloat(sizes.count)
        var corners: [CGPoint] = []
        var i = 0
        while i + 1 < world.count { corners.append(CGPoint(x: world[i] + origin.x, y: world[i + 1] + origin.y)); i += 3 }
        var ctrl: [CGPoint] = []
        for (k, c) in corners.enumerated() {
            if k > 0 {
                let a = corners[k - 1], d = hypot(c.x - a.x, c.y - a.y), n = max(1, Int(d / 4))
                for j in 1..<n { let t = CGFloat(j) / CGFloat(n); ctrl.append(CGPoint(x: a.x + (c.x - a.x) * t, y: a.y + (c.y - a.y) * t)) }
            }
            if sharp { ctrl.append(c); ctrl.append(c) }
            ctrl.append(c)
        }
        let pts = ctrl.enumerated().map { PKStrokePoint(location: $1, timeOffset: TimeInterval($0) * 0.004, size: CGSize(width: size, height: size), opacity: 1, force: 0.6, azimuth: 0, altitude: .pi / 2) }
        strokes.append(PKStroke(ink: last.ink, path: PKStrokePath(controlPoints: pts, creationDate: last.path.creationDate)))
        canvas.drawing = PKDrawing(strokes: strokes)  // a user-visible edit: undo brings the freehand stroke back
    }

    // MARK: - lecture replay: ink written later in the recording fades until the audio reaches it

    private var replayOriginal: PKDrawing?
    private var replayDrawEnabled = true
    private var replayKey = -1
    func replay(on: Bool, start: Date, end: Date, t: TimeInterval) {
        if !on {
            guard let orig = replayOriginal else { return }
            loading = true; canvas.drawing = orig; loading = false
            replayOriginal = nil; replayKey = -1
            canvas.drawingGestureRecognizer.isEnabled = replayDrawEnabled
            return
        }
        if replayOriginal == nil {
            replayOriginal = canvas.drawing
            replayDrawEnabled = canvas.drawingGestureRecognizer.isEnabled
            canvas.drawingGestureRecognizer.isEnabled = false
        }
        guard let orig = replayOriginal else { return }
        let cut = start.addingTimeInterval(t)
        var dimmed = 0
        let strokes = orig.strokes.map { s -> PKStroke in
            let d = s.path.creationDate
            guard d >= start, d <= end, d > cut else { return s }
            dimmed += 1
            var c = s
            c.ink = PKInk(s.ink.inkType, color: s.ink.color.withAlphaComponent(0.12))
            return c
        }
        if dimmed == replayKey { return }
        replayKey = dimmed
        loading = true; canvas.drawing = PKDrawing(strokes: strokes); loading = false
    }
    private var savedDrawing: PKDrawing { replayOriginal ?? canvas.drawing }

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
        let o = origin
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
                    pts.append((Double(q.x - o.x) * 10).rounded() / 10)
                    pts.append((Double(q.y - o.y) * 10).rounded() / 10)
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
    static func stroke(_ d: [String: Any], offset: CGPoint = .zero) -> PKStroke? {
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
            points.append(PKStrokePoint(location: CGPoint(x: pts[i] + offset.x, y: pts[i + 1] + offset.y), timeOffset: TimeInterval(k) * 0.008, size: CGSize(width: size, height: size), opacity: o, force: min(1, max(0.1, m)), azimuth: 0, altitude: .pi / 2))
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
