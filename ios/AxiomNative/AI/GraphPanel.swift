import SwiftUI
import WebKit

/// Desmos beside the page (an embedded website, never an overlay): graph, then put the graph on the page or ask about it.
struct GraphPanel: View {
    var width: CGFloat = 420
    @State private var kind = Library.shared.settings.str("graphKind") ?? "calculator"
    @State private var web = WKWebView()
    private let kinds: [(String, String)] = [("calculator", "Graph"), ("geometry", "Geometry"), ("3d", "3D"), ("scientific", "Scientific")]

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 8) {
                Menu {
                    Picker("", selection: $kind) { ForEach(kinds, id: \.0) { Text($0.1).tag($0.0) } }
                } label: {
                    HStack(spacing: 4) { Image(systemName: "function"); Text(kinds.first { $0.0 == kind }?.1 ?? "Graph"); Image(systemName: "chevron.down").font(.system(size: 10, weight: .semibold)) }
                        .font(Theme.ui(14, .semibold)).foregroundStyle(Theme.fg).padding(.horizontal, 10).frame(height: 32).background(Theme.panel2, in: Capsule())
                }
                Spacer()
                IconButton(symbol: "sparkles", label: "Ask the tutor about this graph", tint: Theme.accent, size: 36) { snapshot { img in
                    AppState.shared.graphOpen = false
                    Tutor.shared.ask("Explain this graph.", about: .notebook(docID: AppState.shared.editor?.doc.id ?? "graph", name: AppState.shared.editor?.doc.name ?? "Graph", images: [img], label: "Desmos graph"))
                } }
                Button { snapshot { img in AppState.shared.editor?.insertImage(img); AppState.shared.say("Graph added", 1.4) } } label: {
                    Label("Insert", systemImage: "photo.badge.plus").font(Theme.ui(13, .semibold)).foregroundStyle(.white).padding(.horizontal, 12).frame(height: 32).background(Theme.accent, in: Capsule())
                }.buttonStyle(.plain).disabled(AppState.shared.editor == nil)
                IconButton(symbol: "xmark", label: "Close", size: 34) { withAnimation(.snappy(duration: 0.22)) { AppState.shared.graphOpen = false } }
            }
            .padding(10).padding(.top, 6)
            DesmosWeb(web: web, kind: kind)
        }
        .frame(width: width)
        .background(Theme.panel)
        .overlay(alignment: .leading) { Rectangle().fill(Theme.line).frame(width: 0.5) }
        .onChange(of: kind) { _, k in Library.shared.set("graphKind", k) }
    }

    /// the graph as a picture, without Desmos' own title bar
    private func snapshot(_ done: @escaping (UIImage) -> Void) {
        // the graph paper only, from Desmos itself; otherwise a picture of the panel without its title bar
        let js = "(function(){try{var b=Calc.graphpaperBounds.pixelCoordinates;return Calc.screenshot({width:Math.round(b.width),height:Math.round(b.height),targetPixelRatio:2});}catch(e){return null}})()"
        web.evaluateJavaScript(js) { r, _ in
            if let s = r as? String, let img = UIImage.fromDataURL(s) { done(img); return }
            self.panelSnapshot(done)
        }
    }
    private func panelSnapshot(_ done: @escaping (UIImage) -> Void) {
        let cfg = WKSnapshotConfiguration()
        cfg.afterScreenUpdates = true
        web.takeSnapshot(with: cfg) { img, _ in
            guard let img else { AppState.shared.say("Couldn’t capture the graph"); return }
            done(GraphPanel.trimHeader(img))
        }
    }
    static func trimHeader(_ img: UIImage) -> UIImage {
        guard let cg = img.cgImage else { return img }
        let W = cg.width, H = cg.height
        guard let data = cg.dataProvider?.data, let bytes = CFDataGetBytePtr(data) else { return img }
        let bpr = cg.bytesPerRow, bpp = cg.bitsPerPixel / 8
        func px(_ x: Int, _ y: Int) -> (Int, Int, Int) { let i = y * bpr + x * bpp; return (Int(bytes[i]), Int(bytes[i + 1]), Int(bytes[i + 2])) }
        let ref = px(W / 2, Int(Double(H) * 0.85))
        func close(_ a: (Int, Int, Int)) -> Bool { abs(a.0 - ref.0) + abs(a.1 - ref.1) + abs(a.2 - ref.2) < 60 }
        var top = 0
        var y = 0
        while y < H / 4 {
            var n = 0, k = 0, x = Int(Double(W) * 0.3)
            while x < Int(Double(W) * 0.7) { k += 1; if close(px(x, y)) { n += 1 }; x += 6 }
            if Double(n) / Double(max(1, k)) > 0.85 { top = y; break }
            y += 2
        }
        guard top >= 8, let cut = cg.cropping(to: CGRect(x: 0, y: top, width: W, height: H - top)) else { return img }
        return UIImage(cgImage: cut, scale: img.scale, orientation: .up)
    }
}

struct DesmosWeb: UIViewRepresentable {
    let web: WKWebView
    let kind: String
    func makeUIView(context: Context) -> WKWebView {
        web.isOpaque = false
        web.load(URLRequest(url: URL(string: "https://www.desmos.com/\(kind)")!))
        context.coordinator.kind = kind
        return web
    }
    func updateUIView(_ v: WKWebView, context: Context) {
        if context.coordinator.kind != kind { context.coordinator.kind = kind; v.load(URLRequest(url: URL(string: "https://www.desmos.com/\(kind)")!)) }
    }
    func makeCoordinator() -> Coord { Coord() }
    final class Coord { var kind = "" }
}
