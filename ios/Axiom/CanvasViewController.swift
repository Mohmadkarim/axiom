import UIKit
import WebKit

/// Hosts the Axiom web app full screen and bridges what the web can't reach:
/// full-rate Apple Pencil samples, Pencil double-tap / squeeze, file storage and the share sheet.
final class CanvasViewController: UIViewController, WKScriptMessageHandlerWithReply, WKNavigationDelegate, UIPencilInteractionDelegate {
    private var webView: WKWebView!
    private let store = DrawingStore()

    // MARK: - Setup

    override func loadView() {
        let content = WKUserContentController()
        content.addScriptMessageHandler(self, contentWorld: .page, name: "axiom")
        let settings = store.loadSettings() ?? "null"
        let boot = "window.AXIOM_NATIVE = { pen: true, platform: 'ios' }; window.AXIOM_SETTINGS = \(settings);"
        content.addUserScript(WKUserScript(source: boot, injectionTime: .atDocumentStart, forMainFrameOnly: true))

        let config = WKWebViewConfiguration()
        config.userContentController = content
        config.allowsInlineMediaPlayback = true

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
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        guard let url = Bundle.main.url(forResource: "index", withExtension: "html", subdirectory: "web") else { return }
        webView.loadFileURL(url, allowingReadAccessTo: url.deletingLastPathComponent())
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        setNeedsUpdateOfScreenEdgesDeferringSystemGestures()
        setNeedsUpdateOfHomeIndicatorAutoHidden()
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
