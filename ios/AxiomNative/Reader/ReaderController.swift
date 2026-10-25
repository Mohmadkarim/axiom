import PDFKit
import PencilKit
import UIKit

/// A PDF page drawn in the reader's paper colour (night inverts the page itself, so handwriting keeps its colours)
/// with the highlights on top.
final class ThemedPage: PDFPage {
    static var theme = "paper"
    var marks: [(CGRect, UIColor)] = []          // highlights in page space (PDF coordinates, bottom-left origin)
    override func draw(with box: PDFDisplayBox, to context: CGContext) {
        super.draw(with: box, to: context)
        let b = bounds(for: box)
        context.saveGState()
        switch Self.theme {
        case "night":
            context.setBlendMode(.difference); context.setFillColor(UIColor.white.cgColor); context.fill(b)
            context.setBlendMode(.screen); context.setFillColor(UIColor(red: 0.09, green: 0.09, blue: 0.10, alpha: 1).cgColor); context.fill(b)
            context.setBlendMode(.multiply); context.setFillColor(UIColor(white: 0.92, alpha: 1).cgColor); context.fill(b)
        case "sepia":
            context.setBlendMode(.multiply); context.setFillColor(UIColor(css: "#f4ecd8").cgColor); context.fill(b)
        default: break
        }
        context.setBlendMode(Self.theme == "night" ? .screen : .multiply)
        for (r, c) in marks {
            context.setFillColor((Self.theme == "night" ? c.withAlphaComponent(c.cgColor.alpha * 0.7) : c).cgColor)
            context.addPath(UIBezierPath(roundedRect: r, cornerRadius: 2).cgPath); context.fillPath()
        }
        context.restoreGState()
    }
}

final class ReaderController: UIViewController, PDFDocumentDelegate, PDFPageOverlayViewProvider, PKCanvasViewDelegate, UIGestureRecognizerDelegate {
    let model: ReaderModel
    let book: BookMeta
    let pdfView = PDFView()
    private(set) var document: PDFDocument?
    let store: ReaderStore
    private var canvases: [Int: PKCanvasView] = [:]
    private let undo = UndoManager()
    override var undoManager: UndoManager? { undo }
    private let lassoLayer = CAShapeLayer()
    private var lassoPoints: [CGPoint] = []          // view points
    private var hlStart: (PDFPage, CGPoint)?
    private var saveWork: DispatchWorkItem?
    private var inkDirty = false

    init(book: BookMeta, model: ReaderModel) {
        self.book = book
        self.model = model
        store = ReaderStore(bookID: book.id)
        super.init(nibName: nil, bundle: nil)
    }
    required init?(coder: NSCoder) { fatalError() }

    override func loadView() {
        view = UIView()
        view.backgroundColor = Self.desk(model.theme)
        pdfView.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(pdfView)
        NSLayoutConstraint.activate([pdfView.leadingAnchor.constraint(equalTo: view.leadingAnchor), pdfView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
                                     pdfView.topAnchor.constraint(equalTo: view.topAnchor), pdfView.bottomAnchor.constraint(equalTo: view.bottomAnchor)])
        lassoLayer.strokeColor = UIColor.systemBlue.cgColor; lassoLayer.lineWidth = 1.5; lassoLayer.lineDashPattern = [6, 5]
        lassoLayer.fillColor = UIColor.systemBlue.withAlphaComponent(0.07).cgColor
        view.layer.addSublayer(lassoLayer)
    }

    static func desk(_ theme: String) -> UIColor { theme == "night" ? UIColor(css: "#0e0f12") : theme == "sepia" ? UIColor(css: "#e5dccb") : UIColor(css: "#16181d") }

    override func viewDidLoad() {
        super.viewDidLoad()
        ThemedPage.theme = model.theme
        pdfView.displayMode = .singlePageContinuous
        pdfView.displayDirection = .vertical
        pdfView.displaysPageBreaks = true
        pdfView.pageBreakMargins = UIEdgeInsets(top: 10, left: 0, bottom: 10, right: 0)
        pdfView.backgroundColor = .clear
        pdfView.pageShadowsEnabled = true
        pdfView.pageOverlayViewProvider = self
        pdfView.usePageViewController(false)
        guard let data = Store.shared.loadFile(book.fileID) else { model.error = "This file is missing. Remove it and import it again."; return }
        let doc: PDFDocument?
        if book.type == "image", let img = UIImage(data: data) {
            let d = PDFDocument(); d.delegate = self
            if let p = ThemedPage(image: img) { d.insert(p, at: 0) }
            doc = d
        } else {
            doc = PDFDocument(data: data)
        }
        guard let doc else { model.error = "This PDF could not be opened."; return }
        doc.delegate = self
        document = doc
        store.loadInk(document: doc)
        applyHighlights()
        pdfView.document = doc
        model.pageCount = doc.pageCount
        model.outline = ReaderController.outline(doc)
        pdfView.autoScales = true
        startIndex = max(0, min(doc.pageCount - 1, (model.startPage ?? book.lastPage) - 1))
        NotificationCenter.default.addObserver(self, selector: #selector(pageChanged), name: .PDFViewPageChanged, object: pdfView)
        NotificationCenter.default.addObserver(self, selector: #selector(flush), name: .axiomFlush, object: nil)
        installGestures()
        applyMode()
        let title = cleanTitle(book.name)
        Tutor.shared.focus(key: "book:" + book.id, title: title, subjectLine: "They are reading the book \"\(title)\"\(book.author.map { " by \($0)" } ?? "") (\(doc.pageCount) pages).")
        Tutor.shared.pageProvider = { [weak self] in
            guard let self else { return nil }
            let i = self.model.page
            return self.pageImage(i).map { ($0, "p. \(i + 1) of \(title)", self.pageText(i)) }
        }
    }
    deinit { NotificationCenter.default.removeObserver(self) }

    func classForPage() -> AnyClass { ThemedPage.self }

    /// the page to open at, applied once PDFKit has laid the document out (earlier it is ignored)
    private var startIndex: Int?
    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        guard let i = startIndex, pdfView.bounds.width > 0, let p = document?.page(at: i) else { return }
        startIndex = nil
        pdfView.layoutDocumentView()
        pdfView.go(to: p)
        settle(on: p, tries: 0)
    }
    /// PDFKit can ignore the first jumps while it lays pages out: try again until it is on the page
    private func settle(on p: PDFPage, tries: Int) {
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.06) { [weak self] in
            guard let self else { return }
            if self.pdfView.currentPage != p && tries < 20 { self.pdfView.go(to: p); self.settle(on: p, tries: tries + 1); return }
            self.ready = true
            self.pageChanged()
        }
    }
    private var ready = false

    // MARK: - modes

    func applyMode() {
        let write = model.mode == .write
        pdfView.isInMarkupMode = write
        for (_, c) in canvases { configure(c) }
        lassoLayer.path = nil
    }
    private func configure(_ c: PKCanvasView) {
        let write = model.mode == .write
        c.isUserInteractionEnabled = write
        c.drawingGestureRecognizer.isEnabled = write
        c.drawingPolicy = .pencilOnly
        c.overrideUserInterfaceStyle = model.theme == "night" ? .dark : .light
        if model.inkEraser { c.tool = PKEraserTool(.vector) }
        else { c.tool = PKInkingTool(.pen, color: UIColor(css: model.inkColor), width: model.inkWidth) }
    }
    func applyInkTool() { for (_, c) in canvases { configure(c) } }

    func applyTheme() {
        ThemedPage.theme = model.theme
        view.backgroundColor = Self.desk(model.theme)
        refreshPages()
        for (_, c) in canvases { configure(c) }
    }
    /// PDFKit keeps page tiles: show the document again to redraw them (staying on the same page)
    private func refreshPages() {
        guard let doc = document else { return }
        let cur = pdfView.currentPage
        let scale = pdfView.scaleFactor, auto = pdfView.autoScales
        pdfView.document = nil
        pdfView.document = doc
        pdfView.autoScales = auto
        if !auto { pdfView.scaleFactor = scale }
        if let cur { pdfView.go(to: cur) }
    }

    // MARK: - page

    @objc private func pageChanged() {
        guard ready, let doc = document, let p = pdfView.currentPage else { return }
        let i = doc.index(for: p)
        if model.page != i { model.page = i }
        model.pageLabel = p.label.flatMap { $0 == "\(i + 1)" ? nil : $0 }
        Library.shared.updateBook(book.id) { $0["lastPage"] = i + 1; $0["lastRead"] = Date().ms }
    }
    func go(to i: Int) { if let p = document?.page(at: max(0, min((document?.pageCount ?? 1) - 1, i))) { pdfView.go(to: p) } }
    func zoom(by k: CGFloat) { pdfView.autoScales = false; pdfView.scaleFactor = min(max(pdfView.scaleFactor * k, pdfView.minScaleFactor), pdfView.maxScaleFactor) }
    func fitWidth() { pdfView.autoScales = true }
    func fitPage() {
        guard let p = pdfView.currentPage else { return }
        let b = p.bounds(for: .cropBox)
        pdfView.autoScales = false
        pdfView.scaleFactor = min((pdfView.bounds.width - 40) / b.width, (pdfView.bounds.height - 140) / b.height)
        pdfView.go(to: p)
    }
    var zoomPercent: Int { Int((pdfView.scaleFactor / max(0.01, pdfView.scaleFactorForSizeToFit)) * 100) }

    // MARK: - handwriting (one PencilKit canvas per visible page)

    func pdfView(_ view: PDFView, overlayViewFor page: PDFPage) -> UIView? {
        guard let doc = document else { return nil }
        let i = doc.index(for: page)
        if let c = canvases[i], let holder = c.superview { return holder }
        let holder = PageInkHolder(pageSize: page.bounds(for: .cropBox).size)
        let c = holder.canvas
        c.backgroundColor = .clear
        c.isOpaque = false
        c.isScrollEnabled = false
        c.delegate = self
        c.tag = i
        c.drawing = store.drawing(for: i)
        configure(c)
        canvases[i] = c
        return holder
    }
    func pdfView(_ pdfView: PDFView, willEndDisplayingOverlayView overlayView: UIView, for page: PDFPage) {
        guard let doc = document, let c = (overlayView as? PageInkHolder)?.canvas else { return }
        let i = doc.index(for: page)
        store.setDrawing(c.drawing, for: i)
        canvases[i] = nil
        if inkDirty { scheduleSave() }
    }
    func canvasViewDrawingDidChange(_ canvasView: PKCanvasView) {
        store.setDrawing(canvasView.drawing, for: canvasView.tag)
        inkDirty = true
        model.canUndo = undo.canUndo
        scheduleSave()
    }
    func undoInk() { undo.undo(); model.canUndo = undo.canUndo }

    private func scheduleSave() {
        saveWork?.cancel()
        let w = DispatchWorkItem { [weak self] in self?.flush() }
        saveWork = w
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.2, execute: w)
    }
    @objc func flush() {
        saveWork?.cancel()
        for (i, c) in canvases { store.setDrawing(c.drawing, for: i) }
        if inkDirty { store.saveInk(); inkDirty = false }
    }

    // MARK: - Pencil in Read and Highlight modes: circle to ask, drag across text to highlight

    private func installGestures() {
        let g = PencilTracker(target: nil, action: nil)
        g.delegate = self
        g.onTouch = { [weak self] phase, touch, event in self?.pencil(phase, touch, event) }
        pdfView.addGestureRecognizer(g)
    }
    func gestureRecognizer(_ g: UIGestureRecognizer, shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer) -> Bool { true }

    private func pencil(_ phase: PencilTracker.Phase, _ touch: UITouch, _ event: UIEvent) {
        guard model.mode != .write, let doc = document else { return }
        let p = touch.location(in: pdfView)
        switch phase {
        case .began:
            model.ask = nil
            if model.mode == .highlight, let page = pdfView.page(for: p, nearest: true) { hlStart = (page, pdfView.convert(p, to: page)) }
            lassoPoints = [p]
        case .moved:
            let pts = (event.coalescedTouches(for: touch) ?? [touch]).map { $0.location(in: pdfView) }
            lassoPoints += pts
            if model.mode == .highlight, let (page, a) = hlStart {
                let b = pdfView.convert(p, to: page)
                pdfView.setCurrentSelection(page.selection(from: a, to: b), animate: false)
            } else {
                let path = UIBezierPath()
                for (k, q) in lassoPoints.enumerated() { let v = pdfView.convert(q, to: view); k == 0 ? path.move(to: v) : path.addLine(to: v) }
                lassoLayer.path = path.cgPath
            }
        case .ended:
            if model.mode == .highlight, let (page, a) = hlStart {
                let b = pdfView.convert(p, to: page)
                if let sel = page.selection(from: a, to: b), let text = sel.string, !text.trimmingCharacters(in: .whitespaces).isEmpty { addHighlight(page: page, selection: sel) }
                pdfView.clearSelection()
                hlStart = nil
            } else { finishLasso(doc) }
            lassoPoints = []
        case .cancelled:
            lassoLayer.path = nil; lassoPoints = []; hlStart = nil; pdfView.clearSelection()
        }
    }

    /// a circled (or boxed) region becomes the question's subject: page, region and the text inside it
    private func finishLasso(_ doc: PDFDocument) {
        defer { DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) { [weak self] in if self?.model.ask == nil { self?.lassoLayer.path = nil } } }
        guard lassoPoints.count > 3, let first = lassoPoints.first, let page = pdfView.page(for: first, nearest: true) else { return }
        let pts = lassoPoints.map { pdfView.convert($0, to: page) }
        let xs = pts.map(\.x), ys = pts.map(\.y)
        let rect = CGRect(x: xs.min()!, y: ys.min()!, width: xs.max()! - xs.min()!, height: ys.max()! - ys.min()!)
        guard rect.width > 12 || rect.height > 12 else { lassoLayer.path = nil; return }
        let text = page.selection(for: rect)?.string?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let viewRect = pdfView.convert(rect, from: page)
        model.ask = AskTarget(page: doc.index(for: page), rect: rect, text: text, anchor: pdfView.convert(viewRect, to: view))
    }

    /// a picture of part of a page (with its handwriting), for the tutor
    func regionImage(page i: Int, rect: CGRect, maxPixels: CGFloat = 1500) -> UIImage? {
        guard let page = document?.page(at: i) else { return nil }
        let r = rect.insetBy(dx: -6, dy: -6).intersection(page.bounds(for: .cropBox))
        let s = min(4, maxPixels / max(r.width, r.height, 1))
        let size = CGSize(width: r.width * s, height: r.height * s)
        let fmt = UIGraphicsImageRendererFormat(); fmt.scale = 1
        let pageH = page.bounds(for: .cropBox).height
        return UIGraphicsImageRenderer(size: size, format: fmt).image { ctx in
            let cg = ctx.cgContext
            UIColor.white.setFill(); cg.fill(CGRect(origin: .zero, size: size))
            cg.saveGState()
            cg.translateBy(x: 0, y: size.height); cg.scaleBy(x: s, y: -s); cg.translateBy(x: -r.minX, y: -r.minY)
            let old = ThemedPage.theme; ThemedPage.theme = "paper"
            page.draw(with: .cropBox, to: cg)
            ThemedPage.theme = old
            cg.restoreGState()
            // handwriting is stored top-left origin in page points
            let ink = store.drawing(for: i)
            if !ink.strokes.isEmpty {
                let top = CGRect(x: r.minX, y: pageH - r.maxY, width: r.width, height: r.height)
                ink.image(from: top, scale: s).draw(in: CGRect(origin: .zero, size: size))
            }
        }
    }
    func pageImage(_ i: Int, maxPixels: CGFloat = 1600) -> UIImage? {
        guard let page = document?.page(at: i) else { return nil }
        return regionImage(page: i, rect: page.bounds(for: .cropBox), maxPixels: maxPixels)
    }
    func pageText(_ i: Int) -> String { document?.page(at: i)?.string ?? "" }

    // MARK: - highlights

    private func applyHighlights() {
        guard let doc = document else { return }
        var byPage: [Int: [(CGRect, UIColor)]] = [:]
        for h in store.highlights {
            guard let page = doc.page(at: h.page - 1) else { continue }
            let b = page.bounds(for: .cropBox)
            for r in h.rects {
                // stored as page fractions with a top-left origin
                let rr = CGRect(x: b.minX + r.minX * b.width, y: b.maxY - r.maxY * b.height, width: r.width * b.width, height: r.height * b.height)
                byPage[h.page - 1, default: []].append((rr, ReaderStore.colors[h.color] ?? ReaderStore.colors["yellow"]!))
            }
        }
        for i in 0..<doc.pageCount { (doc.page(at: i) as? ThemedPage)?.marks = byPage[i] ?? [] }
        model.highlights = store.highlights.sorted { ($0.page, $0.created) < ($1.page, $1.created) }
    }
    func addHighlight(page: PDFPage, selection: PDFSelection, color: String = "yellow") {
        guard let doc = document else { return }
        let b = page.bounds(for: .cropBox)
        let rects = selection.selectionsByLine().map { $0.bounds(for: page) }.filter { $0.width > 1 }.map { r in
            CGRect(x: (r.minX - b.minX) / b.width - 0.003, y: (b.maxY - r.maxY) / b.height - 0.002, width: r.width / b.width + 0.006, height: r.height / b.height + 0.004)
        }
        guard !rects.isEmpty else { return }
        store.highlights.append(.init(page: doc.index(for: page) + 1, rects: rects, color: color, text: selection.string ?? ""))
        store.saveAnnotations()
        applyHighlights()
        refreshPages()
        UISelectionFeedbackGenerator().selectionChanged()
    }
    func highlightAsk(_ a: AskTarget) {
        guard let page = document?.page(at: a.page), let sel = page.selection(for: a.rect) else { return }
        addHighlight(page: page, selection: sel)
    }
    func removeHighlight(_ id: String) {
        store.highlights.removeAll { $0.id == id }
        store.saveAnnotations(); applyHighlights(); refreshPages()
    }
    func recolorHighlight(_ id: String, _ color: String) {
        if let i = store.highlights.firstIndex(where: { $0.id == id }) { store.highlights[i].color = color }
        store.saveAnnotations(); applyHighlights(); refreshPages()
    }

    // MARK: - search and contents

    func search(_ q: String) -> [SearchHit] {
        guard let doc = document, q.count >= 2 else { return [] }
        return doc.findString(q, withOptions: [.caseInsensitive, .diacriticInsensitive]).prefix(80).compactMap { sel in
            guard let page = sel.pages.first else { return nil }
            let ctx = sel.copy() as! PDFSelection
            ctx.extendForLineBoundaries()
            return SearchHit(page: doc.index(for: page), snippet: (ctx.string ?? sel.string ?? "").replacingOccurrences(of: "\n", with: " "), selection: sel)
        }
    }
    func show(_ hit: SearchHit) {
        pdfView.go(to: hit.selection)
        pdfView.setCurrentSelection(hit.selection, animate: true)
        DispatchQueue.main.asyncAfter(deadline: .now() + 2.5) { [weak self] in self?.pdfView.clearSelection() }
    }
    static func outline(_ doc: PDFDocument) -> [OutlineItem] {
        guard let root = doc.outlineRoot else { return [] }
        var out: [OutlineItem] = []
        func walk(_ o: PDFOutline, _ level: Int) {
            for i in 0..<o.numberOfChildren {
                guard let c = o.child(at: i) else { continue }
                if let page = c.destination?.page { out.append(OutlineItem(title: c.label ?? "", page: doc.index(for: page), level: level)) }
                if level < 2 { walk(c, level + 1) }
            }
        }
        walk(root, 0)
        return out
    }
}

struct AskTarget: Equatable {
    let page: Int
    let rect: CGRect           // PDF page space
    let text: String
    let anchor: CGRect         // on screen
}
struct SearchHit: Identifiable { let id = UUID(); let page: Int; let snippet: String; let selection: PDFSelection }
struct OutlineItem: Identifiable { let id = UUID(); let title: String; let page: Int; let level: Int }

/// A page's handwriting, always in page points: PDFKit resizes this view with the page, the canvas inside is scaled.
final class PageInkHolder: UIView {
    let canvas = PKCanvasView()
    let pageSize: CGSize
    init(pageSize: CGSize) {
        self.pageSize = pageSize
        super.init(frame: .zero)
        backgroundColor = .clear
        addSubview(canvas)
    }
    required init?(coder: NSCoder) { fatalError() }
    override func layoutSubviews() {
        super.layoutSubviews()
        guard pageSize.width > 0, bounds.width > 0 else { return }
        let s = bounds.width / pageSize.width
        canvas.transform = .identity
        canvas.bounds = CGRect(origin: .zero, size: pageSize)
        canvas.center = CGPoint(x: bounds.midX, y: bounds.midY)
        canvas.transform = CGAffineTransform(scaleX: s, y: s)
    }
    override func hitTest(_ point: CGPoint, with event: UIEvent?) -> UIView? {
        canvas.isUserInteractionEnabled ? super.hitTest(point, with: event) : nil
    }
}
