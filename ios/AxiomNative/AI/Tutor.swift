import Observation
import SwiftUI
import UIKit

/// What a question is about.
enum TutorSubject {
    case bookRegion(bookID: String, title: String, page: Int, text: String, image: UIImage?, pageText: String)
    case notebook(docID: String, name: String, images: [UIImage], label: String)
    case none
}

struct TutorMessage: Identifiable {
    let id: String
    var role: String                  // user | assistant
    var text: String
    var images: [Data] = []           // small JPEGs shown in the chat (and sent while recent)
    var label: String?
    var context: String?              // extra text sent with this question (page lines, book info)
    var error = false
    var t: Double = Date().ms
    var json: JSON {
        var j: JSON = ["id": id, "role": role, "text": text, "t": t]
        if !images.isEmpty { j["img"] = images.map { $0.base64EncodedString() } }
        if let label { j["label"] = label }
        if let context { j["ctx"] = context }
        if error { j["error"] = true }
        return j
    }
    init(role: String, text: String, images: [Data] = [], label: String? = nil, context: String? = nil) {
        id = UID.make(); self.role = role; self.text = text; self.images = images; self.label = label; self.context = context
    }
    init?(_ j: JSON) {
        guard let r = j.str("role") else { return nil }
        id = j.str("id") ?? UID.make(); role = r; text = j.str("text") ?? ""; t = j.num("t") ?? 0; label = j.str("label"); context = j.str("ctx"); error = j.bool("error")
        images = ((j["img"] as? [Any]) ?? []).compactMap { ($0 as? String).flatMap { Data(base64Encoded: $0) } }
    }
}

enum TutorMode: String, CaseIterable {
    case explain, hint, check, quiz
    var label: String { ["explain": "Explain", "hint": "Hint", "check": "Check my work", "quiz": "Quiz me"][rawValue]! }
    var effort: String { ["explain": "medium", "hint": "low", "check": "high", "quiz": "medium"][rawValue]! }
    var text: String {
        switch self {
        case .explain: return "Mode: EXPLAIN. Explain clearly and rigorously. Give intuition, then the precise definitions and argument. End by checking understanding with one short question when it helps."
        case .hint: return "Mode: HINT (guided learning). Do not give the full solution or the final answer. Give the smallest useful next hint or a guiding question, and let the student do the work. Reveal more only when the student asks for it."
        case .check: return "Mode: CHECK MY WORK. Read the student's handwritten work in the attached images and check it step by step against the problem (and the official solution if one is attached). Say which steps are correct. For the first error, quote the line, explain exactly why it is wrong and how to fix it. Do not rewrite the whole solution unless asked."
        case .quiz: return "Mode: QUIZ. Ask one question at a time about the current material, wait for the student's answer, then give precise feedback and the next question. Increase difficulty gradually."
        }
    }
}

@Observable
final class Tutor {
    static let shared = Tutor()
    var isOpen = false { didSet { if isOpen && AppState.shared.graphOpen { AppState.shared.graphOpen = false } } }
    var key = ""                      // note:<id> | book:<id>
    var title = ""
    var messages: [TutorMessage] = []
    var busy = false
    var status: String?
    var mode: TutorMode = .explain
    var web = false
    var draft = ""
    /// the open notebook or book can give a picture of what is on screen
    var pageProvider: (() -> (image: UIImage, label: String, text: String?)?)?
    var subjectLine = ""              // what the open document is, for the system prompt
    private var task: Task<Void, Never>?

    // MARK: conversations (one per notebook or book)

    func focus(key: String, title: String, subjectLine: String) {
        guard key != self.key else { self.subjectLine = subjectLine; return }
        save()
        self.key = key; self.title = title; self.subjectLine = subjectLine
        messages = Store.shared.loadFile("tutor_" + Store.safe(key)).flatMap(JSONIO.object)?.arr("msgs").compactMap(TutorMessage.init) ?? []
    }
    func save() {
        guard !key.isEmpty else { return }
        if let d = JSONIO.data(["msgs": messages.map(\.json)] as JSON) { Store.shared.saveFile("tutor_" + Store.safe(key), d) }
    }
    func newChat() { stop(); messages = []; save() }

    // MARK: asking

    func ask(_ question: String, about subject: TutorSubject, mode: TutorMode? = nil) {
        if let mode { self.mode = mode }
        withAnimation(.snappy(duration: 0.25)) { isOpen = true }
        var images: [Data] = []
        var label: String?
        var context: String?
        switch subject {
        case .bookRegion(let bookID, let title, let page, let text, let image, let pageText):
            focus(key: "book:" + bookID, title: title, subjectLine: "They are reading the book \"\(title)\".")
            if let image, let d = Self.jpeg(image, 1500) { images = [d] }
            label = "\(title) · p. \(page + 1)"
            context = Self.pageContext(title: title, page: page, selected: text, pageText: pageText)
        case .notebook(let docID, let name, let imgs, let l):
            focus(key: "note:" + docID, title: name, subjectLine: "They are in a notebook called \"\(name)\" (page images are attached when relevant).")
            images = imgs.prefix(12).compactMap { Self.jpeg($0, 1400) }
            label = l
        case .none: break
        }
        send(question, images: images, label: label, context: context)
    }

    /// the input box: attaches what is on screen the first time, or in check mode
    func sendDraft(attachPage: Bool) {
        let q = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !q.isEmpty, !busy else { return }
        draft = ""
        var images: [Data] = [], label: String?, context: String?
        if attachPage || mode == .check, let p = pageProvider?() {
            if let d = Self.jpeg(p.image, 1500) { images = [d] }
            label = p.label
            if let t = p.text, !t.isEmpty { context = "Text of \(p.label):\n" + String(t.prefix(7000)) }
        }
        send(q, images: images, label: label, context: context)
    }

    private func send(_ question: String, images: [Data], label: String?, context: String?) {
        let thumbs = images.compactMap { UIImage(data: $0).flatMap { Self.jpeg($0, 900) } }
        messages.append(TutorMessage(role: "user", text: question, images: thumbs, label: label, context: context))
        guard Claude.hasKey else { handOff(question, images: images, context: context); return }
        let reply = TutorMessage(role: "assistant", text: "")
        messages.append(reply)
        busy = true; status = nil
        let sys = systemPrompt()
        let msgs = apiMessages(latestImages: images)
        let effort = mode.effort
        let tools: [JSON]? = web ? [["type": "web_search_20260209", "name": "web_search", "max_uses": 5]] : nil
        let id = reply.id
        task = Task { @MainActor in
            do {
                let r = try await Claude.stream(system: sys, messages: msgs, maxTokens: 64000, effort: effort, tools: tools,
                                                onText: { [weak self] t in self?.update(id) { $0.text = t } },
                                                onStatus: { [weak self] s in self?.status = s })
                var text = r.text
                if r.stopReason == "refusal" { text += "\n\n_The tutor declined to answer this request._" }
                if r.stopReason == "max_tokens" { text += "\n\n_The answer was cut off because it got too long._" }
                if text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { text = "_No answer was returned. Try again._" }
                update(id) { $0.text = text }
            } catch is CancellationError {
                update(id) { if $0.text.isEmpty { $0.text = "_Stopped._" } }
            } catch {
                update(id) { $0.text = error.localizedDescription; $0.error = true }
            }
            busy = false; status = nil
            save()
        }
    }
    func stop() { task?.cancel(); task = nil; busy = false; status = nil }

    private func update(_ id: String, _ change: (inout TutorMessage) -> Void) {
        if let i = messages.firstIndex(where: { $0.id == id }) { change(&messages[i]) }
    }

    // MARK: prompts

    func systemPrompt() -> [JSON] {
        let lib = Library.shared
        var lines = ["You are the tutor built into Axiom, a notebook and reading room for university STEM students. The student writes by hand with Apple Pencil and reads textbooks and problem sets inside the app."]
        let courses = lib.subjects.map(\.name)
        if !courses.isEmpty { lines.append("Their courses: \(courses.joined(separator: ", ")).") }
        if !subjectLine.isEmpty { lines.append(subjectLine) }
        lines.append("Attached images are snapshots of their handwritten work, regions they selected in a book or problem set, photos, or whole pages. If handwriting or a scan is ambiguous, say what you read before relying on it.")
        lines.append("When page text is provided, quote the exact sentence you rely on briefly in a > blockquote and give its page number like (p. 34).")
        lines.append("Use precise mathematical language. Do not replace arguments with analogies or metaphors unless the student asks for intuition. Be direct about mistakes and concise; no filler or praise.")
        lines.append("Format with Markdown. Write all mathematics in LaTeX: $...$ inline and $$...$$ for display equations.")
        lines.append("When the student asks for practice questions, answer with a block ```quiz [{\"q\": \"…\", \"options\": [\"…\"], \"answer\": 0, \"explain\": \"…\"}] ``` and for flashcards with ```flashcards [{\"front\": \"…\", \"back\": \"…\"}] ``` (valid JSON; escape LaTeX backslashes as \\\\). The app turns these into interactive cards.")
        lines.append(mode.text)
        if web { lines.append("You can search the web. Use it when the question needs sources, data, recent results or material beyond the student's books; link the sources you rely on in Markdown.") }
        return [["type": "text", "text": lines.joined(separator: "\n"), "cache_control": ["type": "ephemeral"] as JSON]]
    }

    /// the conversation for the API: the newest six pictures are sent, older ones are only mentioned
    private func apiMessages(latestImages: [Data]) -> [JSON] {
        let history = Array(messages.dropLast()).filter { !$0.error }   // the empty reply placeholder is last
        let last = history.count - 1
        var keepFrom = history.count, count = 0
        for k in stride(from: last, through: 0, by: -1) where history[k].role == "user" {
            let n = k == last ? latestImages.count : history[k].images.count
            if count + n > 6 { break }
            count += n; keepFrom = k
        }
        var out: [JSON] = []
        for (k, m) in history.enumerated() {
            var content: [JSON] = []
            if m.role == "user" {
                for d in (k == last ? latestImages : m.images) {
                    content.append(k >= keepFrom ? Claude.image(jpeg: d) : Claude.text("[Earlier image omitted: \(m.label ?? "picture")]"))
                }
                if let c = m.context, k >= last - 2 { content.append(Claude.text(c)) }
                content.append(Claude.text((m.label.map { "(Attached: \($0))\n\n" } ?? "") + m.text))
            } else {
                content.append(Claude.text(m.text.isEmpty ? "…" : m.text))
            }
            if var prev = out.last, prev.str("role") == m.role, let c = prev["content"] as? [JSON] {
                prev["content"] = c + content; out[out.count - 1] = prev
            } else { out.append(["role": m.role, "content": content]) }
        }
        while out.first?.str("role") == "assistant" { out.removeFirst() }
        return out
    }

    static func pageContext(title: String, page: Int, selected: String, pageText: String) -> String {
        var s = "[Book: \"\(title)\". The student is on PDF page \(page + 1).]\n"
        if !selected.isEmpty { s += "Selected passage:\n\"\"\"\n\(String(selected.prefix(6000)))\n\"\"\"\n" }
        if !pageText.isEmpty { s += "Text of p. \(page + 1):\n" + String(pageText.prefix(7000)) }
        return s
    }

    static func jpeg(_ img: UIImage, _ maxSide: CGFloat) -> Data? {
        let px = CGSize(width: img.size.width * img.scale, height: img.size.height * img.scale)
        let k = min(1, maxSide / max(px.width, px.height, 1))
        if k >= 0.999 { return img.jpegData(compressionQuality: 0.86) }
        let size = CGSize(width: (px.width * k).rounded(), height: (px.height * k).rounded())
        let f = UIGraphicsImageRendererFormat(); f.scale = 1
        return UIGraphicsImageRenderer(size: size, format: f).image { _ in img.draw(in: CGRect(origin: .zero, size: size)) }.jpegData(compressionQuality: 0.86)
    }

    // MARK: without an API key: hand the question to the Claude (or ChatGPT) app

    private func handOff(_ question: String, images: [Data], context: String?) {
        var prompt = "I'm a university student. Please answer with precise mathematical language (LaTeX for math), no analogies unless I ask.\n\n\(mode.text)\n"
        if !images.isEmpty { prompt += "The attached image\(images.count > 1 ? "s are" : " is") from my notes or textbook.\n" }
        if let c = context { prompt += "\n" + String(c.prefix(16000)) + "\n" }
        prompt += "\n" + question
        UIPasteboard.general.string = prompt
        messages.append(TutorMessage(role: "assistant", text: "I handed this to your Claude app (the question is also on the clipboard). To get answers right here, add a Claude API key in Settings."))
        save()
        let items: [Any] = [prompt] + images.compactMap(UIImage.init(data:))
        let vc = UIActivityViewController(activityItems: items, applicationActivities: nil)
        guard let root = UIApplication.shared.connectedScenes.compactMap({ ($0 as? UIWindowScene)?.keyWindow }).first?.rootViewController else { return }
        var top = root; while let p = top.presentedViewController { top = p }
        vc.popoverPresentationController?.sourceView = top.view
        vc.popoverPresentationController?.sourceRect = CGRect(x: top.view.bounds.maxX - 220, y: top.view.bounds.maxY - 120, width: 1, height: 1)
        top.present(vc, animated: true)
    }
}
