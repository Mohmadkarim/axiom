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
    private let planner = PlannerBridge()
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
        let boot = "window.AXIOM_NATIVE = { pen: true, platform: 'ios', audio: true, planner: true, orientationLock: \(locked != nil) }; window.AXIOM_SETTINGS = \(settings);"
        content.addUserScript(WKUserScript(source: boot, injectionTime: .atDocumentStart, forMainFrameOnly: true))

        let config = WKWebViewConfiguration()
        config.userContentController = content
        config.allowsInlineMediaPlayback = true
        if let web = Bundle.main.url(forResource: "web", withExtension: nil) {
            let handler = AppSchemeHandler(root: web, store: store)
            config.setURLSchemeHandler(handler, forURLScheme: AppSchemeHandler.scheme)
            schemeHandler = handler
        }

        webView = WKWebView(frame: .zero, configuration: config)
        webView.navigationDelegate = self
        webView.isOpaque = false
        webView.backgroundColor = UIColor(red: 0.07, green: 0.075, blue: 0.09, alpha: 1)
        webView.scrollView.isScrollEnabled = false
        webView.scrollView.bounces = false
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.allowsLinkPreview = false
        if #available(iOS 16.4, *) { webView.isInspectable = true }

        let pencil = UIPencilInteraction()
        pencil.delegate = self
        webView.addInteraction(pencil)

        let capture = PencilCaptureRecognizer()
        capture.onSamples = { [weak self] phase, samples, predicted in
            self?.runJS("window.__axiomPen && __axiomPen('\(phase)', \(samples), \(predicted))")
        }
        webView.addGestureRecognizer(capture)

        view = webView
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
        case "calStatus":
            replyHandler(planner.hasCalendarAccess, nil); return
        case "calAccess":
            planner.requestCalendar { replyHandler($0, nil) }; return
        case "calCalendars":
            replyHandler(planner.calendars(), nil); return
        case "calEvents":
            replyHandler(planner.events(from: body["from"], to: body["to"], hidden: body["hidden"] as? [String] ?? []), nil); return
        case "calMirror":
            replyHandler(planner.mirror(items: body["items"] as? [[String: Any]] ?? [], from: body["from"], to: body["to"]), nil); return
        case "notifSync":
            planner.syncReminders(body["list"] as? [[String: Any]] ?? []) { replyHandler($0, nil) }; return
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

/// Watches Apple Pencil touches on the web view without consuming them and forwards every
/// coalesced (up to 240 Hz) and predicted sample to the page.
final class PencilCaptureRecognizer: UIGestureRecognizer, UIGestureRecognizerDelegate {
    var onSamples: ((String, String, String) -> Void)?
    private weak var tracked: UITouch?

    init() {
        super.init(target: nil, action: nil)
        allowedTouchTypes = [NSNumber(value: UITouch.TouchType.pencil.rawValue)]
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
        onSamples?(phase, encode(coalesced.isEmpty ? [touch] : coalesced), encode(predicted))
    }

    override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent) {
        guard tracked == nil, let t = touches.first(where: { $0.type == .pencil }) else { return }
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
