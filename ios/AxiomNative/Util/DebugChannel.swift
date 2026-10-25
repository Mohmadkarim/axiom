#if DEBUG
import Foundation
import UIKit

/// Simulator testing only (Debug builds): polls the local relay (tools/simjs.py serve) for commands such as
/// "open <id>", "book <id>", "close", "state" and answers with JSON.
final class DebugChannel {
    static let shared = DebugChannel()
    private var timer: Timer?
    var handlers: [String: ([String]) -> Any] = [:]

    func start() {
        guard timer == nil else { return }
        timer = Timer.scheduledTimer(withTimeInterval: 0.4, repeats: true) { [weak self] _ in self?.poll() }
        handlers["open"] = { a in AppState.shared.open(.note(a.first ?? "")); return "ok" }
        handlers["book"] = { a in AppState.shared.open(.book(a.first ?? "", page: a.count > 1 ? Int(a[1]) : nil)); return "ok" }
        handlers["close"] = { _ in AppState.shared.close(); return "ok" }
        handlers["notes"] = { _ in Library.shared.notes.map { ["id": $0.id, "name": $0.name, "kind": $0.kind] } }
        handlers["tutor"] = { a in
            if a.first == "open" { Tutor.shared.isOpen = true }
            if a.first == "ask" { Tutor.shared.draft = a.dropFirst().joined(separator: " "); Tutor.shared.sendDraft(attachPage: true) }
            return ["open": Tutor.shared.isOpen, "key": Tutor.shared.key, "msgs": Tutor.shared.messages.count, "hasPage": Tutor.shared.pageProvider != nil] as [String: Any]
        }
        handlers["books"] = { _ in Library.shared.books.map { ["id": $0.id, "name": $0.name, "type": $0.type] } }
    }
    private func poll() {
        guard let url = URL(string: "http://127.0.0.1:8799/cmd") else { return }
        URLSession.shared.dataTask(with: url) { data, _, _ in
            guard let data, let cmd = String(data: data, encoding: .utf8), !cmd.isEmpty else { return }
            DispatchQueue.main.async { self.run(cmd) }
        }.resume()
    }
    private func run(_ cmd: String) {
        let parts = cmd.trimmingCharacters(in: .whitespacesAndNewlines).split(separator: " ").map(String.init)
        var result: Any = "unknown command"
        if let name = parts.first, let h = handlers[name] { result = h(Array(parts.dropFirst())) }
        let body = (try? JSONSerialization.data(withJSONObject: ["r": result], options: [.fragmentsAllowed])) ?? Data()
        var req = URLRequest(url: URL(string: "http://127.0.0.1:8799/result")!)
        req.httpMethod = "POST"; req.httpBody = body
        URLSession.shared.dataTask(with: req).resume()
    }
}
#endif
