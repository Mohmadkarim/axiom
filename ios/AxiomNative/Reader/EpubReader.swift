import SwiftUI
import WebKit

/// An EPUB book: its chapters shown one at a time in the reader's page colour and type, with contents, progress
/// and the tutor (it asks about the selection or the chapter).
final class EpubBook {
    struct Chapter { let href: String; let title: String }
    let root: URL
    let chapters: [Chapter]
    let title: String

    init?(bookID: String) {
        let dir = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0].appendingPathComponent("epub_" + Store.safe(bookID), isDirectory: true)
        let fm = FileManager.default
        if !fm.fileExists(atPath: dir.appendingPathComponent("META-INF/container.xml").path) {
            guard let data = Store.shared.loadFile("doc_" + bookID), let zip = ZipArchive(data: data) else { return nil }
            try? fm.createDirectory(at: dir, withIntermediateDirectories: true)
            _ = zip.extract(to: dir)
        }
        guard let container = try? String(contentsOf: dir.appendingPathComponent("META-INF/container.xml"), encoding: .utf8),
              let opfPath = EpubBook.attr(container, tag: "rootfile", name: "full-path"),
              let opf = try? String(contentsOf: dir.appendingPathComponent(opfPath), encoding: .utf8) else { return nil }
        let base = (opfPath as NSString).deletingLastPathComponent
        var manifest: [String: String] = [:]
        for item in EpubBook.tags(opf, "item") { if let id = EpubBook.attr(item, tag: "item", name: "id"), let href = EpubBook.attr(item, tag: "item", name: "href") { manifest[id] = href.removingPercentEncoding ?? href } }
        let spine = EpubBook.tags(opf, "itemref").compactMap { EpubBook.attr($0, tag: "itemref", name: "idref") }.compactMap { manifest[$0] }
        // chapter titles from the navigation document when there is one
        var titles: [String: String] = [:]
        if let navItem = EpubBook.tags(opf, "item").first(where: { $0.contains("properties=\"nav\"") }), let navHref = EpubBook.attr(navItem, tag: "item", name: "href"),
           let nav = try? String(contentsOf: dir.appendingPathComponent(base).appendingPathComponent(navHref), encoding: .utf8) {
            let re = try? NSRegularExpression(pattern: ##"<a[^>]*href="([^"#]*)[^"]*"[^>]*>(.*?)</a>"##, options: [.dotMatchesLineSeparators, .caseInsensitive])
            for m in re?.matches(in: nav, range: NSRange(nav.startIndex..., in: nav)) ?? [] {
                guard let h = Range(m.range(at: 1), in: nav), let t = Range(m.range(at: 2), in: nav) else { continue }
                let href = String(nav[h]), text = String(nav[t]).replacingOccurrences(of: "<[^>]+>", with: "", options: .regularExpression).trimmingCharacters(in: .whitespacesAndNewlines)
                let resolved = ((navHref as NSString).deletingLastPathComponent as NSString).appendingPathComponent(href)
                if titles[resolved] == nil { titles[resolved] = text }
            }
        }
        root = dir.appendingPathComponent(base, isDirectory: true)
        chapters = spine.enumerated().map { i, h in Chapter(href: h, title: titles[h] ?? titles[(h as NSString).lastPathComponent] ?? "Section \(i + 1)") }
        title = EpubBook.text(opf, "dc:title") ?? "Book"
        if chapters.isEmpty { return nil }
    }

    static func tags(_ s: String, _ tag: String) -> [String] {
        let re = try? NSRegularExpression(pattern: "<\(tag)\\b[^>]*>", options: .caseInsensitive)
        return re?.matches(in: s, range: NSRange(s.startIndex..., in: s)).compactMap { Range($0.range, in: s).map { String(s[$0]) } } ?? []
    }
    static func attr(_ s: String, tag: String, name: String) -> String? {
        guard let t = tags(s, tag).first ?? (s.hasPrefix("<") ? s : nil) else { return nil }
        let re = try? NSRegularExpression(pattern: "\\b\(name)\\s*=\\s*\"([^\"]*)\"", options: .caseInsensitive)
        guard let m = re?.firstMatch(in: t, range: NSRange(t.startIndex..., in: t)), let r = Range(m.range(at: 1), in: t) else { return nil }
        return String(t[r])
    }
    static func text(_ s: String, _ tag: String) -> String? {
        let re = try? NSRegularExpression(pattern: "<\(tag)[^>]*>(.*?)</\(tag)>", options: [.dotMatchesLineSeparators, .caseInsensitive])
        guard let m = re?.firstMatch(in: s, range: NSRange(s.startIndex..., in: s)), let r = Range(m.range(at: 1), in: s) else { return nil }
        return String(s[r])
    }
}

struct EpubReaderScreen: View {
    let book: BookMeta
    @Environment(AppState.self) private var app
    @State private var epub: EpubBook?
    @State private var failed = false
    @State private var chapter = 0
    @State private var theme = Library.shared.settings.str("readerTheme") ?? "paper"
    @State private var font = CGFloat(Library.shared.settings.num("epubFont") ?? 1)
    @State private var web = WKWebView()
    @State private var showContents = false

    private var colors: (bg: String, fg: String) { theme == "night" ? ("#16171a", "#d9dce2") : theme == "sepia" ? ("#f4ecd8", "#3b3021") : ("#ffffff", "#1b1d22") }

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 10) {
                HStack(spacing: 4) {
                    IconButton(symbol: "chevron.left", label: "Back to the library") { save(); app.close() }
                    Text(cleanTitle(book.name)).font(Theme.ui(15, .semibold)).lineLimit(1).frame(maxWidth: 260, alignment: .leading).padding(.trailing, 10)
                }.padding(4).floating()
                Spacer()
                HStack(spacing: 2) {
                    IconButton(symbol: "list.bullet", label: "Contents", on: showContents) { showContents.toggle() }
                    Menu {
                        Section("Text size") {
                            Button("Larger", systemImage: "plus") { font = min(2, font + 0.1); apply() }
                            Button("Smaller", systemImage: "minus") { font = max(0.7, font - 0.1); apply() }
                        }
                        Section("Page colour") {
                            ForEach([("paper", "Paper"), ("sepia", "Sepia"), ("night", "Night")], id: \.0) { t in Button { theme = t.0; Library.shared.set("readerTheme", t.0); apply() } label: { if theme == t.0 { Label(t.1, systemImage: "checkmark") } else { Text(t.1) } } }
                        }
                    } label: { Text("Aa").font(.system(size: 16, weight: .semibold)).foregroundStyle(Theme.fg).frame(width: 40, height: 40) }
                    IconButton(symbol: "sparkles", label: "Ask the tutor", tint: Theme.accent) { ask() }
                }.padding(4).floating()
            }
            .padding(.horizontal, 14).padding(.vertical, 10)
            if failed { Spacer(); Text("This EPUB could not be opened.").font(Theme.ui(16, .medium)); Spacer() }
            else if let e = epub {
                HStack(spacing: 0) {
                    if showContents {
                        ScrollView {
                            LazyVStack(alignment: .leading, spacing: 0) {
                                ForEach(Array(e.chapters.enumerated()), id: \.offset) { i, c in
                                    Button { go(i) } label: { Text(c.title).font(Theme.ui(14, i == chapter ? .semibold : .regular)).foregroundStyle(i == chapter ? Theme.accent : Theme.fg).frame(maxWidth: .infinity, alignment: .leading).padding(.vertical, 9).padding(.horizontal, 12) }.buttonStyle(.plain)
                                }
                            }
                        }
                        .frame(width: 250).floating(16).padding(.leading, 14).padding(.bottom, 14)
                    }
                    EpubWeb(web: web, url: e.root.appendingPathComponent(e.chapters[chapter].href), root: e.root, css: css)
                        .clipShape(RoundedRectangle(cornerRadius: 10)).padding(.horizontal, 14)
                }
                HStack {
                    Button { go(chapter - 1) } label: { Label("Previous", systemImage: "chevron.left") }.disabled(chapter == 0)
                    Spacer()
                    Text("\(e.chapters[chapter].title) · \(chapter + 1) of \(e.chapters.count)").font(Theme.ui(12)).foregroundStyle(Theme.muted).lineLimit(1)
                    Spacer()
                    Button { go(chapter + 1) } label: { Label("Next", systemImage: "chevron.right").labelStyle(.titleAndIcon) }.disabled(chapter >= e.chapters.count - 1)
                }
                .font(Theme.ui(14, .medium)).padding(.horizontal, 20).padding(.vertical, 12)
            } else { Spacer(); ProgressView(); Spacer() }
        }
        .background(Theme.bg)
        .task {
            let id = book.id
            let e = await Task.detached { EpubBook(bookID: id) }.value
            if let e { epub = e; chapter = min(max(0, (book.raw.int("chapter") ?? 0)), e.chapters.count - 1); connectTutor() } else { failed = true }
        }
        .onDisappear { save() }
    }

    private var css: String {
        "html,body{background:\(colors.bg)!important;color:\(colors.fg)!important;} body{font-family:'Iowan Old Style',Georgia,serif;font-size:\(Int(108 * font))%;line-height:1.6;max-width:42em;margin:0 auto;padding:28px 34px 80px;-webkit-text-size-adjust:none} img,svg{max-width:100%;height:auto} a{color:#6f9bff}"
    }
    private func apply() { Library.shared.set("epubFont", Double(font)) }
    private func go(_ i: Int) { guard let e = epub, e.chapters.indices.contains(i) else { return }; chapter = i; save() }
    private func save() {
        guard let e = epub else { return }
        Library.shared.updateBook(book.id) { $0["chapter"] = chapter; $0["progress"] = Double(chapter + 1) / Double(e.chapters.count); $0["lastRead"] = Date().ms }
    }
    private func connectTutor() {
        Tutor.shared.focus(key: "book:" + book.id, title: cleanTitle(book.name), subjectLine: "They are reading the book \"\(cleanTitle(book.name))\" (an EPUB; quote passages briefly in a > blockquote).")
        Tutor.shared.pageProvider = nil
    }
    private func ask() {
        web.evaluateJavaScript("[window.getSelection().toString(), document.body.innerText.slice(0, 12000)]") { r, _ in
            let a = r as? [String] ?? ["", ""]
            let sel = a.first ?? "", text = a.count > 1 ? a[1] : ""
            let title = epub?.chapters[chapter].title ?? "this chapter"
            Tutor.shared.focus(key: "book:" + book.id, title: cleanTitle(book.name), subjectLine: Tutor.shared.subjectLine)
            withAnimation(.snappy(duration: 0.25)) { Tutor.shared.isOpen = true }
            if sel.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                Tutor.shared.draft = ""
                Tutor.shared.pageProvider = nil
                Tutor.shared.ask("Summarise the key ideas of \(title).", about: .bookRegion(bookID: book.id, title: cleanTitle(book.name), page: chapter, text: "", image: nil, pageText: text))
            } else {
                Tutor.shared.ask("Explain this passage rigorously, step by step.", about: .bookRegion(bookID: book.id, title: cleanTitle(book.name), page: chapter, text: sel, image: nil, pageText: text))
            }
        }
    }
}

struct EpubWeb: UIViewRepresentable {
    let web: WKWebView
    let url: URL
    let root: URL
    let css: String
    func makeUIView(context: Context) -> WKWebView {
        web.isOpaque = false
        web.backgroundColor = .clear
        web.navigationDelegate = context.coordinator
        install(css, context.coordinator)
        web.loadFileURL(url, allowingReadAccessTo: root)
        context.coordinator.url = url
        return web
    }
    func updateUIView(_ v: WKWebView, context: Context) {
        if context.coordinator.css != css { install(css, context.coordinator) }
        if context.coordinator.url != url { context.coordinator.url = url; v.loadFileURL(url, allowingReadAccessTo: root) }
    }
    /// the reader's colours and type, injected into every chapter as it loads (and into the one on screen)
    private func install(_ css: String, _ c: Coord) {
        c.css = css
        let lit = String(data: (try? JSONSerialization.data(withJSONObject: [css])) ?? Data(), encoding: .utf8).map { String($0.dropFirst().dropLast()) } ?? "''"
        let js = "(function(){var s=document.getElementById('axiom-style');if(!s){s=document.createElement('style');s.id='axiom-style';(document.head||document.documentElement).appendChild(s);}s.textContent=\(lit);})()"
        let ucc = web.configuration.userContentController
        ucc.removeAllUserScripts()
        ucc.addUserScript(WKUserScript(source: js, injectionTime: .atDocumentEnd, forMainFrameOnly: true))
        web.evaluateJavaScript(js)
    }
    func makeCoordinator() -> Coord { Coord() }
    final class Coord: NSObject, WKNavigationDelegate {
        var url: URL?
        var css = ""
        /// links to other chapters stay inside; links to websites open in Safari
        func webView(_ w: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
            if let u = action.request.url, u.scheme == "http" || u.scheme == "https" { UIApplication.shared.open(u); decisionHandler(.cancel); return }
            decisionHandler(.allow)
        }
    }
}
