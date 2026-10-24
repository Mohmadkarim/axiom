#if DEBUG
import Foundation
import WebKit

/// Development only: lets tools on the Mac run JavaScript inside the simulator's web view.
/// Polls http://127.0.0.1:8799/cmd (served by tools/simjs.py); results are posted back to /result.
final class DebugBridge {
    private weak var webView: WKWebView?
    private var timer: Timer?
    private var busy = false
    private let base = URL(string: "http://127.0.0.1:8799")!

    init(webView: WKWebView) {
        self.webView = webView
        timer = Timer.scheduledTimer(withTimeInterval: 0.4, repeats: true) { [weak self] _ in self?.poll() }
    }

    private func poll() {
        guard !busy else { return }
        busy = true
        URLSession.shared.dataTask(with: base.appendingPathComponent("cmd")) { data, resp, _ in
            guard let data, let code = String(data: data, encoding: .utf8), !code.isEmpty,
                  (resp as? HTTPURLResponse)?.statusCode == 200 else { self.busy = false; return }
            DispatchQueue.main.async { self.run(code) }
        }.resume()
    }

    private func run(_ code: String) {
        guard let webView else { busy = false; return }
        let body = "try { const __r = await (async () => { \(code) })(); return JSON.stringify(__r === undefined ? null : __r); } catch (e) { return JSON.stringify({ error: String(e && e.stack || e) }); }"
        webView.callAsyncJavaScript(body, arguments: [:], in: nil, in: .page) { result in
            var out = ""
            switch result {
            case .success(let v): out = (v as? String) ?? "null"
            case .failure(let e): out = "{\"error\":\"\(e.localizedDescription.replacingOccurrences(of: "\"", with: "'"))\"}"
            }
            var req = URLRequest(url: self.base.appendingPathComponent("result"))
            req.httpMethod = "POST"
            req.httpBody = out.data(using: .utf8)
            URLSession.shared.dataTask(with: req) { _, _, _ in self.busy = false }.resume()
        }
    }
}
#endif
