import PencilKit
import SwiftUI
import PhotosUI
import UIKit

/// Watches every Apple Pencil touch without ever taking it from PencilKit (lasso, text taps, laser, draw-and-hold).
final class PencilTracker: UIGestureRecognizer {
    enum Phase { case began, moved, ended, cancelled }
    var onTouch: ((Phase, UITouch, UIEvent) -> Void)?
    private var tracked: UITouch?
    override init(target: Any?, action: Selector?) {
        super.init(target: target, action: action)
        cancelsTouchesInView = false; delaysTouchesBegan = false; delaysTouchesEnded = false
        allowedTouchTypes = [NSNumber(value: UITouch.TouchType.pencil.rawValue)]
    }
    override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent) {
        guard tracked == nil, let t = touches.first else { return }
        tracked = t; onTouch?(.began, t, event)
    }
    override func touchesMoved(_ touches: Set<UITouch>, with event: UIEvent) { if let t = tracked, touches.contains(t) { onTouch?(.moved, t, event) } }
    override func touchesEnded(_ touches: Set<UITouch>, with event: UIEvent) {
        if let t = tracked, touches.contains(t) { onTouch?(.ended, t, event); tracked = nil; state = .failed }
    }
    override func touchesCancelled(_ touches: Set<UITouch>, with event: UIEvent) {
        if let t = tracked, touches.contains(t) { onTouch?(.cancelled, t, event); tracked = nil; state = .failed }
    }
    override func reset() { tracked = nil }
}

/// Everything that can be undone, as one value.
struct EditorState {
    var drawing: PKDrawing
    var elements: [JSON]
    var pages: [JSON]
    var setup: JSON
}

final class EditorController: UIViewController, PKCanvasViewDelegate, UIGestureRecognizerDelegate, UIPencilInteractionDelegate, UITextViewDelegate {
    let model: EditorModel
    let doc: NoteDocument
    let surface = NoteCanvasView()
    private let undo = UndoManager()
    override var undoManager: UndoManager? { undo }

    private var applying = false
    private var inkBefore: PKDrawing?
    private var inkChanged = false
    private var selection: Selection?
    private var saveWork: DispatchWorkItem?
    private var dirty = false
    // pencil tracking
    private var lassoPoints: [CGPoint] = []
    private var pencilStart: CGPoint = .zero
    private var lastMove: (CGPoint, TimeInterval) = (.zero, 0)
    private var strokePoints: [CGPoint] = []
    private var laserPoints: [(CGPoint, TimeInterval)] = []
    private var laserLink: CADisplayLink?
    // selection gestures
    private enum Drag { case move, scale(CGPoint), rotate }
    private var drag: Drag?
    private var dragStartWorld: CGPoint = .zero
    private var dragT0: CGAffineTransform = .identity
    private var holdDrag = false
    private var holdStartWorld: CGPoint = .zero
    private var holdStartScreen: CGPoint = .zero
    // text editing
    private var textView: UITextView?
    private var textElement: Element?
    private var textBefore: EditorState?

    init(doc: NoteDocument, model: EditorModel) {
        self.doc = doc
        self.model = model
        super.init(nibName: nil, bundle: nil)
    }
    required init?(coder: NSCoder) { fatalError() }

    override func loadView() {
        view = UIView()
        view.addSubview(surface)
        surface.translatesAutoresizingMaskIntoConstraints = false
        NSLayoutConstraint.activate([surface.leadingAnchor.constraint(equalTo: view.leadingAnchor), surface.trailingAnchor.constraint(equalTo: view.trailingAnchor),
                                     surface.topAnchor.constraint(equalTo: view.topAnchor), surface.bottomAnchor.constraint(equalTo: view.bottomAnchor)])
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        undo.levelsOfUndo = 200
        surface.load(doc, drawing: doc.loadInk())
        surface.canvas.delegate = self    // load() sets the scroll delegate; the canvas delegate is this controller
        surface.onViewChange = { [weak self] in self?.viewChanged() }
        surface.onZoomEnd = { [weak self] in self?.renderLifted() }
        surface.overlay.layoutHook = { [weak self] in self?.layoutOverlay() }
        installGestures()
        applyTool()
        model.pageCount = doc.pages.count
        model.isNotebook = doc.isNotebook
        syncUndo()
        NotificationCenter.default.addObserver(self, selector: #selector(flush), name: .axiomFlush, object: nil)
        if !doc.legacyStrokes.isEmpty { dirty = true; scheduleSave() }
        #if DEBUG
        installDebug()
        #endif
        connectTutor()
        AppState.shared.editor = self
        model.recordings = doc.recordings
        model.activeRec = doc.recordings.last?.str("id")
        replayTimer = Timer.scheduledTimer(withTimeInterval: 0.12, repeats: true) { [weak self] _ in self?.updateReplay() }
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { [weak self] in self?.snapshotVersion("Opened") }
    }

    // MARK: - version history (ver_<id>: up to 15 snapshots, on opening and every ten minutes of editing)

    private var lastVersion = Date()
    func versions() -> [JSON] { (Store.shared.loadFile("ver_" + doc.id).flatMap(JSONIO.parse) as? [Any])?.compactMap { $0 as? JSON } ?? [] }
    func snapshotVersion(_ label: String = "") {
        lastVersion = Date()
        var list = versions()
        let j = doc.json(viewState: surface.viewState)
        var snap: JSON = [:]
        for k in ["layers", "pages", "page", "artboards", "paper", "recordings"] { snap[k] = j[k] ?? NSNull() }
        guard let sd = JSONIO.data(snap), let data = String(data: sd, encoding: .utf8) else { return }
        let ink = fullDrawing.dataRepresentation().base64EncodedString()
        if let last = list.last, last.str("data") == data, last.str("ink") == ink { return }
        if data.count + ink.count > 25_000_000 { return }
        let thumb = Thumbnail.render(doc: doc, drawing: fullDrawing, width: 180)?.jpegData(compressionQuality: 0.6)?.dataURL(mime: "image/jpeg")
        list.append(["t": Date().ms, "label": label, "pages": doc.pages.count, "thumb": thumb ?? NSNull(), "data": data, "ink": ink])
        while list.count > 15 { list.removeFirst() }
        if let d = JSONIO.data(list) { Store.shared.saveFile("ver_" + doc.id, d) }
    }
    /// bring a version back (undoable; the current state is kept as a version first)
    func restoreVersion(_ v: JSON) {
        snapshotVersion("Before restore")
        guard let data = v.str("data")?.data(using: .utf8), let snap = JSONIO.object(data) else { return }
        endSelection()
        let before = snapshot()
        var drawing = PKDrawing()
        if let b64 = v.str("ink"), let d = Data(base64Encoded: b64), let dr = try? PKDrawing(data: d) { drawing = dr }
        else {
            // a version from the earlier app: its copy of the ink becomes PencilKit ink
            let o = surface.origin
            let items = snap.arr("layers").filter { $0.bool("pk") }.flatMap { $0.arr("items") }
            drawing = PKDrawing(strokes: items.compactMap { InkConvert.stroke(from: $0, offset: o, mirrored: true) })
            if items.isEmpty { drawing = fullDrawing }
        }
        var els: [Element] = []
        for l in snap.arr("layers") where !l.bool("pk") { for it in l.arr("items") { if let e = Element(it) { els.append(e) } } }
        doc.elements = els
        doc.pages = snap.arr("pages").map(PageInfo.init)
        if doc.isNotebook && doc.pages.isEmpty { doc.pages = [PageInfo()] }
        if let p = snap.obj("page") { doc.template = p.str("template") ?? doc.template; doc.pageColor = p.str("color") ?? doc.pageColor }
        if let p = snap.obj("paper") { doc.paperColor = p.str("bg") ?? doc.paperColor }
        setDrawing(drawing)
        surface.rebuildPages(); surface.rebuildElements(); surface.redrawPages()
        model.pageCount = doc.pages.count
        commit(from: before, name: "Restore version")
        AppState.shared.say("Version restored", 1.4)
    }
    private var replayTimer: Timer?

    // MARK: - lecture recording and ink replay

    func startRecording() {
        let id = UID.make()
        Task { @MainActor in
            if let err = await LectureAudio.shared.record(id: id) { AppState.shared.say(err, 3); return }
            let n = doc.recordings.count + 1
            doc.recordings.append(["id": id, "name": "Recording \(n)", "created": Date().ms, "dur": 0])
            model.recordings = doc.recordings
            model.activeRec = id
            dirty = true; scheduleSave()
        }
    }
    func stopRecording() {
        guard let id = LectureAudio.shared.recordingID else { return }
        let d = LectureAudio.shared.stopRecording()
        if let i = doc.recordings.firstIndex(where: { $0.str("id") == id }) { doc.recordings[i]["dur"] = (d * 10).rounded() / 10 }
        model.recordings = doc.recordings
        dirty = true; save()
        AppState.shared.say("Recording saved", 1.2)
    }
    func renameRecording(_ id: String, _ name: String) {
        if let i = doc.recordings.firstIndex(where: { $0.str("id") == id }) { doc.recordings[i]["name"] = name }
        model.recordings = doc.recordings; dirty = true; scheduleSave()
    }
    func deleteRecording(_ id: String) {
        LectureAudio.shared.delete(id)
        doc.recordings.removeAll { $0.str("id") == id }
        model.recordings = doc.recordings
        if model.activeRec == id { model.activeRec = doc.recordings.last?.str("id") }
        dirty = true; scheduleSave()
    }
    var activeRecording: JSON? { model.activeRec.flatMap { id in doc.recordings.first { $0.str("id") == id } } }

    fileprivate(set) var replayOriginal: PKDrawing?
    fileprivate(set) var replayKey = -1
    private func updateReplay() {
        let a = LectureAudio.shared
        guard model.replayInk, let rec = activeRecording, let id = rec.str("id"), a.playingID == id, a.time > 0 || a.isPlaying else { endReplay(); return }
        if replayOriginal == nil {
            endSelection()
            if textView != nil { endTextEdit() }
            replayOriginal = surface.canvas.drawing
            surface.canvas.drawingGestureRecognizer.isEnabled = false
        }
        guard let orig = replayOriginal else { return }
        let start = Date(ms: rec.num("created") ?? 0), end = start.addingTimeInterval((rec.num("dur") ?? 36000) + 1.5), cut = start.addingTimeInterval(a.time)
        var dimmed = 0
        let strokes = orig.strokes.map { s -> PKStroke in
            let d = s.path.creationDate
            guard d >= start, d <= end, d > cut else { return s }
            dimmed += 1
            return PKStroke(ink: PKInk(s.ink.inkType, color: s.ink.color.withAlphaComponent(0.12)), path: s.path, transform: s.transform, mask: s.mask)
        }
        if dimmed == replayKey { return }
        replayKey = dimmed
        setDrawing(PKDrawing(strokes: strokes))
    }
    private func endReplay() {
        guard let orig = replayOriginal else { return }
        replayOriginal = nil; replayKey = -1
        setDrawing(orig)
        applyTool()
    }
    /// while a recording plays, tapping ink jumps to the moment it was written
    private func seekToStroke(at w: CGPoint) -> Bool {
        let a = LectureAudio.shared
        guard let rec = activeRecording, a.playingID == rec.str("id"), let orig = replayOriginal ?? Optional(surface.canvas.drawing),
              let i = Geometry.strokeAt(w, drawing: orig, origin: surface.origin, tolerance: 12 / surface.zoom) else { return false }
        let t = orig.strokes[i].path.creationDate.timeIntervalSince(Date(ms: rec.num("created") ?? 0)) - 1.5
        guard t > -1.5, t < (rec.num("dur") ?? 0) + 2 else { return false }
        a.seek(max(0, t)); if !a.isPlaying { a.play(id: rec.str("id")!) }
        return true
    }

    // MARK: - tutor

    func connectTutor() {
        let t = Tutor.shared
        t.focus(key: "note:" + doc.id, title: doc.name, subjectLine: doc.isNotebook
            ? "They are in a notebook called \"\(doc.name)\" with \(doc.pages.count) pages of handwritten notes (page images are attached when relevant)."
            : "They are working on a canvas called \"\(doc.name)\" (pictures of it are attached when relevant).")
        t.pageProvider = { [weak self] in
            guard let self else { return nil }
            let d = self.fullDrawing
            if self.doc.isNotebook {
                let i = self.surface.currentPage
                return Thumbnail.page(doc: self.doc, drawing: d, index: i, width: 1400).map { ($0, "page \(i + 1) of \(self.doc.name)", nil) }
            }
            return Thumbnail.region(doc: self.doc, drawing: d, rect: self.surface.visibleWorld, pixelWidth: 1400, background: UIColor(css: self.doc.paperColor), grid: true).map { ($0, "the canvas \(self.doc.name)", nil) }
        }
    }
    var fullDrawing: PKDrawing { replayOriginal ?? selection.map { $0.drawingWith(origin: surface.origin) } ?? surface.canvas.drawing }

    /// pages with writing, nearest to the current one first (up to 12)
    func writtenPageImages(limit: Int = 12) -> [UIImage] {
        guard doc.isNotebook else { return Tutor.shared.pageProvider?().map { [$0.image] } ?? [] }
        let d = fullDrawing, o = surface.origin
        let used = doc.pages.indices.filter { i in
            let r = doc.pageRect(i)
            return d.strokes.contains { r.intersects($0.renderBounds.offsetBy(dx: -o.x, dy: -o.y)) } || doc.elements.contains { r.intersects($0.bounds) }
        }
        let cur = surface.currentPage
        return used.sorted { abs($0 - cur) < abs($1 - cur) }.prefix(limit).sorted().compactMap { Thumbnail.page(doc: doc, drawing: d, index: $0, width: 1400) }
    }
    func learn(_ kind: String) {
        let t = Tutor.shared
        switch kind {
        case "chat":
            t.focus(key: "note:" + doc.id, title: doc.name, subjectLine: t.subjectLine)
            withAnimation(.snappy(duration: 0.25)) { t.isOpen = true }
        case "notes":
            t.ask("Turn my handwritten notes into clean, well-structured smart notes: headings, key definitions, theorems and formulas in LaTeX, and worked examples. Point out anything that looks wrong or incomplete.", about: .notebook(docID: doc.id, name: doc.name, images: writtenPageImages(), label: "my notes"), mode: .explain)
        case "quiz":
            t.ask("Make 6 multiple-choice practice questions from my notes, from easier to harder, with explanations.", about: .notebook(docID: doc.id, name: doc.name, images: writtenPageImages(), label: "my notes"), mode: .quiz)
        case "cards":
            t.ask("Make 12 flashcards from my notes (definitions, theorems, formulas, key facts).", about: .notebook(docID: doc.id, name: doc.name, images: writtenPageImages(), label: "my notes"), mode: .explain)
        case "check":
            let imgs = Tutor.shared.pageProvider?().map { [$0.image] } ?? []
            t.ask("Check my work on this page. Point out mistakes precisely and say what is correct.", about: .notebook(docID: doc.id, name: doc.name, images: imgs, label: doc.isNotebook ? "page \(surface.currentPage + 1)" : "the canvas"), mode: .check)
        default: break
        }
    }
    #if DEBUG
    private func installDebug() {
        let d = DebugChannel.shared
        d.handlers["state"] = { [weak self] _ in
            guard let self else { return "no editor" }
            let c = self.surface.canvas
            return ["zoom": c.zoomScale, "fit": self.surface.fit, "off": [c.contentOffset.x, c.contentOffset.y], "inset": [c.contentInset.left, c.contentInset.top],
                    "pages": self.doc.pages.count, "page": self.model.page, "strokes": c.drawing.strokes.count, "elements": self.doc.elements.count,
                    "undo": self.undo.canUndo, "redo": self.undo.canRedo, "sel": self.selection.map { ["strokes": $0.strokes.count, "elements": $0.elements.count, "moved": $0.moved] } ?? NSNull(),
                    "style": c.overrideUserInterfaceStyle == .dark ? "dark" : "light", "tool": self.model.tool.kind.rawValue, "replaying": self.replayOriginal != nil, "dimmed": self.replayKey, "audioT": LectureAudio.shared.time, "playing": LectureAudio.shared.isPlaying] as [String: Any]
        }
        d.handlers["dates"] = { [weak self] _ in
            guard let self, let rec = self.activeRecording else { return "no rec" }
            let start = Date(ms: rec.num("created") ?? 0)
            return (self.replayOriginal ?? self.surface.canvas.drawing).strokes.map { $0.path.creationDate.timeIntervalSince(start) }
        }
        d.handlers["restore"] = { [weak self] a in
            guard let self else { return "" }
            let list = self.versions(); let i = list.count - 1 - (Int(a.first ?? "1") ?? 1)
            guard list.indices.contains(i) else { return "no such version" }
            self.restoreVersion(list[i]); return ["strokes": self.surface.canvas.drawing.strokes.count, "elements": self.doc.elements.count, "pages": self.doc.pages.count]
        }
        d.handlers["delel"] = { [weak self] a in
            guard let self, let i = Int(a.first ?? ""), self.doc.elements.indices.contains(i) else { return "?" }
            let e = self.doc.elements[i]; self.beginSelection(strokes: [], elements: [e]); self.deleteSelection(); return self.doc.elements.count
        }
        d.handlers["tool"] = { [weak self] a in self?.model.select(Int(a.first ?? "0") ?? 0); self?.applyTool(); return self?.model.tool.kind.rawValue ?? "" }
        d.handlers["undo"] = { [weak self] _ in self?.performUndo(); return "ok" }
        d.handlers["redo"] = { [weak self] _ in self?.performRedo(); return "ok" }
        d.handlers["lasso"] = { [weak self] a in
            guard let self, a.count == 4, let x0 = Double(a[0]), let y0 = Double(a[1]), let x1 = Double(a[2]), let y1 = Double(a[3]) else { return "lasso x0 y0 x1 y1 (world)" }
            let poly = [CGPoint(x: x0, y: y0), CGPoint(x: x1, y: y0), CGPoint(x: x1, y: y1), CGPoint(x: x0, y: y1)]
            let st = Geometry.strokesInside(poly, drawing: self.surface.canvas.drawing, origin: self.surface.origin)
            let els = self.doc.elements.filter { e in e.corners.allSatisfy { Geometry.pointInPolygon($0, poly) } }
            self.beginSelection(strokes: st, elements: els)
            return ["strokes": st.count, "elements": els.count]
        }
        d.handlers["move"] = { [weak self] a in
            guard let self, let sel = self.selection, a.count == 2, let dx = Double(a[0]), let dy = Double(a[1]) else { return "no selection" }
            sel.T = sel.T.concatenating(CGAffineTransform(translationX: dx, y: dy)); self.previewSelection(); return "ok"
        }
        d.handlers["deselect"] = { [weak self] _ in self?.endSelection(); return "ok" }
        d.handlers["delete"] = { [weak self] _ in self?.deleteSelection(); return "ok" }
        d.handlers["duplicate"] = { [weak self] _ in self?.duplicateSelection(); return "ok" }
        d.handlers["page"] = { [weak self] a in self?.surface.scrollTo(page: Int(a.first ?? "0") ?? 0, animated: false); return "ok" }
        d.handlers["addpage"] = { [weak self] _ in guard let self else { return "" }; self.insertPage(at: self.model.page + 1); return self.doc.pages.count }
        d.handlers["delpage"] = { [weak self] a in self?.deletePage(Int(a.first ?? "0") ?? 0); return self?.doc.pages.count ?? 0 }
        d.handlers["testimage"] = { [weak self] _ in
            let img = UIGraphicsImageRenderer(size: CGSize(width: 600, height: 400)).image { c in UIColor.white.setFill(); c.fill(CGRect(x: 0, y: 0, width: 600, height: 400)); UIColor.systemRed.setFill(); c.cgContext.fillEllipse(in: CGRect(x: 200, y: 100, width: 200, height: 200)); UIColor.systemBlue.setFill(); c.fill(CGRect(x: 0, y: 0, width: 600, height: 50)) }
            self?.insertImage(img); return "ok"
        }
        d.handlers["text"] = { [weak self] a in guard let self else { return "" }; let w = self.surface.visibleWorld; self.beginTextAt(CGPoint(x: w.midX, y: w.midY)); self.textView?.insertText(a.joined(separator: " ")); self.endTextEdit(); return self.doc.elements.count }
        d.handlers["save"] = { [weak self] _ in self?.flush(); return "ok" }
        d.handlers["zoomtap"] = { [weak self] a in guard let self else { return "" }; self.surface.toggleZoom(at: CGPoint(x: Double(a.first ?? "400") ?? 400, y: Double(a.last ?? "500") ?? 500)); return "ok" }
        d.handlers["shape"] = { [weak self] _ in
            // a wobbly circle as the last stroke, then recognised
            guard let self else { return "" }
            let o = self.surface.origin, c = CGPoint(x: self.surface.visibleWorld.midX, y: self.surface.visibleWorld.midY)
            let pts = (0...60).map { i -> PKStrokePoint in let t = Double(i) / 60 * 2 * .pi; let r = 80 + 6 * sin(t * 5); return PKStrokePoint(location: CGPoint(x: c.x + o.x + r * cos(t), y: c.y + o.y + r * sin(t)), timeOffset: Double(i) * 0.01, size: CGSize(width: 3, height: 3), opacity: 1, force: 0.6, azimuth: 0, altitude: .pi / 2) }
            let before = self.snapshot()
            self.setDrawingForTest(PKDrawing(strokes: self.surface.canvas.drawing.strokes + [PKStroke(ink: PKInk(.pen, color: .black), path: PKStrokePath(controlPoints: pts, creationDate: Date()))]))
            self.commit(from: before, name: "Ink")
            self.shapeLastStrokeForTest()
            return self.surface.canvas.drawing.strokes.count
        }
    }
    func setDrawingForTest(_ d: PKDrawing) { setDrawing(d) }
    func shapeLastStrokeForTest() { shapeLastStroke([]) }
    #endif
    deinit { NotificationCenter.default.removeObserver(self); replayTimer?.invalidate() }
    override func viewDidDisappear(_ animated: Bool) {
        super.viewDidDisappear(animated)
        replayTimer?.invalidate(); replayTimer = nil
        if LectureAudio.shared.recordingID != nil { stopRecording() }
        LectureAudio.shared.stopPlayback()
    }

    // PencilKit's own scroll delegate calls go to the surface; this controller is its PKCanvasViewDelegate.
    func scrollViewDidScroll(_ scrollView: UIScrollView) { surface.scrollViewDidScroll(scrollView) }
    func scrollViewDidZoom(_ scrollView: UIScrollView) { surface.scrollViewDidZoom(scrollView) }
    func scrollViewDidEndZooming(_ scrollView: UIScrollView, with view: UIView?, atScale scale: CGFloat) { surface.scrollViewDidEndZooming(scrollView, with: view, atScale: scale) }

    private func viewChanged() {
        if doc.isNotebook {
            let p = surface.currentPage
            if p != model.page { model.page = p }
        }
        let z = Int((surface.zoom / (doc.isNotebook ? surface.fit : 1) * 100).rounded())
        let t = "\(z)%"
        if t != model.zoomText { model.zoomText = t }
        if let tv = textView, let e = textElement { placeTextView(tv, e) }
        if model.menuAt != nil { model.menuAt = nil }
        scheduleSave(view: true)
    }

    // MARK: - tools

    func applyTool() {
        let t = model.tool
        let c = surface.canvas
        c.drawingPolicy = model.fingerDraws ? .anyInput : .pencilOnly
        c.isRulerActive = model.ruler
        switch t.kind {
        case .pen, .highlighter:
            let type = InkConvert.inkType(t.kind == .highlighter ? "marker" : t.ink)
            let alpha = t.kind == .highlighter ? min(0.6, t.opacity) : t.opacity
            let r = type.validWidthRange
            c.tool = PKInkingTool(type, color: t.uiColor.withAlphaComponent(alpha), width: min(max(t.size * (t.kind == .highlighter ? 1 : 1.15), r.lowerBound), r.upperBound))
            c.drawingGestureRecognizer.isEnabled = true
        case .eraser:
            c.tool = t.eraseWhole ? PKEraserTool(.vector) : PKEraserTool(.bitmap, width: t.size)
            c.drawingGestureRecognizer.isEnabled = true
        case .lasso, .text, .laser:
            c.drawingGestureRecognizer.isEnabled = false     // the editor handles the Pencil itself
        }
        c.panGestureRecognizer.allowedTouchTypes = [NSNumber(value: UITouch.TouchType.direct.rawValue)]
        if t.kind != .lasso && t.kind != .text { endSelection() }
    }

    // MARK: - gestures

    private func installGestures() {
        let pencil = PencilTracker(target: nil, action: nil)
        pencil.delegate = self
        pencil.onTouch = { [weak self] phase, touch, event in self?.pencilTouch(phase, touch, event) }
        surface.addGestureRecognizer(pencil)

        let dbl = UITapGestureRecognizer(target: self, action: #selector(doubleTapped(_:)))
        dbl.numberOfTapsRequired = 2
        dbl.allowedTouchTypes = [NSNumber(value: UITouch.TouchType.direct.rawValue)]
        dbl.delegate = self
        surface.addGestureRecognizer(dbl)

        let hold = UILongPressGestureRecognizer(target: self, action: #selector(held(_:)))
        hold.minimumPressDuration = 0.5
        hold.allowableMovement = 10
        hold.allowedTouchTypes = [NSNumber(value: UITouch.TouchType.direct.rawValue)]
        hold.delegate = self
        surface.addGestureRecognizer(hold)

        let tap = UITapGestureRecognizer(target: self, action: #selector(tapped(_:)))
        tap.allowedTouchTypes = [NSNumber(value: UITouch.TouchType.direct.rawValue)]
        tap.delegate = self
        tap.require(toFail: dbl)
        tap.require(toFail: hold)
        surface.addGestureRecognizer(tap)

        var fingers: [UITapGestureRecognizer] = []
        for n in [2, 3] {
            let t = UITapGestureRecognizer(target: self, action: #selector(fingerTapped(_:)))
            t.numberOfTouchesRequired = n
            t.delegate = self
            surface.addGestureRecognizer(t)
            fingers.append(t)
        }
        fingers[0].require(toFail: fingers[1])

        // the selection: drag to move, corners to scale, the knob to rotate; two fingers pinch and turn it
        let pan = UIPanGestureRecognizer(target: self, action: #selector(selectionPan(_:)))
        pan.maximumNumberOfTouches = 1
        surface.overlay.addGestureRecognizer(pan)
        let pinch = UIPinchGestureRecognizer(target: self, action: #selector(selectionPinch(_:)))
        let rot = UIRotationGestureRecognizer(target: self, action: #selector(selectionRotate(_:)))
        pinch.delegate = self; rot.delegate = self
        surface.overlay.addGestureRecognizer(pinch)
        surface.overlay.addGestureRecognizer(rot)
        let selTap = UITapGestureRecognizer(target: self, action: #selector(selectionTapped(_:)))
        surface.overlay.addGestureRecognizer(selTap)

        let pi = UIPencilInteraction()
        pi.delegate = self
        view.addInteraction(pi)
    }

    func gestureRecognizer(_ g: UIGestureRecognizer, shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer) -> Bool {
        if g is PencilTracker { return true }
        if g is UILongPressGestureRecognizer { return other === surface.canvas.panGestureRecognizer }
        if g is UIPinchGestureRecognizer || g is UIRotationGestureRecognizer { return other is UIPinchGestureRecognizer || other is UIRotationGestureRecognizer }
        return false
    }
    func gestureRecognizer(_ g: UIGestureRecognizer, shouldReceive touch: UITouch) -> Bool {
        if textView != nil, g is UILongPressGestureRecognizer { return false }
        return true
    }

    @objc private func doubleTapped(_ g: UITapGestureRecognizer) {
        let p = g.location(in: surface)
        if let e = elementAt(surface.toWorld(p)), e.kind == .text { beginTextEdit(e); return }
        surface.toggleZoom(at: p)
    }

    @objc private func fingerTapped(_ g: UITapGestureRecognizer) {
        if surface.canvas.isZooming || surface.canvas.isDragging { return }
        if g.numberOfTouchesRequired == 2, (Library.shared.settings["twoFingerUndo"] as? Bool) ?? true { performUndo(); AppState.shared.say("Undo", 0.7) }
        if g.numberOfTouchesRequired == 3, (Library.shared.settings["threeFingerRedo"] as? Bool) ?? true { performRedo(); AppState.shared.say("Redo", 0.7) }
    }

    /// a finger tap: select the picture or text box under it, otherwise let go of the selection and close menus
    @objc private func tapped(_ g: UITapGestureRecognizer) {
        model.menuAt = nil
        model.flyout = nil
        if textView != nil { endTextEdit(); return }
        let w = surface.toWorld(g.location(in: surface))
        if seekToStroke(at: w) { return }
        if model.tool.kind == .text { textTap(at: w); return }
        if let e = elementAt(w) { beginSelection(strokes: [], elements: [e]); return }
        endSelection()
    }

    /// press and hold with a finger: on ink or a picture it selects it (and the finger can drag it), on paper the menu opens on lift
    @objc private func held(_ g: UILongPressGestureRecognizer) {
        let p = g.location(in: surface), w = surface.toWorld(p)
        switch g.state {
        case .began:
            model.menuAt = nil
            holdStartScreen = p
            if let sel = selection, Geometry.pointInPolygon(p, sel.corners.map(surface.toScreen)) {
                startHoldDrag(w); return
            }
            if let e = elementAt(w) {
                beginSelection(strokes: [], elements: [e]); startHoldDrag(w)
            } else if let i = Geometry.strokeAt(w, drawing: surface.canvas.drawing, origin: surface.origin, tolerance: 12 / surface.zoom) {
                beginSelection(strokes: Geometry.wordAround(i, drawing: surface.canvas.drawing), elements: []); startHoldDrag(w)
            } else { holdDrag = false; endSelection() }
        case .changed:
            guard holdDrag, let sel = selection else { return }
            sel.T = dragT0.concatenating(CGAffineTransform(translationX: w.x - holdStartWorld.x, y: w.y - holdStartWorld.y))
            previewSelection()
        case .ended:
            if holdDrag { holdDrag = false; surface.canvas.isScrollEnabled = true; layoutOverlay(); return }
            if Geometry.dist(p, holdStartScreen) < 10 { openPageMenu(at: holdStartScreen) }
        default:
            holdDrag = false; surface.canvas.isScrollEnabled = true
        }
    }
    private func startHoldDrag(_ w: CGPoint) {
        guard let sel = selection else { return }
        holdDrag = true; holdStartWorld = w; dragT0 = sel.T
        surface.canvas.isScrollEnabled = false
        UIImpactFeedbackGenerator(style: .light).impactOccurred()
    }

    private func openPageMenu(at p: CGPoint) {
        model.menuHasPaste = Clipboard.hasContent
        model.menuHasImage = UIPasteboard.general.hasImages
        model.menuAt = p
        menuWorld = surface.toWorld(p)
    }
    private(set) var menuWorld: CGPoint = .zero

    // MARK: - Pencil

    private func pencilTouch(_ phase: PencilTracker.Phase, _ touch: UITouch, _ event: UIEvent) {
        let p = touch.location(in: surface), w = surface.toWorld(p)
        let tool = model.tool.kind
        switch phase {
        case .began:
            model.menuAt = nil; model.flyout = nil
            if textView != nil { endTextEdit() }
            // a touch on the selection belongs to the selection's own gestures
            if onSelection(p) { lassoPoints = []; return }
            if tool != .lasso || selection != nil { endSelection() }
            pencilStart = p
            lastMove = (p, touch.timestamp)
            strokePoints = [w]
            if tool == .lasso { lassoPoints = [w] }
            if tool == .laser { startLaser(); laserPoints.append((w, CACurrentMediaTime())) }
        case .moved:
            let samples = (event.coalescedTouches(for: touch) ?? [touch]).map { $0.location(in: surface) }
            for s in samples {
                let sw = surface.toWorld(s)
                strokePoints.append(sw)
                if hypot(s.x - lastMove.0.x, s.y - lastMove.0.y) > 3 { lastMove = (s, touch.timestamp) }
                if tool == .lasso, !lassoPoints.isEmpty { lassoPoints.append(sw) }
                if tool == .laser { laserPoints.append((sw, CACurrentMediaTime())) }
            }
            if tool == .lasso { drawLasso() }
        case .ended:
            if tool == .lasso, !lassoPoints.isEmpty { finishLasso(tapAt: hypot(p.x - pencilStart.x, p.y - pencilStart.y) < 8 ? w : nil) }
            if tool == .text, hypot(p.x - pencilStart.x, p.y - pencilStart.y) < 10 { textTap(at: w) }
            if (tool == .pen || tool == .highlighter), model.shapes, touch.timestamp - lastMove.1 > 0.55, strokePoints.count > 6 {
                let pts = strokePoints
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.08) { [weak self] in self?.shapeLastStroke(pts) }
            }
            strokePoints = []
        case .cancelled:
            lassoPoints = []; surface.overlay.lasso.path = nil; strokePoints = []
        }
    }

    private func drawLasso() {
        let path = UIBezierPath()
        for (i, w) in lassoPoints.enumerated() { let s = surface.toScreen(w); i == 0 ? path.move(to: s) : path.addLine(to: s) }
        surface.overlay.lasso.path = path.cgPath
    }
    private func finishLasso(tapAt: CGPoint?) {
        surface.overlay.lasso.path = nil
        defer { lassoPoints = [] }
        if let w = tapAt {
            if let e = elementAt(w) { beginSelection(strokes: [], elements: [e]) }
            else if let i = Geometry.strokeAt(w, drawing: surface.canvas.drawing, origin: surface.origin, tolerance: 10 / surface.zoom) { beginSelection(strokes: [i], elements: []) }
            else { endSelection() }
            return
        }
        guard lassoPoints.count > 4 else { return }
        let strokes = Geometry.strokesInside(lassoPoints, drawing: surface.canvas.drawing, origin: surface.origin)
        let els = doc.elements.filter { e in e.corners.allSatisfy { Geometry.pointInPolygon($0, lassoPoints) } }
        beginSelection(strokes: strokes, elements: els)
    }

    /// draw and hold: the stroke just written becomes a clean shape
    private func shapeLastStroke(_ pts: [CGPoint]) {
        guard let last = surface.canvas.drawing.strokes.last, Date().timeIntervalSince(last.path.creationDate) < 5 else { return }
        let o = surface.origin
        let world = last.path.interpolatedPoints(by: .distance(2)).map { $0.location.applying(last.transform) }.map { CGPoint(x: $0.x - o.x, y: $0.y - o.y) }
        let xs = world.map(\.x), ys = world.map(\.y)
        guard let x0 = xs.min(), let x1 = xs.max(), let y0 = ys.min(), let y1 = ys.max() else { return }
        let z = surface.zoom
        if ShapeRecognizer.length(world) * z < 70 || hypot(x1 - x0, y1 - y0) * z < 45 { return }   // handwriting-sized
        guard let shape = ShapeRecognizer.recognize(world) else { return }
        let before = snapshot()
        let sizes = last.path.map { $0.size.width }
        let size = sizes.isEmpty ? 3 : sizes.reduce(0, +) / CGFloat(sizes.count)
        var ctrl: [CGPoint] = []
        for (k, c) in shape.points.enumerated() {
            let q = CGPoint(x: c.x + o.x, y: c.y + o.y)
            if shape.sharp, k > 0, k < shape.points.count - 1 {
                let a = shape.points[k - 1], b = shape.points[k + 1]
                if ShapeRecognizer.angle(a, c, b) < 2.6 { ctrl.append(q); ctrl.append(q) }
            }
            ctrl.append(q)
        }
        let points = ctrl.enumerated().map { PKStrokePoint(location: $1, timeOffset: TimeInterval($0) * 0.004, size: CGSize(width: size, height: size), opacity: 1, force: 0.6, azimuth: 0, altitude: .pi / 2) }
        var strokes = surface.canvas.drawing.strokes
        strokes.removeLast()
        strokes.append(PKStroke(ink: last.ink, path: PKStrokePath(controlPoints: points, creationDate: last.path.creationDate)))
        setDrawing(PKDrawing(strokes: strokes))
        commit(from: before, name: "Shape")
        UISelectionFeedbackGenerator().selectionChanged()
    }

    // MARK: laser

    private func startLaser() {
        guard laserLink == nil else { return }
        let l = CADisplayLink(target: self, selector: #selector(laserTick))
        l.add(to: .main, forMode: .common)
        laserLink = l
    }
    @objc private func laserTick() {
        let now = CACurrentMediaTime()
        laserPoints.removeAll { now - $0.1 > 1.4 }
        let color = model.tool.uiColor
        let path = UIBezierPath(), core = UIBezierPath()
        var prev: CGPoint?
        for (w, t) in laserPoints {
            let s = surface.toScreen(w)
            if let a = prev, now - t < 1.5 { path.move(to: a); path.addLine(to: s); core.move(to: a); core.addLine(to: s) }
            prev = s
        }
        surface.overlay.laser.strokeColor = color.withAlphaComponent(0.35).cgColor
        surface.overlay.laser.lineWidth = 9
        surface.overlay.laser.path = path.cgPath
        surface.overlay.laserCore.lineWidth = 3.2
        surface.overlay.laserCore.path = core.cgPath
        if laserPoints.isEmpty { laserLink?.invalidate(); laserLink = nil; surface.overlay.laser.path = nil; surface.overlay.laserCore.path = nil }
    }

    // MARK: - Apple Pencil double-tap (and squeeze): follows the iPad setting unless Axiom's own is chosen

    func pencilInteraction(_ interaction: UIPencilInteraction, didReceiveTap tap: UIPencilInteraction.Tap) { pencilDoubleTap() }
    func pencilInteractionDidTap(_ interaction: UIPencilInteraction) { pencilDoubleTap() }
    private func pencilDoubleTap() {
        var action = Library.shared.settings.str("pencilTap") ?? "system"
        if action == "system" {
            switch UIPencilInteraction.preferredTapAction {
            case .ignore: return
            case .switchPrevious: action = "switchPrevious"
            case .showColorPalette, .showInkAttributes: action = "showColorPalette"
            default: action = "switchEraser"
            }
        }
        switch action {
        case "undo": performUndo()
        case "switchPrevious": model.select(model.previous); applyTool()
        case "showColorPalette": model.flyout = model.active
        default:
            if model.tool.kind == .eraser { model.select(model.previous) }
            else if let e = model.slots.firstIndex(where: { $0.kind == .eraser }) { model.select(e) }
            applyTool()
            AppState.shared.say(model.tool.kind == .eraser ? "Eraser" : "Pen", 0.8)
        }
    }

    // MARK: - selection

    func elementAt(_ w: CGPoint) -> Element? { doc.elements.last { $0.contains(w) } }

    func beginSelection(strokes: [Int], elements: [Element]) {
        endSelection()
        guard !strokes.isEmpty || !elements.isEmpty else { return }
        let drawing = surface.canvas.drawing
        let picked = strokes.filter { drawing.strokes.indices.contains($0) }.map { ($0, drawing.strokes[$0]) }
        let sel = Selection(strokes: picked, elements: elements, drawing: drawing, origin: surface.origin)
        selection = sel
        if !picked.isEmpty { setDrawing(sel.drawingWithout()) }
        renderLifted()
        layoutOverlay()
        UISelectionFeedbackGenerator().selectionChanged()
    }

    /// put the selection back (one undo step when it was moved)
    func endSelection() {
        guard let sel = selection else { return }
        selection = nil
        if sel.moved {
            let before = EditorState(drawing: sel.baseDrawing, elements: sel.elementsBefore.isEmpty ? doc.elements.map(\.json) : elementsJSON(replacing: sel.elementsBefore), pages: doc.pages.map(\.json), setup: setupJSON())
            for e in sel.elements { e.m = e.m.concatenating(sel.T); surface.refreshElement(e) }
            setDrawing(sel.drawingWith(origin: surface.origin))
            commit(from: before, name: "Move")
        } else if !sel.strokes.isEmpty {
            setDrawing(sel.baseDrawing)
        }
        clearOverlay()
    }
    /// the elements as they were before the selection changed them
    private func elementsJSON(replacing before: [JSON]) -> [JSON] {
        let map = Dictionary(uniqueKeysWithValues: before.compactMap { j in j.str("id").map { ($0, j) } })
        return doc.elements.map { map[$0.id] ?? $0.json }
    }

    private func clearOverlay() {
        let o = surface.overlay
        o.lifted.image = nil; o.lifted.isHidden = true
        o.box.path = nil; o.handles.path = nil; o.hitPolygon = []; o.hitCircles = []
        model.selection = nil
    }

    /// the lifted ink as a picture at the current zoom (re-rendered after zooming)
    func renderLifted() {
        guard let sel = selection, !sel.strokes.isEmpty else { surface.overlay.lifted.isHidden = true; return }
        let o = surface.origin
        let d = PKDrawing(strokes: sel.strokes)
        let b = d.bounds
        let scale = min(4, surface.zoom * (view.window?.screen.scale ?? 2))
        let img = d.image(from: b, scale: scale)
        let lv = surface.overlay.lifted
        lv.image = img
        lv.isHidden = false
        lv.transform = .identity
        lv.bounds = CGRect(origin: .zero, size: b.size)
        lv.layer.position = .zero
        lv.transform = CGAffineTransform(translationX: b.minX - o.x, y: b.minY - o.y).concatenating(sel.T)
    }

    /// overlay geometry follows the view and the selection's change
    private func layoutOverlay() {
        let o = surface.overlay
        let z = surface.zoom, off = surface.canvas.contentOffset, org = surface.origin
        o.world.transform = .identity
        o.world.layer.position = .zero
        o.world.transform = CGAffineTransform(a: z, b: 0, c: 0, d: z, tx: org.x * z - off.x, ty: org.y * z - off.y)
        if let tv = textView, let e = textElement { placeTextView(tv, e) }
        guard let sel = selection else { return }
        if !sel.strokes.isEmpty, let b = Optional(PKDrawing(strokes: sel.strokes).bounds) {
            o.lifted.transform = CGAffineTransform(translationX: b.minX - org.x, y: b.minY - org.y).concatenating(sel.T)
        }
        let cs = sel.corners.map(surface.toScreen)
        let box = UIBezierPath(); box.move(to: cs[0]); cs.dropFirst().forEach { box.addLine(to: $0) }; box.close()
        o.box.path = box.cgPath
        let hp = UIBezierPath()
        for c in cs { hp.append(UIBezierPath(arcCenter: c, radius: 7, startAngle: 0, endAngle: .pi * 2, clockwise: true)) }
        let knob = rotateKnob(cs)
        hp.move(to: knob.1); hp.append(UIBezierPath(arcCenter: knob.0, radius: 7, startAngle: 0, endAngle: .pi * 2, clockwise: true))
        o.handles.path = hp.cgPath
        let stem = UIBezierPath(); stem.move(to: knob.1); stem.addLine(to: CGPoint(x: knob.0.x, y: knob.0.y + 7 * (knob.0.y < knob.1.y ? 1 : -1)))
        box.append(stem); o.box.path = box.cgPath
        o.hitPolygon = selectionHitPolygon(sel)
        o.hitCircles = [(knob.0, 24)]
        let xs = cs.map(\.x), ys = cs.map(\.y)
        let frame = CGRect(x: xs.min()!, y: ys.min()!, width: xs.max()! - xs.min()!, height: ys.max()! - ys.min()!)
        let info = SelectionInfo(frame: frame, strokes: sel.strokes.count, images: sel.elements.filter { $0.kind == .image }.count, texts: sel.elements.filter { $0.kind == .text }.count)
        if model.selection != info { model.selection = info }
    }
    /// the knob above the top edge (or below when the top is under the bars), and the point it hangs from
    private func rotateKnob(_ cs: [CGPoint]) -> (CGPoint, CGPoint) {
        let top = CGPoint(x: (cs[0].x + cs[1].x) / 2, y: (cs[0].y + cs[1].y) / 2)
        let c = CGPoint(x: (cs[0].x + cs[2].x) / 2, y: (cs[0].y + cs[2].y) / 2)
        var dx = top.x - c.x, dy = top.y - c.y, L = max(1, hypot(dx, dy))
        var k = CGPoint(x: top.x + dx / L * 30, y: top.y + dy / L * 30)
        if k.y < 80 {
            let bottom = CGPoint(x: (cs[2].x + cs[3].x) / 2, y: (cs[2].y + cs[3].y) / 2)
            dx = bottom.x - c.x; dy = bottom.y - c.y; L = max(1, hypot(dx, dy))
            k = CGPoint(x: bottom.x + dx / L * 30, y: bottom.y + dy / L * 30)
            return (k, bottom)
        }
        return (k, top)
    }
    /// the box grown by 22 points so the corner handles are easy to catch (the knob is a circle of its own)
    private func selectionHitPolygon(_ sel: Selection) -> [CGPoint] {
        let cs = sel.corners.map(surface.toScreen)
        let c = CGPoint(x: (cs[0].x + cs[2].x) / 2, y: (cs[0].y + cs[2].y) / 2)
        return cs.map { p -> CGPoint in let dx = p.x - c.x, dy = p.y - c.y, L = max(1, hypot(dx, dy)); return CGPoint(x: p.x + dx / L * 22, y: p.y + dy / L * 22) }
    }
    private func onSelection(_ p: CGPoint) -> Bool {
        guard let sel = selection else { return false }
        return Geometry.pointInPolygon(p, selectionHitPolygon(sel)) || Geometry.dist(p, rotateKnob(sel.corners.map(surface.toScreen)).0) < 24
    }

    private func previewSelection() {
        guard let sel = selection else { return }
        let org = surface.origin
        for e in sel.elements {
            if let v = surface.elementViews[e.id] { v.transform = e.m.concatenating(sel.T).concatenating(CGAffineTransform(translationX: org.x, y: org.y)) }
        }
        layoutOverlay()
        if model.selection != nil { model.selection?.frame = .zero }   // hide the bar while dragging
    }

    @objc private func selectionPan(_ g: UIPanGestureRecognizer) {
        guard let sel = selection else { return }
        let p = g.location(in: surface), w = surface.toWorld(p)
        switch g.state {
        case .began:
            let start = surface.toWorld(CGPoint(x: p.x - g.translation(in: surface).x, y: p.y - g.translation(in: surface).y))
            let ss = surface.toScreen(start)
            let cs = sel.corners.map(surface.toScreen)
            dragStartWorld = start; dragT0 = sel.T
            if Geometry.dist(ss, rotateKnob(cs).0) < 26 { drag = .rotate }
            else if let i = cs.firstIndex(where: { Geometry.dist(ss, $0) < 26 }) { drag = .scale(sel.corners[(i + 2) % 4]) }
            else { drag = .move }
        case .changed:
            switch drag {
            case .move: sel.T = dragT0.concatenating(CGAffineTransform(translationX: w.x - dragStartWorld.x, y: w.y - dragStartWorld.y))
            case .scale(let pivot):
                let d0 = max(1, Geometry.dist(dragStartWorld, pivot)), d1 = max(d0 * 0.05, Geometry.dist(w, pivot))
                sel.T = dragT0.concatenating(.about(CGAffineTransform(scaleX: d1 / d0, y: d1 / d0), pivot))
            case .rotate:
                let c = CGPoint(x: sel.bounds.midX, y: sel.bounds.midY).applying(dragT0)
                var a = atan2(w.y - c.y, w.x - c.x) - atan2(dragStartWorld.y - c.y, dragStartWorld.x - c.x)
                let snap = (a / (.pi / 12)).rounded() * (.pi / 12)
                if abs(a - snap) < 2.5 * .pi / 180 { a = snap }
                sel.T = dragT0.concatenating(.about(CGAffineTransform(rotationAngle: a), c))
            case nil: break
            }
            previewSelection()
        default:
            drag = nil
            renderLifted(); layoutOverlay()
        }
    }
    private var pinchT0: CGAffineTransform = .identity
    @objc private func selectionPinch(_ g: UIPinchGestureRecognizer) {
        guard let sel = selection else { return }
        if g.state == .began { pinchT0 = sel.T }
        if g.state == .changed { sel.T = pinchT0.concatenating(.about(CGAffineTransform(scaleX: g.scale, y: g.scale), sel.center)); previewSelection() }
        if g.state == .ended || g.state == .cancelled { renderLifted(); layoutOverlay() }
    }
    @objc private func selectionRotate(_ g: UIRotationGestureRecognizer) {
        guard let sel = selection else { return }
        if g.state == .began { pinchT0 = sel.T }
        if g.state == .changed { sel.T = pinchT0.concatenating(.about(CGAffineTransform(rotationAngle: g.rotation), sel.center)); previewSelection() }
        if g.state == .ended || g.state == .cancelled { renderLifted(); layoutOverlay() }
    }
    @objc private func selectionTapped(_ g: UITapGestureRecognizer) {
        if let sel = selection, sel.elements.count == 1, sel.strokes.isEmpty, sel.elements[0].kind == .text, model.tool.kind == .text { let e = sel.elements[0]; endSelection(); beginTextEdit(e) }
    }

    // MARK: selection commands

    func deleteSelection() {
        guard let sel = selection else { return }
        selection = nil
        let before = EditorState(drawing: sel.baseDrawing, elements: doc.elements.map(\.json), pages: doc.pages.map(\.json), setup: setupJSON())
        let gone = Set(sel.elements.map(\.id))
        doc.elements.removeAll { gone.contains($0.id) }
        gone.forEach { surface.removeElementView($0) }
        // the ink is already out of the drawing
        commit(from: before, name: "Delete")
        clearOverlay()
    }
    func duplicateSelection() {
        guard let sel = selection else { return }
        let offset = CGAffineTransform(translationX: 20 / surface.zoom, y: 20 / surface.zoom)
        let o = surface.origin
        let d = CGAffineTransform(translationX: -o.x, y: -o.y).concatenating(sel.T).concatenating(offset).concatenating(CGAffineTransform(translationX: o.x, y: o.y))
        let copies = sel.strokes.map { PKStroke(ink: $0.ink, path: $0.path, transform: $0.transform.concatenating(d), mask: $0.mask) }
        let els = sel.elements.map { e -> Element in let c = e.copy(); c.m = e.m.concatenating(sel.T).concatenating(offset); return c }
        endSelection()
        let before = snapshot()
        let base = surface.canvas.drawing
        let start = base.strokes.count
        setDrawing(PKDrawing(strokes: base.strokes + copies))
        for e in els { doc.elements.append(e); surface.addElementView(e) }
        commit(from: before, name: "Duplicate")
        beginSelection(strokes: Array(start..<(start + copies.count)), elements: els)
    }
    func copySelection(cut: Bool = false) {
        guard let sel = selection else { return }
        let o = surface.origin
        let d = CGAffineTransform(translationX: -o.x, y: -o.y).concatenating(sel.T).concatenating(CGAffineTransform(translationX: o.x, y: o.y))
        let strokes = sel.strokes.map { PKStroke(ink: $0.ink, path: $0.path, transform: $0.transform.concatenating(d).concatenating(CGAffineTransform(translationX: -o.x, y: -o.y)), mask: $0.mask) }
        let els = sel.elements.map { e -> JSON in let c = e.copy(newID: false); c.m = e.m.concatenating(sel.T); return c.json }
        Clipboard.put(strokes: strokes, elements: els, image: selectionImage())
        if cut { deleteSelection() } else { AppState.shared.say("Copied", 0.8) }
    }
    func paste(at world: CGPoint? = nil) {
        guard let clip = Clipboard.read() else {
            if let img = UIPasteboard.general.image { insertImage(img, at: world) }
            return
        }
        endSelection()
        let o = surface.origin
        var bb = CGRect.null
        for s in clip.strokes { bb = bb.union(s.renderBounds) }
        let els = clip.elements.compactMap(Element.init).map { $0.copy() }
        for e in els { bb = bb.union(e.bounds) }
        guard !bb.isNull else { return }
        let target = world ?? CGPoint(x: surface.visibleWorld.midX, y: surface.visibleWorld.midY)
        let shift = world != nil || !surface.visibleWorld.intersects(bb) ? CGAffineTransform(translationX: target.x - bb.midX, y: target.y - bb.midY) : CGAffineTransform(translationX: 24 / surface.zoom, y: 24 / surface.zoom)
        let d = shift.concatenating(CGAffineTransform(translationX: o.x, y: o.y))
        let strokes = clip.strokes.map { PKStroke(ink: $0.ink, path: $0.path, transform: $0.transform.concatenating(d), mask: $0.mask) }
        for e in els { e.m = e.m.concatenating(shift) }
        let before = snapshot()
        let base = surface.canvas.drawing, start = base.strokes.count
        setDrawing(PKDrawing(strokes: base.strokes + strokes))
        for e in els { doc.elements.append(e); surface.addElementView(e) }
        commit(from: before, name: "Paste")
        beginSelection(strokes: Array(start..<(start + strokes.count)), elements: els)
    }
    func recolorSelection(_ hex: String) {
        guard let sel = selection else { return }
        let c = UIColor(css: hex)
        sel.strokes = sel.strokes.map { s in PKStroke(ink: PKInk(s.ink.inkType, color: c.withAlphaComponent(s.ink.color.cgColor.alpha)), path: s.path, transform: s.transform, mask: s.mask) }
        for e in sel.elements where e.kind == .text { e.color = hex; surface.refreshElement(e) }
        sel.T = sel.T.concatenating(.identity)
        // a colour change counts as a change even without moving
        let before = EditorState(drawing: sel.baseDrawing, elements: elementsJSON(replacing: sel.elementsBefore), pages: doc.pages.map(\.json), setup: setupJSON())
        let after = sel.drawingWith(origin: surface.origin)
        let strokesIdx = sel.strokeIndices, els = sel.elements
        selection = nil
        clearOverlay()
        setDrawing(after)
        commit(from: before, name: "Colour")
        beginSelection(strokes: strokesIdx, elements: els)
    }
    func flipSelection(horizontal: Bool) {
        guard let sel = selection else { return }
        sel.T = sel.T.concatenating(.about(CGAffineTransform(scaleX: horizontal ? -1 : 1, y: horizontal ? 1 : -1), sel.center))
        previewSelection(); renderLifted()
    }
    func arrangeSelection(front: Bool) {
        guard let sel = selection, !sel.elements.isEmpty else { return }
        let before = snapshot()
        let ids = Set(sel.elements.map(\.id))
        let picked = doc.elements.filter { ids.contains($0.id) }, rest = doc.elements.filter { !ids.contains($0.id) }
        doc.elements = front ? rest + picked : picked + rest
        surface.rebuildElements()
        commit(from: before, name: front ? "Bring to front" : "Send to back")
    }
    /// the selection as a picture (for sharing and the system clipboard)
    func selectionImage() -> UIImage? {
        guard let sel = selection else { return nil }
        let b = sel.bounds.applying(sel.T).insetBy(dx: -8, dy: -8)
        let scale: CGFloat = 2
        let r = UIGraphicsImageRenderer(size: CGSize(width: b.width * scale, height: b.height * scale))
        let o = surface.origin
        return r.image { ctx in
            let cg = ctx.cgContext
            cg.scaleBy(x: scale, y: scale); cg.translateBy(x: -b.minX, y: -b.minY)
            for e in sel.elements { draw(e, in: cg, extra: sel.T) }
            if !sel.strokes.isEmpty {
                let d = PKDrawing(strokes: sel.strokes).transformed(using: CGAffineTransform(translationX: -o.x, y: -o.y).concatenating(sel.T))
                let img = d.image(from: d.bounds, scale: scale)
                img.draw(in: d.bounds)
            }
        }
    }
    var selectedImageElement: Element? { selection.flatMap { $0.strokes.isEmpty && $0.elements.count == 1 && $0.elements[0].kind == .image ? $0.elements[0] : nil } }

    // MARK: - text boxes

    private func textTap(at w: CGPoint) {
        if let e = elementAt(w), e.kind == .text { beginTextEdit(e); return }
        endSelection()
        let t = model.tool
        var width = min(420, max(220, surface.bounds.width * 0.4 / surface.zoom))
        var x = w.x
        if doc.isNotebook {
            let r = doc.pageRect(doc.pageIndex(at: w))
            x = min(max(x, r.minX + 8), r.maxX - 60); width = min(width, r.maxX - 12 - x)
        }
        let e = Element.textBox(at: CGPoint(x: x, y: w.y - t.size * 0.8), width: width, size: t.size, color: t.color, font: t.font)
        let before = snapshot()
        doc.elements.append(e)
        surface.addElementView(e)
        textBefore = before
        beginTextEdit(e, isNew: true)
    }
    func insertStickyNote() {
        let r = doc.isNotebook ? doc.pageRect(surface.currentPage) : surface.visibleWorld
        let c = CGPoint(x: surface.visibleWorld.midX, y: max(r.minY + 40, surface.visibleWorld.midY))
        let e = Element.textBox(at: CGPoint(x: c.x - 110, y: c.y - 40), width: 220, size: 18, color: "#2a2620")
        e.bg = "#fff1a8"
        let before = snapshot()
        doc.elements.append(e); surface.addElementView(e)
        textBefore = before
        beginTextEdit(e, isNew: true)
    }

    func beginTextEdit(_ e: Element, isNew: Bool = false) {
        endSelection()
        if textView != nil { endTextEdit() }
        if !isNew { textBefore = snapshot() }
        let tv = UITextView()
        tv.backgroundColor = .clear
        tv.delegate = self
        tv.isScrollEnabled = false
        tv.textContainer.lineFragmentPadding = 0
        tv.text = e.text
        tv.autocorrectionType = .default
        textView = tv; textElement = e
        surface.elementViews[e.id]?.isHidden = true
        surface.addSubview(tv)
        styleTextView(tv, e)
        placeTextView(tv, e)
        tv.becomeFirstResponder()
        model.editingText = true
    }
    func styleTextView(_ tv: UITextView, _ e: Element) {
        let z = surface.zoom
        let font = e.uiFont.withSize(e.fontSize * z)
        let pad = (e.bg != nil ? max(10, e.fontSize * 0.6) : 2) * z
        tv.font = font
        tv.textColor = e.bg != nil ? UIColor(css: "#2a2620") : UIColor(css: e.color)
        tv.typingAttributes = [.font: font, .foregroundColor: tv.textColor!, .paragraphStyle: Element.para(e.fontSize * z)]
        tv.attributedText = NSAttributedString(string: tv.text, attributes: tv.typingAttributes)
        tv.textContainerInset = UIEdgeInsets(top: pad, left: pad, bottom: pad, right: pad)
        tv.backgroundColor = e.bg.map { UIColor(css: $0) } ?? UIColor.systemBlue.withAlphaComponent(0.05)
        tv.layer.cornerRadius = 6
        tv.layer.borderWidth = e.bg == nil ? 1 : 0
        tv.layer.borderColor = UIColor.systemBlue.withAlphaComponent(0.5).cgColor
    }
    private func placeTextView(_ tv: UITextView, _ e: Element) {
        let o = surface.toScreen(CGPoint(x: 0, y: 0).applying(e.m))
        let z = surface.zoom * hypot(e.m.a, e.m.b)
        let w = e.iw * z
        let h = max(tv.sizeThatFits(CGSize(width: w, height: .greatestFiniteMagnitude)).height, e.fontSize * 1.36 * z + 8)
        tv.frame = CGRect(x: o.x, y: o.y, width: w, height: h)
    }
    func textViewDidChange(_ textView: UITextView) {
        guard let e = textElement else { return }
        e.text = textView.text
        e.fitTextHeight()
        placeTextView(textView, e)
    }
    func changeText(_ change: (Element) -> Void) {
        guard let e = textElement, let tv = textView else { return }
        change(e)
        e.fitTextHeight()
        styleTextView(tv, e)
        placeTextView(tv, e)
    }
    @objc func endTextEdit() {
        guard let tv = textView, let e = textElement else { return }
        textView = nil; textElement = nil
        tv.resignFirstResponder()
        tv.removeFromSuperview()
        model.editingText = false
        e.text = tv.text.trimmingCharacters(in: .newlines)
        if e.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            doc.elements.removeAll { $0.id == e.id }
            surface.removeElementView(e.id)
        } else {
            e.fitTextHeight()
            surface.elementViews[e.id]?.isHidden = false
            surface.refreshElement(e)
        }
        if let before = textBefore { commit(from: before, name: "Text") }
        textBefore = nil
    }
    func deleteEditingText() { textView?.text = ""; endTextEdit() }
    func beginTextEditNew(_ e: Element, before: EditorState) { textBefore = before; beginTextEdit(e, isNew: true) }

    // MARK: - pictures

    func insertImage(_ img: UIImage, at world: CGPoint? = nil) {
        endSelection()
        let maxSide: CGFloat = 2400
        var image = img
        if max(img.size.width, img.size.height) * img.scale > maxSide {
            let k = maxSide / (max(img.size.width, img.size.height) * img.scale)
            let size = CGSize(width: img.size.width * img.scale * k, height: img.size.height * img.scale * k)
            image = UIGraphicsImageRenderer(size: size, format: { let f = UIGraphicsImageRendererFormat(); f.scale = 1; return f }()).image { _ in img.draw(in: CGRect(origin: .zero, size: size)) }
        }
        let hasAlpha = image.cgImage.map { [.first, .last, .premultipliedFirst, .premultipliedLast].contains($0.alphaInfo) } ?? false
        guard let data = hasAlpha ? image.pngData() : image.jpegData(compressionQuality: 0.86) else { return }
        let src = data.dataURL(mime: hasAlpha ? "image/png" : "image/jpeg")
        let px = CGSize(width: image.size.width * image.scale, height: image.size.height * image.scale)
        var width: CGFloat, origin: CGPoint
        if doc.isNotebook {
            let r = doc.pageRect(world.map { doc.pageIndex(at: $0) } ?? surface.currentPage)
            width = min(px.width / 2, r.width * 0.7)
            let h = px.height * width / px.width
            let c = world ?? CGPoint(x: r.midX, y: min(max(surface.visibleWorld.midY, r.minY + h / 2 + 20), r.maxY - h / 2 - 20))
            origin = CGPoint(x: min(max(c.x - width / 2, r.minX + 10), r.maxX - width - 10), y: c.y - h / 2)
        } else {
            width = min(px.width / 2, surface.bounds.width * 0.5 / surface.zoom)
            let c = world ?? CGPoint(x: surface.visibleWorld.midX, y: surface.visibleWorld.midY)
            origin = CGPoint(x: c.x - width / 2, y: c.y - px.height * width / px.width / 2)
        }
        let e = Element.image(src: src, size: px, at: origin, width: width)
        e.setImage(image, src: src)
        let before = snapshot()
        doc.elements.append(e)
        surface.addElementView(e)
        commit(from: before, name: "Picture")
        beginSelection(strokes: [], elements: [e])
    }
    func applyCrop(_ e: Element, rect: CGRect) {
        let before = snapshot()
        let base = e.cropBase ?? CGSize(width: e.iw, height: e.ih)
        // the uncropped placement, then the new crop
        let oldOrigin = e.crop?.origin ?? .zero
        let fullM = e.m.translatedBy(x: -oldOrigin.x, y: -oldOrigin.y)
        let full = CGRect(origin: .zero, size: base)
        if rect.insetBy(dx: 0.5, dy: 0.5).contains(full) || rect == full {
            e.crop = nil; e.cropBase = nil; e.iw = base.width; e.ih = base.height; e.m = fullM
        } else {
            e.crop = rect; e.cropBase = base; e.iw = rect.width; e.ih = rect.height; e.m = fullM.translatedBy(x: rect.minX, y: rect.minY)
        }
        surface.refreshElement(e)
        commit(from: before, name: "Crop")
        beginSelection(strokes: [], elements: [e])
    }

    /// PDF pages become pages of the notebook (each a picture on its own page), or pictures on a canvas
    func insertPDF(_ url: URL) {
        let ok = url.startAccessingSecurityScopedResource()
        defer { if ok { url.stopAccessingSecurityScopedResource() } }
        guard let pdf = CGPDFDocument(url as CFURL), pdf.numberOfPages > 0 else { AppState.shared.say("That PDF could not be opened"); return }
        let before = snapshot()
        let count = min(pdf.numberOfPages, 60)
        var at = doc.isNotebook ? surface.currentPage + 1 : 0
        for n in 1...count {
            guard let page = pdf.page(at: n) else { continue }
            let box = page.getBoxRect(.mediaBox)
            let scale = min(2.5, 1800 / max(box.width, 1))
            let size = CGSize(width: box.width * scale, height: box.height * scale)
            let img = UIGraphicsImageRenderer(size: size, format: { let f = UIGraphicsImageRendererFormat(); f.scale = 1; return f }()).image { ctx in
                UIColor.white.setFill(); ctx.fill(CGRect(origin: .zero, size: size))
                let cg = ctx.cgContext
                cg.translateBy(x: 0, y: size.height); cg.scaleBy(x: scale, y: -scale)
                cg.drawPDFPage(page)
            }
            guard let data = img.jpegData(compressionQuality: 0.85) else { continue }
            let src = data.dataURL(mime: "image/jpeg")
            if doc.isNotebook {
                insertPageRaw(at: at, template: "blank")
                let r = doc.pageRect(at)
                let w = r.width, h = size.height * w / size.width
                let fit = h > r.height ? r.height / h : 1
                let e = Element.image(src: src, size: size, at: CGPoint(x: r.minX + (r.width - w * fit) / 2, y: r.minY + (r.height - h * fit) / 2), width: w * fit)
                e.setImage(img, src: src)
                doc.elements.append(e)
                at += 1
            } else {
                let v = surface.visibleWorld
                let w = min(600, size.width / 2)
                let e = Element.image(src: src, size: size, at: CGPoint(x: v.midX - w / 2 + CGFloat(n - 1) * (w + 40), y: v.midY - size.height * w / size.width / 2), width: w)
                e.setImage(img, src: src)
                doc.elements.append(e)
            }
        }
        surface.rebuildPages()
        surface.rebuildElements()
        model.pageCount = doc.pages.count
        commit(from: before, name: "Insert PDF")
        if doc.isNotebook { surface.scrollTo(page: surface.currentPage + 1) }
    }

    // MARK: - pages

    private func shift(page from: Int, by delta: Int, step: CGFloat) -> CGAffineTransform { CGAffineTransform(translationX: 0, y: CGFloat(delta) * step) }
    /// move the ink and pictures of pages as pages are inserted, removed or moved (fn: old index → new index, nil = removed)
    private func remap(_ fn: (Int) -> Int?) {
        let step = doc.pageSize.height + NoteDocument.pageGap
        let o = surface.origin
        var strokes: [PKStroke] = []
        for s in surface.canvas.drawing.strokes {
            let b = s.renderBounds
            let p = doc.pageIndex(at: CGPoint(x: b.midX - o.x, y: b.midY - o.y))
            guard let q = fn(p) else { continue }
            strokes.append(q == p ? s : PKStroke(ink: s.ink, path: s.path, transform: s.transform.concatenating(CGAffineTransform(translationX: 0, y: CGFloat(q - p) * step)), mask: s.mask))
        }
        var els: [Element] = []
        for e in doc.elements {
            let b = e.bounds
            let p = doc.pageIndex(at: CGPoint(x: b.midX, y: b.midY))
            guard let q = fn(p) else { continue }
            if q != p { e.m = e.m.concatenating(CGAffineTransform(translationX: 0, y: CGFloat(q - p) * step)) }
            els.append(e)
        }
        doc.elements = els
        setDrawing(PKDrawing(strokes: strokes))
    }
    private func insertPageRaw(at i: Int, template: String? = nil) {
        remap { $0 >= i ? $0 + 1 : $0 }
        let cur = doc.pages.indices.contains(max(0, i - 1)) ? doc.pages[max(0, i - 1)] : nil
        doc.pages.insert(PageInfo(template: template ?? cur?.template, color: cur?.color), at: min(i, doc.pages.count))
    }
    func insertPage(at i: Int) { endSelection(); let b = snapshot(); insertPageRaw(at: i); pagesChanged(); commit(from: b, name: "New page") }
    func deletePage(_ i: Int) {
        endSelection(); let b = snapshot()
        if doc.pages.count == 1 { remap { _ in nil } } else { remap { $0 == i ? nil : ($0 > i ? $0 - 1 : $0) }; doc.pages.remove(at: i) }
        pagesChanged(); commit(from: b, name: "Delete page")
    }
    func duplicatePage(_ i: Int) {
        endSelection(); let b = snapshot()
        remap { $0 > i ? $0 + 1 : $0 }
        let step = doc.pageSize.height + NoteDocument.pageGap, o = surface.origin
        let copies = surface.canvas.drawing.strokes.filter { s in let r = s.renderBounds; return doc.pageIndex(at: CGPoint(x: r.midX - o.x, y: r.midY - o.y)) == i }
            .map { PKStroke(ink: $0.ink, path: $0.path, transform: $0.transform.concatenating(CGAffineTransform(translationX: 0, y: step)), mask: $0.mask) }
        setDrawing(PKDrawing(strokes: surface.canvas.drawing.strokes + copies))
        let els = doc.elements.filter { let r = $0.bounds; return doc.pageIndex(at: CGPoint(x: r.midX, y: r.midY)) == i }.map { e -> Element in let c = e.copy(); c.m = e.m.concatenating(CGAffineTransform(translationX: 0, y: step)); return c }
        doc.elements += els
        var p = doc.pages[i]; p.id = UID.make(); p.bookmark = false
        doc.pages.insert(p, at: i + 1)
        pagesChanged(); commit(from: b, name: "Duplicate page")
    }
    func movePage(_ from: Int, to: Int) {
        guard from != to, doc.pages.indices.contains(from), doc.pages.indices.contains(to) else { return }
        endSelection(); let b = snapshot()
        remap { p in p == from ? to : (from < to && p > from && p <= to ? p - 1 : (from > to && p >= to && p < from ? p + 1 : p)) }
        let pg = doc.pages.remove(at: from); doc.pages.insert(pg, at: to)
        pagesChanged(); commit(from: b, name: "Move page")
    }
    func toggleBookmark(_ i: Int) { let b = snapshot(); doc.pages[i].bookmark.toggle(); pagesChanged(); commit(from: b, name: "Bookmark") }
    func setPaper(template: String?, color: String?, pageOnly: Int?) {
        let b = snapshot()
        if let i = pageOnly {
            if let template { doc.pages[i].template = template }
            if let color { doc.pages[i].color = color }
        } else {
            if let template { doc.template = template }
            if let color { doc.pageColor = color }
            for i in doc.pages.indices { doc.pages[i].template = nil; doc.pages[i].color = nil }
        }
        surface.redrawPages()
        surface.applyInkAppearance()
        surface.superview?.backgroundColor = surface.deskColor
        commit(from: b, name: "Paper")
    }
    func setCanvasPaper(color: String?, grid: String?) {
        let b = snapshot()
        if let color { doc.paperColor = color }
        if let grid { doc.gridType = grid }
        surface.redrawPages()
        surface.applyInkAppearance()
        view.backgroundColor = UIColor(css: doc.paperColor)
        commit(from: b, name: "Paper")
    }
    private func pagesChanged() {
        surface.rebuildPages()
        surface.rebuildElements()
        model.pageCount = doc.pages.count
    }
    /// one empty page always waits at the end
    private func ensureTrailingPage() {
        guard doc.isNotebook, let last = doc.pages.indices.last else { return }
        let r = doc.pageRect(last), o = surface.origin
        let used = surface.canvas.drawing.strokes.contains { r.intersects($0.renderBounds.offsetBy(dx: -o.x, dy: -o.y)) } || doc.elements.contains { r.intersects($0.bounds) }
        if used { doc.pages.append(PageInfo(template: doc.pages[last].template, color: doc.pages[last].color)); surface.rebuildPages(); model.pageCount = doc.pages.count }
    }

    // MARK: - undo

    func snapshot() -> EditorState {
        EditorState(drawing: surface.canvas.drawing, elements: doc.elements.map(\.json), pages: doc.pages.map(\.json), setup: setupJSON())
    }
    private func setupJSON() -> JSON { ["template": doc.template, "color": doc.pageColor, "paper": doc.paperColor, "grid": doc.gridType] }

    /// register the change from `before` to now as one undo step
    func commit(from before: EditorState, name: String) {
        let after = snapshot()
        undo.registerUndo(withTarget: self) { $0.swap(to: before, redo: after, name: name) }
        undo.setActionName(name)
        changed()
    }
    private func swap(to s: EditorState, redo r: EditorState, name: String) {
        if textView != nil { endTextEdit() }
        if let sel = selection { selection = nil; clearOverlay(); if !sel.strokes.isEmpty && !sel.moved { /* already in s */ } }
        restore(s)
        undo.registerUndo(withTarget: self) { $0.swap(to: r, redo: s, name: name) }
        undo.setActionName(name)
        changed()
    }
    private func restore(_ s: EditorState) {
        setDrawing(s.drawing)
        let old = Dictionary(uniqueKeysWithValues: doc.elements.map { ($0.id, $0) })
        doc.elements = s.elements.compactMap { j -> Element? in
            guard let e = Element(j) else { return nil }
            if let prev = old[e.id], let img = prev.loadImage(), prev.src == e.src { e.setImage(img, src: e.src ?? "") }
            return e
        }
        let pagesChangedCount = s.pages.count != doc.pages.count || s.pages.map { $0.str("id") ?? "" } != doc.pages.map(\.id)
        doc.pages = s.pages.map(PageInfo.init)
        if let t = s.setup.str("template") { doc.template = t }
        if let c = s.setup.str("color") { doc.pageColor = c }
        if let p = s.setup.str("paper") { doc.paperColor = p }
        if let g = s.setup.str("grid") { doc.gridType = g }
        if pagesChangedCount { surface.rebuildPages() } else { surface.redrawPages() }
        surface.rebuildElements()
        model.pageCount = doc.pages.count
    }
    func performUndo() {
        endReplay()
        if textView != nil { endTextEdit() }
        endSelection()
        if undo.canUndo { undo.undo() }
        syncUndo()
    }
    func performRedo() {
        endReplay()
        if textView != nil { endTextEdit() }
        endSelection()
        if undo.canRedo { undo.redo() }
        syncUndo()
    }
    private func syncUndo() {
        if model.canUndo != undo.canUndo { model.canUndo = undo.canUndo }
        if model.canRedo != undo.canRedo { model.canRedo = undo.canRedo }
    }

    /// set the drawing without PencilKit treating it as the user's edit
    private func setDrawing(_ d: PKDrawing) {
        applying = true
        surface.canvas.drawing = PKDrawing()   // iPadOS can skip redrawing strokes it thinks it has drawn: start blank
        surface.canvas.drawing = d
        applying = false
    }

    // MARK: - PencilKit

    func canvasViewDidBeginUsingTool(_ canvasView: PKCanvasView) {
        inkBefore = canvasView.drawing
        inkChanged = false
        model.menuAt = nil
    }
    func canvasViewDrawingDidChange(_ canvasView: PKCanvasView) {
        guard !applying else { return }
        inkChanged = true
        if inkBefore == nil {
            // a change without a tool (should not happen): still undoable
            commitInkSoon()
        }
    }
    func canvasViewDidEndUsingTool(_ canvasView: PKCanvasView) {
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) { [weak self] in self?.commitInkSoon() }
    }
    private func commitInkSoon() {
        guard inkChanged else { inkBefore = nil; return }
        let before = EditorState(drawing: inkBefore ?? PKDrawing(), elements: doc.elements.map(\.json), pages: doc.pages.map(\.json), setup: setupJSON())
        inkBefore = nil; inkChanged = false
        commit(from: before, name: model.tool.kind == .eraser ? "Erase" : "Ink")
        ensureTrailingPage()
    }

    // MARK: - saving

    private func changed() {
        dirty = true
        if Date().timeIntervalSince(lastVersion) > 600 { DispatchQueue.main.asyncAfter(deadline: .now() + 5) { [weak self] in if let s = self, Date().timeIntervalSince(s.lastVersion) > 600 { s.snapshotVersion() } } }
        syncUndo()
        scheduleSave()
    }
    private var viewOnly = false
    func scheduleSave(view: Bool = false) {
        if view && !dirty { viewOnly = true }
        saveWork?.cancel()
        let w = DispatchWorkItem { [weak self] in self?.save() }
        saveWork = w
        DispatchQueue.main.asyncAfter(deadline: .now() + (view ? 1.5 : 1.2), execute: w)
    }
    @objc func flush() {
        if textView != nil { endTextEdit() }
        saveWork?.cancel()
        save()
    }
    func save() {
        let fullDrawing = self.fullDrawing
        if dirty { Store.shared.saveFile(doc.inkFileID, fullDrawing.dataRepresentation()) }
        guard dirty || viewOnly else { return }
        let json = doc.json(viewState: surface.viewState)
        let thumb = dirty ? Thumbnail.render(doc: doc, drawing: fullDrawing)?.jpegData(compressionQuality: 0.78)?.dataURL(mime: "image/jpeg") : nil
        Library.shared.save(doc: json, thumb: thumb)
        dirty = false; viewOnly = false
    }

    /// draw a picture or text box into a context (thumbnails, exports, the clipboard picture)
    func draw(_ e: Element, in cg: CGContext, extra: CGAffineTransform = .identity) { Thumbnail.draw(e, in: cg, extra: extra) }
}

/// Copy and paste inside Axiom (ink keeps being ink), and a picture for other apps.
enum Clipboard {
    static let type = "com.mohmadkarim.axiom.clip"
    struct Clip { let strokes: [PKStroke]; let elements: [JSON] }
    static func put(strokes: [PKStroke], elements: [JSON], image: UIImage?) {
        var item: [String: Any] = [:]
        let payload: JSON = ["ink": PKDrawing(strokes: strokes).dataRepresentation().base64EncodedString(), "elements": elements]
        if let d = JSONIO.data(payload) { item[type] = d }
        if let image, let png = image.pngData() { item["public.png"] = png }
        UIPasteboard.general.setItems([item])
    }
    static var hasContent: Bool { UIPasteboard.general.contains(pasteboardTypes: [type]) }
    static func read() -> Clip? {
        guard let d = UIPasteboard.general.data(forPasteboardType: type), let j = JSONIO.object(d) else { return nil }
        let ink = j.str("ink").flatMap { Data(base64Encoded: $0) }.flatMap { try? PKDrawing(data: $0) }
        return Clip(strokes: ink?.strokes ?? [], elements: j.arr("elements"))
    }
}
