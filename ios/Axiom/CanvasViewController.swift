import UIKit
import WebKit

/// Hosts the Axiom web app full screen and bridges what the web can't reach:
/// full-rate Apple Pencil samples, Pencil double-tap / squeeze, file storage and the share sheet.
final class CanvasViewController: UIViewController, WKScriptMessageHandlerWithReply, WKNavigationDelegate, UIPencilInteractionDelegate {
    private var webView: WKWebView!
    private let store = DrawingStore()
    private var schemeHandler: AppSchemeHandler?
    #if DEBUG
    private var debugBridge: DebugBridge?
    #endif
    private var notebook: NotebookInkView?
    private var passthroughWeb: PassthroughWebView? { webView as? PassthroughWebView }
    private lazy var audio: AudioBridge = {
        let a = AudioBridge(filesDir: { [store] in store.filesDir })
        a.onTick = { [weak self] json in self?.runJS("window.__axiomAudio && __axiomAudio(\(json))") }
        return a
    }()
    /// nil = follow the device; otherwise the orientations Axiom is locked to
    private var orientationLock: UIInterfaceOrientationMask?

    // MARK: - Setup

    override func loadView() {
        let content = WKUserContentController()
        content.addScriptMessageHandler(self, contentWorld: .page, name: "axiom")
        let settings = store.loadSettings() ?? "null"
        let locked = UserDefaults.standard.object(forKey: "orientationLock") as? Int
        if let m = locked { orientationLock = UIInterfaceOrientationMask(rawValue: UInt(m)) }
        let boot = "window.AXIOM_NATIVE = { pen: true, platform: 'ios', audio: true, pencilkit: true, orientationLock: \(locked != nil) }; window.AXIOM_SETTINGS = \(settings);"
        content.addUserScript(WKUserScript(source: boot, injectionTime: .atDocumentStart, forMainFrameOnly: true))

        let config = WKWebViewConfiguration()
        config.userContentController = content
        config.allowsInlineMediaPlayback = true
        if let web = Bundle.main.url(forResource: "web", withExtension: nil) {
            let handler = AppSchemeHandler(root: web, store: store)
            config.setURLSchemeHandler(handler, forURLScheme: AppSchemeHandler.scheme)
            schemeHandler = handler
        }

        webView = PassthroughWebView(frame: .zero, configuration: config)
        webView.navigationDelegate = self
        webView.isOpaque = false
        webView.backgroundColor = .clear              // the root view paints the desk; notebooks show through
        webView.scrollView.backgroundColor = .clear
        webView.scrollView.isScrollEnabled = false
        webView.scrollView.bounces = false
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.allowsLinkPreview = false
        if #available(iOS 16.4, *) { webView.isInspectable = true }

        let pencil = UIPencilInteraction()
        pencil.delegate = self
        webView.addInteraction(pencil)

        let capture = PencilCaptureRecognizer()
        capture.onTouches = { [weak self] phase, coalesced, _ in self?.notebook?.trackPencil(phase, coalesced) }
        capture.onSamples = { [weak self] phase, samples, predicted in
            self?.runJS("window.__axiomPen && __axiomPen('\(phase)', \(samples), \(predicted))")
        }

        // notebooks draw with PencilKit underneath a transparent web view
        let root = UIView()
        root.backgroundColor = UIColor(red: 0.07, green: 0.075, blue: 0.09, alpha: 1)
        let nb = NotebookInkView(frame: .zero)
        nb.save = { [weak self] id, data in try? self?.store.writeFile(id: id, data: data) }
        nb.load = { [weak self] id in self.flatMap { try? Data(contentsOf: $0.store.fileURL(id)) } }
        nb.onView = { [weak self] z, tx, ty, r in self?.runJS("window.__axiomPK && __axiomPK('view', {zoom: \(z), tx: \(tx), ty: \(ty), rot: \(r)})") }
        nb.onNeedPage = { [weak self] i, sc in self?.runJS("window.__axiomPK && __axiomPK('needPage', {i: \(i), scale: \(sc)})") }
        nb.onNeedBg = { [weak self] r, sc in self?.runJS("window.__axiomPK && __axiomPK('needBg', {x: \(r.minX), y: \(r.minY), w: \(r.width), h: \(r.height), scale: \(sc)})") }
        nb.onStrokes = { [weak self] json in self?.runJS("window.__axiomPK && __axiomPK('strokes', \(json))") }
        nb.onRecognize = { [weak self] json in self?.runJS("window.__axiomPK && __axiomPK('recognize', \(json))") }
        nb.onChanged = { [weak self] in self?.runJS("window.__axiomPK && __axiomPK('changed', null)") }
        notebook = nb
        webView.frame = root.bounds
        webView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        root.addSubview(nb)
        root.addSubview(webView)
        root.addGestureRecognizer(capture)
        NotificationCenter.default.addObserver(forName: UIApplication.willResignActiveNotification, object: nil, queue: .main) { [weak self] _ in self?.notebook?.flush() }

        view = root
        #if DEBUG
        debugBridge = DebugBridge(webView: webView)
        #endif
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        if schemeHandler != nil {
            webView.load(URLRequest(url: AppSchemeHandler.startURL))
        } else if let url = Bundle.main.url(forResource: "index", withExtension: "html", subdirectory: "web") {
            webView.loadFileURL(url, allowingReadAccessTo: url.deletingLastPathComponent())
        }
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        setNeedsUpdateOfScreenEdgesDeferringSystemGestures()
        setNeedsUpdateOfHomeIndicatorAutoHidden()
    }

    override var supportedInterfaceOrientations: UIInterfaceOrientationMask { orientationLock ?? .all }

    private func setOrientationLock(_ on: Bool) {
        if on, let scene = view.window?.windowScene {
            switch scene.interfaceOrientation {
            case .portrait: orientationLock = .portrait
            case .portraitUpsideDown: orientationLock = .portraitUpsideDown
            case .landscapeLeft: orientationLock = .landscapeLeft
            case .landscapeRight: orientationLock = .landscapeRight
            default: orientationLock = .all
            }
            UserDefaults.standard.set(Int(orientationLock!.rawValue), forKey: "orientationLock")
        } else {
            orientationLock = nil
            UserDefaults.standard.removeObject(forKey: "orientationLock")
        }
        setNeedsUpdateOfSupportedInterfaceOrientations()
        if let scene = view.window?.windowScene {
            scene.requestGeometryUpdate(.iOS(interfaceOrientations: orientationLock ?? .all)) { _ in }
        }
    }

    override var prefersStatusBarHidden: Bool { true }
    override var prefersHomeIndicatorAutoHidden: Bool { true }
    override var preferredScreenEdgesDeferringSystemGestures: UIRectEdge { .all }
    // keep iPadOS three-finger undo/redo gestures from fighting Axiom's own taps
    override var editingInteractionConfiguration: UIEditingInteractionConfiguration { .none }

    func runJS(_ js: String) {
        webView?.evaluateJavaScript(js, completionHandler: nil)
    }

    // MARK: - Apple Pencil double-tap and squeeze

    private func tapActionName() -> String {
        switch UIPencilInteraction.preferredTapAction {
        case .switchEraser: return "switchEraser"
        case .switchPrevious: return "switchPrevious"
        case .showColorPalette: return "showColorPalette"
        case .showInkAttributes: return "showInkAttributes"
        case .ignore: return "ignore"
        default: return "switchEraser"
        }
    }

    func pencilInteractionDidTap(_ interaction: UIPencilInteraction) {
        runJS("window.A && A.emit('pencil:tap', '\(tapActionName())')")
    }

    @available(iOS 17.5, *)
    func pencilInteraction(_ interaction: UIPencilInteraction, didReceiveTap tap: UIPencilInteraction.Tap) {
        runJS("window.A && A.emit('pencil:tap', '\(tapActionName())')")
    }

    @available(iOS 17.5, *)
    func pencilInteraction(_ interaction: UIPencilInteraction, didReceiveSqueeze squeeze: UIPencilInteraction.Squeeze) {
        guard squeeze.phase == .ended else { return }
        if let pose = squeeze.hoverPose {
            let p = pose.location
            runJS("window.A && A.emit('pencil:squeeze', {x: \(p.x), y: \(p.y)})")
        } else {
            runJS("window.A && A.emit('pencil:squeeze', null)")
        }
    }

    // MARK: - Bridge (JS → native, with reply)

    func userContentController(_ userContentController: WKUserContentController,
                               didReceive message: WKScriptMessage,
                               replyHandler: @escaping @MainActor @Sendable (Any?, String?) -> Void) {
        guard let body = message.body as? [String: Any], let op = body["op"] as? String else {
            replyHandler(nil, "bad message"); return
        }
        if op == "share" {
            share(body)
            replyHandler(true, nil)
            return
        }
        switch op {
        case "orientation":
            setOrientationLock(body["lock"] as? Bool ?? false)
            replyHandler(orientationLock != nil, nil)
            return
        case "shareItems":
            shareItems(text: body["text"] as? String ?? "", images: body["images"] as? [String] ?? [])
            replyHandler(true, nil)
            return
        case "keepAwake":
            UIApplication.shared.isIdleTimerDisabled = body["on"] as? Bool ?? false
            replyHandler(true, nil)
            return
        case "pkOpen":
            guard let nb = notebook else { replyHandler(false, nil); return }
            let rects = (body["pages"] as? [[Double]] ?? []).map { CGRect(x: $0[0], y: $0[1], width: $0[2] - $0[0], height: $0[3] - $0[1]) }
            let f = body["frame"] as? [Double] ?? [0, 0, Double(view.bounds.width), Double(view.bounds.height)]
            nb.frame = CGRect(x: f[0], y: f[1], width: f[2], height: f[3])
            let ins = body["insets"] as? [Double] ?? [70, 16, 90, 66]
            nb.open(id: body["id"] as? String ?? "doc", rects: rects, zoom: CGFloat(body["zoom"] as? Double ?? 1), tx: CGFloat(body["tx"] as? Double ?? 0), ty: CGFloat(body["ty"] as? Double ?? 0),
                    legacy: body["legacy"] as? [[String: Any]] ?? [], dark: body["dark"] as? Bool ?? false, desk: Self.color(body["desk"] as? String ?? "#111317"),
                    insets: UIEdgeInsets(top: ins[0], left: ins[1], bottom: ins[2], right: ins[3]), canvas: body["canvas"] as? Bool ?? false, rot: CGFloat(body["rot"] as? Double ?? 0))
            passthroughWeb?.passthrough = true
            replyHandler(nb.currentView(), nil); return
        case "pkClose":
            notebook?.close(); passthroughWeb?.passthrough = false; view.backgroundColor = UIColor(red: 0.07, green: 0.075, blue: 0.09, alpha: 1)
            replyHandler(true, nil); return
        case "pkFrame":
            if let f = body["frame"] as? [Double] { notebook?.frame = CGRect(x: f[0], y: f[1], width: f[2], height: f[3]) }
            if let ins = body["insets"] as? [Double] { notebook?.setInsets(UIEdgeInsets(top: ins[0], left: ins[1], bottom: ins[2], right: ins[3])) }
            if let dark = body["dark"] as? Bool { notebook?.setAppearance(dark: dark, desk: Self.color(body["desk"] as? String ?? "#111317")) }
            replyHandler(true, nil); return
        case "pkPages":
            let rects = (body["pages"] as? [[Double]] ?? []).map { CGRect(x: $0[0], y: $0[1], width: $0[2] - $0[0], height: $0[3] - $0[1]) }
            notebook?.setPages(rects); replyHandler(true, nil); return
        case "pkPage":
            if let b64 = body["data"] as? String, let data = Data(base64Encoded: b64) { notebook?.setPageImage(body["i"] as? Int ?? 0, data: data, scale: CGFloat(body["scale"] as? Double ?? 1)) }
            replyHandler(true, nil); return
        case "pkBg":
            if let r = body["rect"] as? [Double], r.count == 4, let b64 = body["data"] as? String, let data = Data(base64Encoded: b64) {
                notebook?.setBg(CGRect(x: r[0], y: r[1], width: r[2], height: r[3]), data: data)
            }
            replyHandler(true, nil); return
        case "pkDirty":
            notebook?.markDirty(body["all"] as? Bool ?? true, body["pages"] as? [Int] ?? []); replyHandler(true, nil); return
        case "pkTool":
            notebook?.setTool(body)
            // text, laser, tape: the page handles the Pencil (and pans by finger through the native view's API)
            if notebook?.isOpen == true { passthroughWeb?.passthrough = (body["tool"] as? String ?? "none") != "none" }
            replyHandler(true, nil); return
        case "pkView":
            notebook?.setView(zoom: CGFloat(body["zoom"] as? Double ?? 1), tx: CGFloat(body["tx"] as? Double ?? 0), ty: CGFloat(body["ty"] as? Double ?? 0), rot: CGFloat(body["rot"] as? Double ?? 0)); replyHandler(true, nil); return
        case "pkChrome":
            passthroughWeb?.chrome = (body["rects"] as? [[Double]] ?? []).map { CGRect(x: $0[0], y: $0[1], width: $0[2], height: $0[3]) }
            replyHandler(true, nil); return
        case "pkMove":
            let moves = (body["moves"] as? [[String: Any]] ?? []).compactMap { m -> (CGRect, CGPoint)? in
                guard let f = m["from"] as? [Double], let t = m["to"] as? [Double], f.count == 4, t.count >= 2 else { return nil }
                return (CGRect(x: f[0], y: f[1], width: f[2] - f[0], height: f[3] - f[1]), CGPoint(x: t[0], y: t[1]))
            }
            notebook?.move(moves); replyHandler(true, nil); return
        case "pkCopy":
            if let f = body["from"] as? [Double], let t = body["to"] as? [Double], f.count == 4, t.count >= 2 {
                notebook?.copy(from: CGRect(x: f[0], y: f[1], width: f[2] - f[0], height: f[3] - f[1]), to: CGPoint(x: t[0], y: t[1]))
            }
            replyHandler(true, nil); return
        case "pkReplay":
            let ms = { (k: String) in Date(timeIntervalSince1970: (body[k] as? Double ?? 0) / 1000) }
            notebook?.replay(on: body["on"] as? Bool ?? false, start: ms("start"), end: ms("end"), t: body["t"] as? Double ?? 0)
            replyHandler(true, nil); return
        case "pkReplaceLast":
            notebook?.replaceLast(body["pts"] as? [Double] ?? [], sharp: body["sharp"] as? Bool ?? false); replyHandler(true, nil); return
        case "pkShapes":
            notebook?.shapesEnabled = body["on"] as? Bool ?? false
            notebook?.rotateEnabled = body["rotate"] as? Bool ?? false
            replyHandler(true, nil); return
        case "pkDebug":
            var d = notebook?.debugInfo() ?? [:]
            d["passthrough"] = passthroughWeb?.passthrough ?? false
            d["chrome"] = passthroughWeb?.chrome.count ?? 0
            d["hidden"] = notebook?.isHidden ?? true
            d["policy"] = notebook?.canvas.drawingPolicy == .anyInput ? "any" : "pencil"
            d["drawEnabled"] = notebook?.canvas.drawingGestureRecognizer.isEnabled ?? false
            d["strokes"] = notebook?.canvas.drawing.strokes.count ?? 0
            replyHandler(d, nil); return
        case "pkUndo":
            notebook?.undo(); replyHandler(true, nil); return
        case "pkRedo":
            notebook?.redo(); replyHandler(true, nil); return
        case "snapshot":
            // a picture of part of the page, including embedded sites (Desmos) that the page itself cannot read
            let cfg = WKSnapshotConfiguration()
            cfg.rect = CGRect(x: body["x"] as? Double ?? 0, y: body["y"] as? Double ?? 0,
                              width: body["w"] as? Double ?? 100, height: body["h"] as? Double ?? 100)
            cfg.afterScreenUpdates = true
            webView.takeSnapshot(with: cfg) { image, error in
                guard let image, let data = image.pngData() else {
                    replyHandler(nil, error?.localizedDescription ?? "Snapshot failed"); return
                }
                replyHandler(data.base64EncodedString(), nil)
            }
            return
        case "audioStart":
            audio.start(id: body["id"] as? String ?? "") { ok, err in replyHandler(ok, err) }
            return
        case "audioStop": replyHandler(audio.stop(), nil); return
        case "audioPlay":
            let err = audio.play(id: body["id"] as? String ?? "", at: body["at"] as? Double ?? 0)
            replyHandler(err == nil, err); return
        case "audioPause": audio.pause(); replyHandler(true, nil); return
        case "audioSeek": audio.seek(body["at"] as? Double ?? 0); replyHandler(true, nil); return
        case "audioRate": audio.setRate(Float(body["rate"] as? Double ?? 1)); replyHandler(true, nil); return
        case "audioDuration": replyHandler(audio.duration(id: body["id"] as? String ?? ""), nil); return
        case "audioDelete": audio.delete(id: body["id"] as? String ?? ""); replyHandler(true, nil); return
        default: break
        }
        let store = self.store
        DispatchQueue.global(qos: .userInitiated).async {
            let result: Any?
            var error: String?
            switch op {
            case "list": result = store.listMeta()
            case "load": result = store.loadDoc(body["id"] as? String ?? "")
            case "save":
                do {
                    try store.save(id: body["id"] as? String ?? "", doc: body["doc"] as? String ?? "", meta: body["meta"] as? String ?? "")
                    result = true
                } catch let e { result = nil; error = e.localizedDescription }
            case "saveMeta":
                do { try store.saveMeta(id: body["id"] as? String ?? "", meta: body["meta"] as? String ?? ""); result = true }
                catch let e { result = nil; error = e.localizedDescription }
            case "delete": store.delete(body["id"] as? String ?? ""); result = true
            case "fileSave":
                do { try store.saveFile(id: body["id"] as? String ?? "", base64: body["data"] as? String ?? ""); result = true }
                catch let e { result = nil; error = e.localizedDescription }
            case "fileLoad": result = store.loadFile(body["id"] as? String ?? "")
            case "fileDelete": store.deleteFile(body["id"] as? String ?? ""); result = true
            case "settings": store.saveSettings(body["json"] as? String ?? "{}"); result = true
            default: result = nil; error = "unknown op \(op)"
            }
            DispatchQueue.main.async { replyHandler(result ?? NSNull(), error) }
        }
    }

    /// Hands a question (text + page images) to another app such as Claude or ChatGPT through the share sheet.
    /// The text is also put on the clipboard, because some apps keep only the images from a share.
    private func shareItems(text: String, images: [String]) {
        var items: [Any] = []
        for b64 in images.prefix(10) {
            if let data = Data(base64Encoded: b64), let img = UIImage(data: data) { items.append(img) }
        }
        if !text.isEmpty {
            items.append(text)
            UIPasteboard.general.string = text
        }
        guard !items.isEmpty else { return }
        let sheet = UIActivityViewController(activityItems: items, applicationActivities: nil)
        if let pop = sheet.popoverPresentationController {
            pop.sourceView = view
            pop.sourceRect = CGRect(x: view.bounds.maxX - 200, y: view.bounds.maxY - 120, width: 1, height: 1)
            pop.permittedArrowDirections = [.down, .right]
        }
        present(sheet, animated: true)
    }

    private func share(_ body: [String: Any]) {
        guard let b64 = body["data"] as? String, let data = Data(base64Encoded: b64) else { return }
        let name = (body["name"] as? String ?? "Axiom export").replacingOccurrences(of: "/", with: "-")
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(name)
        try? data.write(to: url, options: .atomic)
        let sheet = UIActivityViewController(activityItems: [url], applicationActivities: nil)
        if let pop = sheet.popoverPresentationController {
            pop.sourceView = view
            pop.sourceRect = CGRect(x: view.bounds.maxX - 120, y: 60, width: 1, height: 1)
            pop.permittedArrowDirections = [.up]
        }
        present(sheet, animated: true)
    }
}

extension CanvasViewController {
    static func color(_ hex: String) -> UIColor {
        var h = hex.trimmingCharacters(in: .whitespaces); if h.hasPrefix("#") { h.removeFirst() }
        if h.count == 3 { h = h.map { "\($0)\($0)" }.joined() }
        guard h.count == 6, let v = UInt32(h, radix: 16) else { return .black }
        return UIColor(red: CGFloat((v >> 16) & 255) / 255, green: CGFloat((v >> 8) & 255) / 255, blue: CGFloat(v & 255) / 255, alpha: 1)
    }
}

/// Watches Apple Pencil touches on the web view without consuming them and forwards every
/// coalesced (up to 240 Hz) and predicted sample to the page.
final class PencilCaptureRecognizer: UIGestureRecognizer, UIGestureRecognizerDelegate {
    var onSamples: ((String, String, String) -> Void)?
    var onTouches: ((String, [UITouch], [UITouch]) -> Void)?
    static var fingerIsPencil = false
    private weak var tracked: UITouch?

    init() {
        super.init(target: nil, action: nil)
        allowedTouchTypes = [NSNumber(value: UITouch.TouchType.pencil.rawValue)]
        #if DEBUG
        // simulator testing: `defaults write com.mohmadkarim.axiom debugDirectInk -bool YES` lets a finger stand in for the Pencil
        if UserDefaults.standard.bool(forKey: "debugDirectInk") { allowedTouchTypes.append(NSNumber(value: UITouch.TouchType.direct.rawValue)); Self.fingerIsPencil = true }
        #endif
        cancelsTouchesInView = false
        delaysTouchesBegan = false
        delaysTouchesEnded = false
        delegate = self
    }

    func gestureRecognizer(_ g: UIGestureRecognizer, shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer) -> Bool { true }

    private func encode(_ touches: [UITouch]) -> String {
        guard let v = view else { return "[]" }
        var parts: [String] = []
        parts.reserveCapacity(touches.count)
        for t in touches {
            let p = t.preciseLocation(in: v)
            let force = t.maximumPossibleForce > 0 ? t.force / t.maximumPossibleForce : 0.5
            let az = t.azimuthAngle(in: v)
            parts.append(String(format: "[%.2f,%.2f,%.4f,%.4f,%.4f,%.2f]", p.x, p.y, force, t.altitudeAngle, az, t.timestamp * 1000))
        }
        return "[" + parts.joined(separator: ",") + "]"
    }

    private func send(_ phase: String, _ touch: UITouch, _ event: UIEvent) {
        let coalesced = event.coalescedTouches(for: touch) ?? [touch]
        let predicted = phase == "m" ? (event.predictedTouches(for: touch) ?? []) : []
        onTouches?(phase, coalesced.isEmpty ? [touch] : coalesced, predicted)
        onSamples?(phase, encode(coalesced.isEmpty ? [touch] : coalesced), encode(predicted))
    }

    override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent) {
        guard tracked == nil, let t = touches.first(where: { $0.type == .pencil || (Self.fingerIsPencil && $0.type == .direct) }) else { return }
        tracked = t
        send("b", t, event)
    }

    override func touchesMoved(_ touches: Set<UITouch>, with event: UIEvent) {
        guard let t = tracked, touches.contains(t) else { return }
        send("m", t, event)
    }

    override func touchesEnded(_ touches: Set<UITouch>, with event: UIEvent) {
        guard let t = tracked, touches.contains(t) else { return }
        send("e", t, event)
        tracked = nil
        state = .failed
    }

    override func touchesCancelled(_ touches: Set<UITouch>, with event: UIEvent) {
        guard let t = tracked, touches.contains(t) else { return }
        send("c", t, event)
        tracked = nil
        state = .failed
    }

    override func reset() {
        super.reset()
        tracked = nil
    }
}
