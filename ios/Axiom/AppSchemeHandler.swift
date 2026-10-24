import Foundation
import UniformTypeIdentifiers
import WebKit

/// Serves the app at axiom://app/ so the page has a real origin (workers, fetch, modules all behave as on the web),
/// and streams stored files as raw bytes at axiom://app/_files/<id> — a 60 MB textbook never becomes a base64 string.
final class AppSchemeHandler: NSObject, WKURLSchemeHandler {
    static let scheme = "axiom"
    static let startURL = URL(string: "axiom://app/index.html")!

    private let root: URL
    private let store: DrawingStore
    private var stopped = Set<ObjectIdentifier>()
    private let io = DispatchQueue(label: "axiom.scheme", qos: .userInitiated, attributes: .concurrent)

    init(root: URL, store: DrawingStore) {
        self.root = root.standardizedFileURL
        self.store = store
    }

    func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
        guard let url = task.request.url else { return }
        let request = task.request
        let key = ObjectIdentifier(task)
        io.async { [weak self] in
            guard let self else { return }
            let (status, type, body) = self.respond(url: url, request: request)
            DispatchQueue.main.async {
                guard !self.stopped.contains(key) else { self.stopped.remove(key); return }
                let headers = [
                    "Content-Type": type,
                    "Content-Length": String(body.count),
                    "Cache-Control": "no-store",
                    "Access-Control-Allow-Origin": "*",
                ]
                let response = HTTPURLResponse(url: url, statusCode: status, httpVersion: "HTTP/1.1", headerFields: headers)!
                task.didReceive(response)
                task.didReceive(body)
                task.didFinish()
            }
        }
    }

    func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {
        stopped.insert(ObjectIdentifier(task))
    }

    private func respond(url: URL, request: URLRequest) -> (Int, String, Data) {
        var path = url.path
        if path.isEmpty || path == "/" { path = "/index.html" }

        if path.hasPrefix("/_files/") {
            let id = String(path.dropFirst("/_files/".count))
            let method = request.httpMethod ?? "GET"
            if method == "POST" || method == "PUT" {
                guard let data = Self.body(of: request), !data.isEmpty else { return (400, "text/plain", Data("no body".utf8)) }
                do { try store.writeFile(id: id, data: data); return (200, "text/plain", Data("ok".utf8)) }
                catch { return (500, "text/plain", Data(error.localizedDescription.utf8)) }
            }
            guard let data = try? Data(contentsOf: store.fileURL(id), options: .mappedIfSafe) else {
                return (404, "text/plain", Data())
            }
            return (200, "application/octet-stream", data)
        }

        let file = root.appendingPathComponent(String(path.dropFirst())).standardizedFileURL
        guard file.path.hasPrefix(root.path + "/"), let data = try? Data(contentsOf: file, options: .mappedIfSafe) else {
            return (404, "text/plain", Data())
        }
        return (200, Self.mime(for: file), data)
    }

    private static func body(of request: URLRequest) -> Data? {
        if let data = request.httpBody { return data }
        guard let stream = request.httpBodyStream else { return nil }
        stream.open()
        defer { stream.close() }
        var data = Data()
        let size = 1 << 16
        let buffer = UnsafeMutablePointer<UInt8>.allocate(capacity: size)
        defer { buffer.deallocate() }
        while stream.hasBytesAvailable {
            let n = stream.read(buffer, maxLength: size)
            if n <= 0 { break }
            data.append(buffer, count: n)
        }
        return data
    }

    private static func mime(for file: URL) -> String {
        switch file.pathExtension.lowercased() {
        case "html": return "text/html; charset=utf-8"
        case "js", "mjs": return "text/javascript; charset=utf-8"
        case "css": return "text/css; charset=utf-8"
        case "json", "webmanifest": return "application/json"
        default: return UTType(filenameExtension: file.pathExtension)?.preferredMIMEType ?? "application/octet-stream"
        }
    }
}
