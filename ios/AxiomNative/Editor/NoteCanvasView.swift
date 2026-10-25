import PencilKit
import UIKit

/// PencilKit with its own menus and undo switched off: the editor owns one menu system and one undo stack.
final class InkCanvas: PKCanvasView {
    private let quiet = UndoManager()
    override init(frame: CGRect) { super.init(frame: frame); quiet.disableUndoRegistration() }
    required init?(coder: NSCoder) { fatalError() }
    override func canPerformAction(_ action: Selector, withSender sender: Any?) -> Bool { false }
    override var undoManager: UndoManager? { quiet }
}

/// A view drawn in tiles at the zoom it is shown at, so paper lines stay one pixel sharp at every zoom.
final class TiledView: UIView {
    final class Layer: CATiledLayer { override class func fadeDuration() -> CFTimeInterval { 0 } }
    override class var layerClass: AnyClass { Layer.self }
    var drawContent: ((CGContext, CGRect, CGFloat) -> Void)?   // context, rect (view space), hairline width
    init(frame: CGRect, levels: Int, bias: Int) {
        super.init(frame: frame)
        let t = layer as! CATiledLayer
        t.levelsOfDetail = levels
        t.levelsOfDetailBias = bias
        t.tileSize = CGSize(width: 512, height: 512)
        isOpaque = false
        backgroundColor = .clear
        isUserInteractionEnabled = false
    }
    required init?(coder: NSCoder) { fatalError() }
    override func draw(_ rect: CGRect) {
        guard let ctx = UIGraphicsGetCurrentContext() else { return }
        let px = max(0.0001, ctx.ctm.a)
        drawContent?(ctx, rect, 1 / px)
    }
    func redraw() { layer.setNeedsDisplay() }
}

/// The page surface: notebook pages (or a canvas's endless paper) behind the ink, pictures and text in between,
/// selection and guides above. PencilKit owns the scrolling and zooming; everything else follows it.
final class NoteCanvasView: UIView, UIScrollViewDelegate {
    let canvas = InkCanvas()
    let stage = UIView()                 // paper + ink (rotated as one on canvases)
    let paper = UIView()                 // drawing coordinates, scaled by the zoom
    let overlay = OverlayView()          // selection, lasso, laser; above the ink
    private(set) var pageViews: [TiledView] = []
    private var gridView: TiledView?
    private(set) var elementViews: [String: ElementView] = [:]
    var doc: NoteDocument!
    var insets = UIEdgeInsets(top: 74, left: 20, bottom: 96, right: 84)
    private(set) var fit: CGFloat = 1
    var onViewChange: (() -> Void)?
    var onZoomEnd: (() -> Void)?

    var origin: CGPoint { doc?.origin ?? .zero }
    var zoom: CGFloat { canvas.zoomScale }

    override init(frame: CGRect) {
        super.init(frame: frame)
        backgroundColor = .clear
        clipsToBounds = true
        addSubview(stage)
        paper.layer.anchorPoint = .zero
        stage.addSubview(paper)
        canvas.backgroundColor = .clear
        canvas.isOpaque = false
        canvas.contentInsetAdjustmentBehavior = .never
        canvas.showsHorizontalScrollIndicator = false
        canvas.bouncesZoom = true
        canvas.drawingPolicy = .pencilOnly
        canvas.panGestureRecognizer.allowedTouchTypes = [NSNumber(value: UITouch.TouchType.direct.rawValue)]
        stage.addSubview(canvas)
        overlay.isUserInteractionEnabled = true
        addSubview(overlay)
    }
    required init?(coder: NSCoder) { fatalError() }

    private var lastWidth: CGFloat = 0
    override func layoutSubviews() {
        super.layoutSubviews()
        // a notebook shown at its fitted width refits when the space changes (the tutor or Desmos opens beside it)
        if let doc, doc.isNotebook, restored, lastWidth > 0, abs(bounds.width - lastWidth) > 1 {
            let wasFit = abs(canvas.zoomScale - fit) / max(fit, 0.01) < 0.03
            let top = toWorld(CGPoint(x: bounds.midX, y: insets.top)).y
            lastWidth = bounds.width
            stage.bounds = bounds; stage.center = CGPoint(x: bounds.midX, y: bounds.midY); canvas.frame = stage.bounds; overlay.frame = bounds
            layoutContent()
            if wasFit { canvas.zoomScale = fit; layoutContent() }
            canvas.contentOffset = CGPoint(x: -canvas.contentInset.left, y: top * canvas.zoomScale - insets.top)
            place()
            return
        }
        lastWidth = bounds.width
        stage.bounds = bounds
        stage.center = CGPoint(x: bounds.midX, y: bounds.midY)
        canvas.frame = stage.bounds
        overlay.frame = bounds
        layoutContent()
        // the saved view is applied once the page has its real size
        if doc != nil && !restored && bounds.width > 0 { restored = true; restoreView() } else { place() }
    }
    private var restored = false

    // MARK: building

    func load(_ d: NoteDocument, drawing: PKDrawing) {
        doc = d
        canvas.drawing = drawing
        applyInkAppearance()
        superview?.backgroundColor = deskColor
        if d.isNotebook {
            canvas.alwaysBounceVertical = true
            canvas.showsVerticalScrollIndicator = true
            rebuildPages()
        } else {
            canvas.alwaysBounceVertical = false
            canvas.showsVerticalScrollIndicator = false
            let half = NoteDocument.canvasHalf
            let g = TiledView(frame: CGRect(x: 0, y: 0, width: half * 2, height: half * 2), levels: 8, bias: 6)
            g.drawContent = { [weak self] ctx, rect, hair in
                guard let self, let doc = self.doc else { return }
                let bg = self.canvasPaper
                ctx.setFillColor(bg.cgColor); ctx.fill(rect)
                ctx.saveGState()
                ctx.translateBy(x: self.origin.x, y: self.origin.y)
                PaperRenderer.drawCanvasGrid(ctx, rect: rect.offsetBy(dx: -self.origin.x, dy: -self.origin.y), type: doc.gridType, spacing: doc.gridSpacing, divisions: doc.gridDivisions, bg: bg, hair: hair)
                ctx.restoreGState()
            }
            paper.insertSubview(g, at: 0)
            gridView = g
            paper.bounds = CGRect(x: 0, y: 0, width: half * 2, height: half * 2)
        }
        rebuildElements()
        layoutContent()
        if bounds.width > 0 { restored = true; restoreView() }
    }

    /// a light canvas is shown dark in dark mode (the "dark canvas" setting), its ink adapted by PencilKit
    var darkCanvas: Bool {
        guard let doc, !doc.isNotebook else { return false }
        return (Library.shared.settings["darkCanvas"] as? Bool ?? true) && traitCollection.userInterfaceStyle == .dark && UIColor(css: doc.paperColor).luminance > 0.5
    }
    var canvasPaper: UIColor { darkCanvas ? PaperRenderer.darkPaper : UIColor(css: doc?.paperColor ?? "#15171c") }
    /// PencilKit shows dark ink light on dark paper and as drawn on light paper
    func applyInkAppearance() {
        guard let doc else { return }
        let bg = doc.isNotebook ? UIColor(css: doc.pageColor) : canvasPaper
        canvas.overrideUserInterfaceStyle = PaperRenderer.isDark(bg) ? .dark : .light
    }

    var deskColor: UIColor {
        guard let doc else { return .black }
        if !doc.isNotebook { return canvasPaper }
        return traitCollection.userInterfaceStyle == .dark ? UIColor(css: "#0d0f13") : UIColor(css: "#e4e6eb")
    }

    func rebuildPages() {
        guard doc.isNotebook else { return }
        pageViews.forEach { $0.removeFromSuperview() }
        pageViews = []
        for i in doc.pages.indices {
            let r = doc.pageRect(i)
            let v = TiledView(frame: r, levels: 4, bias: 4)
            let index = i
            v.drawContent = { [weak self] ctx, rect, hair in
                guard let self, let doc = self.doc, index < doc.pages.count else { return }
                let bg = UIColor(css: doc.color(of: index))
                ctx.setFillColor(bg.cgColor); ctx.fill(rect)
                PaperRenderer.drawTemplate(ctx, rect: CGRect(origin: .zero, size: doc.pageSize), template: doc.template(of: index), bg: bg, hair: hair)
            }
            v.layer.shadowColor = UIColor.black.cgColor
            v.layer.shadowOpacity = traitCollection.userInterfaceStyle == .dark ? 0.5 : 0.16
            v.layer.shadowRadius = 9
            v.layer.shadowOffset = CGSize(width: 0, height: 3)
            v.layer.shadowPath = UIBezierPath(rect: CGRect(origin: .zero, size: r.size)).cgPath
            paper.insertSubview(v, at: i)
            pageViews.append(v)
        }
        let bb = doc.pageRects.reduce(CGRect.null) { $0.union($1) }
        paper.bounds = CGRect(x: 0, y: 0, width: bb.maxX, height: bb.maxY)
        layoutContent()
    }
    func redrawPages() { pageViews.forEach { $0.redraw() }; gridView?.redraw() }

    func rebuildElements() {
        elementViews.values.forEach { $0.removeFromSuperview() }
        elementViews = [:]
        for e in doc.elements { addElementView(e) }
    }
    @discardableResult
    func addElementView(_ e: Element) -> ElementView {
        let v = ElementView(element: e, origin: origin)
        paper.addSubview(v)
        elementViews[e.id] = v
        return v
    }
    func removeElementView(_ id: String) { elementViews[id]?.removeFromSuperview(); elementViews[id] = nil }
    func refreshElement(_ e: Element) { elementViews[e.id]?.refresh(origin: origin) }

    // MARK: zoom and scroll

    func layoutContent() {
        guard let doc, bounds.width > 0 else { return }
        let z = canvas.zoomScale
        if doc.isNotebook {
            let ps = doc.pageSize
            let free = bounds.width
            fit = min((free - (free > 900 ? 190 : 120)) / ps.width, 1.8)
            let bb = doc.pageRects.reduce(CGRect.null) { $0.union($1) }
            canvas.contentSize = CGSize(width: bb.maxX * z, height: bb.maxY * z)
            let w = bb.maxX * z
            let side = max(insets.left, (bounds.width - w) / 2)
            canvas.contentInset = UIEdgeInsets(top: insets.top, left: side, bottom: insets.bottom, right: max(insets.left, bounds.width - w - side))
            canvas.minimumZoomScale = fit * 0.3
            canvas.maximumZoomScale = fit * 6
        } else {
            fit = 1
            canvas.contentSize = CGSize(width: NoteDocument.canvasHalf * 2 * z, height: NoteDocument.canvasHalf * 2 * z)
            canvas.contentInset = .zero
            canvas.minimumZoomScale = 0.02
            canvas.maximumZoomScale = 40
        }
    }

    /// paper and pictures follow PencilKit's scroll and zoom
    func place() {
        let z = canvas.zoomScale
        CATransaction.begin(); CATransaction.setDisableActions(true)
        paper.transform = CGAffineTransform(scaleX: z, y: z)
        paper.frame.origin = CGPoint(x: -canvas.contentOffset.x, y: -canvas.contentOffset.y)
        CATransaction.commit()
        overlay.setNeedsLayout()
        onViewChange?()
    }

    func scrollViewDidScroll(_ scrollView: UIScrollView) { place() }
    func scrollViewDidZoom(_ scrollView: UIScrollView) { layoutContent(); place() }
    func scrollViewDidEndZooming(_ scrollView: UIScrollView, with view: UIView?, atScale scale: CGFloat) {
        elementViews.values.forEach { $0.setRenderScale(scale * (window?.screen.scale ?? 2)) }
        onZoomEnd?()
    }

    /// world point → screen point (this view's coordinates)
    func toScreen(_ p: CGPoint) -> CGPoint {
        let z = canvas.zoomScale
        let s = CGPoint(x: (p.x + origin.x) * z - canvas.contentOffset.x, y: (p.y + origin.y) * z - canvas.contentOffset.y)
        return stage.convert(s, to: self)
    }
    func toWorld(_ p: CGPoint) -> CGPoint {
        let s = convert(p, to: stage)
        let z = canvas.zoomScale
        return CGPoint(x: (s.x + canvas.contentOffset.x) / z - origin.x, y: (s.y + canvas.contentOffset.y) / z - origin.y)
    }
    func toScreen(_ r: CGRect) -> CGRect {
        let a = toScreen(CGPoint(x: r.minX, y: r.minY)), b = toScreen(CGPoint(x: r.maxX, y: r.maxY))
        return CGRect(x: min(a.x, b.x), y: min(a.y, b.y), width: abs(b.x - a.x), height: abs(b.y - a.y))
    }
    /// world rect currently on screen
    var visibleWorld: CGRect {
        let a = toWorld(.zero), b = toWorld(CGPoint(x: bounds.width, y: bounds.height))
        return CGRect(x: min(a.x, b.x), y: min(a.y, b.y), width: abs(b.x - a.x), height: abs(b.y - a.y))
    }

    func setView(zoom z: CGFloat, center: CGPoint) {
        layoutContent()
        canvas.zoomScale = z
        layoutContent()
        let zz = canvas.zoomScale
        canvas.contentOffset = CGPoint(x: (center.x + origin.x) * zz - bounds.width / 2, y: (center.y + origin.y) * zz - bounds.height / 2)
        place()
    }
    /// the saved view (tx, ty: screen position of the world origin)
    func restoreView() {
        guard let doc else { return }
        layoutSubviewsIfNeeded()
        layoutContent()     // zoom limits first, or the zoom below is clamped to the defaults
        if doc.isNotebook {
            let z = doc.view.zoom > fit * 0.3 && doc.view.zoom < fit * 6 && abs(doc.view.zoom - 1) > 0.0001 ? doc.view.zoom : fit
            canvas.zoomScale = z
            layoutContent()
            let zz = canvas.zoomScale
            let y = doc.viewTop.map { $0 * zz - insets.top } ?? -canvas.contentInset.top
            canvas.contentOffset = CGPoint(x: -canvas.contentInset.left, y: max(-canvas.contentInset.top, min(y, canvas.contentSize.height - bounds.height + canvas.contentInset.bottom)))
        } else {
            canvas.zoomScale = doc.view.zoom
            layoutContent()
            let z = canvas.zoomScale
            canvas.contentOffset = CGPoint(x: origin.x * z - doc.view.tx, y: origin.y * z - doc.view.ty)
        }
        place()
        elementViews.values.forEach { $0.setRenderScale(canvas.zoomScale * (window?.screen.scale ?? 2)) }
    }
    private func layoutSubviewsIfNeeded() { if bounds.width == 0 { superview?.layoutIfNeeded() }; layoutIfNeeded() }
    /// what to save: zoom and the screen position of the world origin
    var viewState: (CGFloat, CGFloat, CGFloat, CGFloat) {
        let z = canvas.zoomScale
        if doc?.isNotebook == true { return (z, 0, (canvas.contentOffset.y + insets.top) / z, 0) }
        return (z, origin.x * z - canvas.contentOffset.x, origin.y * z - canvas.contentOffset.y, 0)
    }

    /// notebook: page under the middle of the screen
    var currentPage: Int {
        guard let doc, doc.isNotebook else { return 0 }
        return doc.pageIndex(at: toWorld(CGPoint(x: bounds.midX, y: bounds.height * 0.4)))
    }
    func scrollTo(page i: Int, animated: Bool = true) {
        guard let doc, doc.isNotebook else { return }
        let r = doc.pageRect(i), z = canvas.zoomScale
        let y = r.minY * z - insets.top + 6
        canvas.setContentOffset(CGPoint(x: canvas.contentOffset.x, y: max(-canvas.contentInset.top, y)), animated: animated)
    }

    /// finger double-tap: zoom in around the finger, or back to the fitted page
    func toggleZoom(at p: CGPoint) {
        let w = toWorld(p)
        let base = doc.isNotebook ? fit : 1
        let target = canvas.zoomScale > base * 1.05 ? base : base * 2
        let vw = bounds.width / target, vh = bounds.height / target
        var cx = w.x + origin.x, cy = w.y + origin.y
        if doc.isNotebook && target <= base * 1.01 { cx = doc.pageSize.width / 2; cy = max(cy, vh / 2) }
        canvas.zoom(to: CGRect(x: cx - vw / 2, y: cy - vh / 2, width: vw, height: vh), animated: true)
    }
}

/// A picture or text box shown on the paper (below the ink).
final class ElementView: UIView {
    let element: Element
    private let imageView = UIImageView()
    private let label = UILabel()
    init(element: Element, origin: CGPoint) {
        self.element = element
        super.init(frame: .zero)
        isUserInteractionEnabled = false
        layer.anchorPoint = .zero
        imageView.contentMode = .scaleToFill
        imageView.clipsToBounds = true
        label.numberOfLines = 0
        addSubview(imageView)
        addSubview(label)
        refresh(origin: origin)
    }
    required init?(coder: NSCoder) { fatalError() }

    func refresh(origin: CGPoint) {
        let e = element
        transform = .identity
        bounds = CGRect(x: 0, y: 0, width: e.iw, height: e.ih)
        // the view's own box is item space; the element matrix places it in the world
        layer.anchorPoint = .zero
        layer.position = .zero
        transform = e.m.concatenating(CGAffineTransform(translationX: origin.x, y: origin.y))
        alpha = e.opacity
        if e.kind == .image {
            imageView.isHidden = false; label.isHidden = true
            imageView.frame = bounds
            if let img = e.loadImage() {
                if let c = e.crop, let base = e.cropBase, let cg = img.cgImage {
                    let kx = CGFloat(cg.width) / base.width, ky = CGFloat(cg.height) / base.height
                    let rect = CGRect(x: c.minX * kx, y: c.minY * ky, width: c.width * kx, height: c.height * ky).integral
                    imageView.image = cg.cropping(to: rect).map { UIImage(cgImage: $0) } ?? img
                } else { imageView.image = img }
            }
            backgroundColor = .clear
            layer.cornerRadius = 0
        } else {
            imageView.isHidden = true; label.isHidden = false
            let pad = e.bg != nil ? max(10, e.fontSize * 0.6) : 2
            label.frame = bounds.insetBy(dx: pad, dy: pad)
            let color = e.bg != nil ? UIColor(css: "#2a2620") : UIColor(css: e.color)
            label.attributedText = NSAttributedString(string: e.text, attributes: [.font: e.uiFont, .foregroundColor: color, .paragraphStyle: Element.para(e.fontSize)])
            if let bg = e.bg {
                backgroundColor = UIColor(css: bg); layer.cornerRadius = 6
                layer.shadowColor = UIColor.black.cgColor; layer.shadowOpacity = 0.18; layer.shadowRadius = 5; layer.shadowOffset = CGSize(width: 0, height: 3)
            } else { backgroundColor = .clear; layer.shadowOpacity = 0; layer.cornerRadius = 0 }
        }
    }
    /// text stays sharp when zoomed in
    func setRenderScale(_ s: CGFloat) {
        guard element.kind == .text else { return }
        let v = min(8, max(1, s))
        label.contentScaleFactor = v
        label.layer.contentsScale = v
        label.setNeedsDisplay()
    }
}
