import Observation
import PDFKit
import SwiftUI

enum ReaderMode: String { case read, highlight, write }

@Observable
final class ReaderModel {
    var mode: ReaderMode = .read
    var page = 0
    var pageCount = 1
    var pageLabel: String?
    var theme = Library.shared.settings.str("readerTheme") ?? "paper"
    var startPage: Int?
    var error: String?
    var outline: [OutlineItem] = []
    var highlights: [ReaderStore.Highlight] = []
    var ask: AskTarget?
    var inkColor = "#1b1d22"
    var inkWidth: CGFloat = 2.2
    var inkEraser = false
    var canUndo = false
    var rail: RailTab?
    var showDisplay = false
    var showSearch = false
    var chromeHidden = false
}
enum RailTab: String { case pages, contents, highlights }

@Observable
final class ReaderSession {
    let model = ReaderModel()
    var controller: ReaderController?
    let book: BookMeta?
    init(bookID: String, page: Int?) {
        book = Library.shared.books.first { $0.id == bookID }
        model.startPage = page
    }
}

struct ReaderScreen: View {
    let bookID: String
    var startPage: Int?
    @Environment(AppState.self) private var app
    @State private var session: ReaderSession
    @State private var query = ""
    @State private var hits: [SearchHit] = []
    @State private var askText = ""

    init(bookID: String, startPage: Int?) {
        self.bookID = bookID; self.startPage = startPage
        _session = State(initialValue: ReaderSession(bookID: bookID, page: startPage))
    }
    private var model: ReaderModel { session.model }

    var body: some View {
        ZStack {
            if session.book != nil {
                ReaderHost(session: session).ignoresSafeArea()
                if let e = model.error { Text(e).font(Theme.ui(16, .medium)).padding(20).floating() }
                chrome
            } else {
                VStack(spacing: 12) { Text("This book could not be found.").font(Theme.ui(17, .medium)); Button("Back to the library") { app.close() } }
            }
        }
        .background(ReaderController.desk(model.theme).swiftUI)
    }

    private var title: String { session.book.map { cleanTitle($0.name) } ?? "" }

    @ViewBuilder private var chrome: some View {
        GeometryReader { geo in chromeBody(compact: geo.size.width < 700) }
    }
    @ViewBuilder private func chromeBody(compact: Bool) -> some View {
        VStack(spacing: 0) {
            HStack(alignment: .top, spacing: 10) {
                HStack(spacing: 4) {
                    IconButton(symbol: "chevron.left", label: "Back to the library") { session.controller?.flush(); app.close() }
                    VStack(alignment: .leading, spacing: 1) {
                        Text(title).font(Theme.ui(15, .semibold)).lineLimit(1)
                        if let a = session.book?.author { Text(a).font(Theme.ui(11)).foregroundStyle(Theme.muted).lineLimit(1) }
                    }.frame(maxWidth: compact ? 110 : 240, alignment: .leading).padding(.trailing, compact ? 4 : 10)
                }.padding(4).floating()
                Spacer(minLength: 6)
                modePicker(compact: compact)
                Spacer(minLength: 6)
                HStack(spacing: 2) {
                    IconButton(symbol: "magnifyingglass", label: "Search", on: model.showSearch) { model.showSearch.toggle(); model.rail = nil }
                    IconButton(symbol: "sidebar.left", label: "Pages and contents", on: model.rail != nil) { withAnimation(.snappy(duration: 0.2)) { model.rail = model.rail == nil ? .pages : nil }; model.showSearch = false }
                    Button { model.showDisplay.toggle() } label: { Text("Aa").font(.system(size: 16, weight: .semibold)).foregroundStyle(model.showDisplay ? Theme.accent : Theme.fg).frame(width: 40, height: 40) }
                        .buttonStyle(.plain)
                        .popover(isPresented: Bindable(model).showDisplay) { DisplayMenu(model: model, controller: session.controller, book: session.book).presentationCompactAdaptation(.popover) }
                    IconButton(symbol: "sparkles", label: "Tutor", on: Tutor.shared.isOpen, tint: Theme.accent) { withAnimation(.snappy(duration: 0.25)) { Tutor.shared.isOpen.toggle() } }
                }.padding(4).floating()
            }
            .padding(.horizontal, 14).padding(.top, 10)
            if model.mode == .write { inkBar.padding(.top, 10) }
            Spacer()
            bottomBar
        }
        HStack(alignment: .top) {
            if let tab = model.rail, let c = session.controller { ReaderRail(model: model, controller: c, tab: tab).transition(.move(edge: .leading).combined(with: .opacity)) }
            Spacer()
            if model.showSearch, let c = session.controller { searchPanel(c) }
        }
        .padding(.top, 70).padding(.bottom, 70)
        if let a = model.ask, let c = session.controller { AskBox(target: a, controller: c, model: model, book: session.book!) }
    }

    private func modePicker(compact: Bool) -> some View {
        HStack(spacing: 2) {
            modeButton(.read, "Read", "book", compact)
            modeButton(.highlight, "Highlight", "highlighter", compact)
            modeButton(.write, "Write", "pencil.tip", compact)
        }
        .padding(4).floating()
    }
    private func modeButton(_ m: ReaderMode, _ t: String, _ icon: String, _ compact: Bool) -> some View {
        Button { model.mode = m; model.ask = nil; session.controller?.applyMode() } label: {
            Group { if compact { Image(systemName: icon) } else { Label(t, systemImage: icon) } }
                .font(Theme.ui(13, .semibold)).foregroundStyle(model.mode == m ? Theme.fg : Theme.muted)
                .padding(.horizontal, compact ? 10 : 12).frame(height: 34)
                .background(model.mode == m ? Theme.panel2 : .clear, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
        }.buttonStyle(.plain)
    }

    private var inkBar: some View {
        HStack(spacing: 6) {
            ForEach(["#1b1d22", "#1f4fbf", "#c43c35", "#1e8449"], id: \.self) { c in
                Button { model.inkColor = c; model.inkEraser = false; session.controller?.applyInkTool() } label: {
                    Circle().fill(Color(uiColor: UIColor(css: c))).frame(width: 26, height: 26)
                        .overlay(Circle().strokeBorder(Theme.accent, lineWidth: !model.inkEraser && model.inkColor == c ? 2.5 : 0).padding(-3))
                }.buttonStyle(.plain)
            }
            Rectangle().fill(Theme.lineStrong).frame(width: 1, height: 22).padding(.horizontal, 4)
            ForEach([1.4, 2.2, 3.6] as [CGFloat], id: \.self) { w in
                Button { model.inkWidth = w; model.inkEraser = false; session.controller?.applyInkTool() } label: {
                    Capsule().fill(Theme.fg).frame(width: 22, height: w * 1.4).frame(width: 36, height: 34)
                        .background(!model.inkEraser && model.inkWidth == w ? Theme.accentSoft : .clear, in: RoundedRectangle(cornerRadius: 9))
                }.buttonStyle(.plain)
            }
            Rectangle().fill(Theme.lineStrong).frame(width: 1, height: 22).padding(.horizontal, 4)
            IconButton(symbol: "eraser", label: "Eraser", on: model.inkEraser) { model.inkEraser.toggle(); session.controller?.applyInkTool() }
            IconButton(symbol: "arrow.uturn.backward", label: "Undo") { session.controller?.undoInk() }
        }
        .padding(5).floating()
    }

    private var bottomBar: some View {
        HStack(spacing: 14) {
            VStack(alignment: .leading, spacing: 0) {
                Text(model.pageLabel.map { "p. \($0)" } ?? "Page \(model.page + 1)").font(Theme.ui(14, .semibold))
                Text("\(model.page + 1) of \(model.pageCount)").font(Theme.num(11)).foregroundStyle(Theme.muted)
            }.frame(minWidth: 86, alignment: .leading)
            Slider(value: Binding(get: { Double(model.page) }, set: { session.controller?.go(to: Int($0.rounded())) }), in: 0...Double(max(1, model.pageCount - 1)))
                .tint(Theme.accent)
        }
        .padding(.horizontal, 16).padding(.vertical, 8).floating()
        .padding(.horizontal, 14).padding(.bottom, 12)
    }

    private func searchPanel(_ c: ReaderController) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Image(systemName: "magnifyingglass").foregroundStyle(Theme.muted)
                TextField("Search in this book", text: $query).textFieldStyle(.plain).submitLabel(.search)
                    .onSubmit { hits = c.search(query) }
            }
            .padding(.horizontal, 12).frame(height: 40).background(Theme.panel2, in: RoundedRectangle(cornerRadius: 12))
            if !hits.isEmpty { Text("\(hits.count) results").font(Theme.label()).foregroundStyle(Theme.muted) }
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 4) {
                    ForEach(hits) { h in
                        Button { c.show(h) } label: {
                            HStack(alignment: .top, spacing: 8) {
                                Text("p. \(h.page + 1)").font(Theme.num(11)).foregroundStyle(Theme.muted).frame(width: 46, alignment: .leading)
                                Text(h.snippet).font(Theme.ui(13)).foregroundStyle(Theme.fg).lineLimit(3).multilineTextAlignment(.leading)
                            }.padding(8).frame(maxWidth: .infinity, alignment: .leading).contentShape(Rectangle())
                        }.buttonStyle(.plain)
                    }
                }
            }
        }
        .padding(12).frame(width: 340).frame(maxHeight: 520).floating(18).padding(.trailing, 14)
    }
}

/// "Topology (z-lib.org)" → "Topology"
func cleanTitle(_ s: String) -> String {
    var t = s
    for pat in [#"\s*\(z-lib\.org\)"#, #"\s*-\s*libgen\.\w+"#, #"\s*\[.*?\]$"#, #"_+"#] { t = t.replacingOccurrences(of: pat, with: pat == #"_+"# ? " " : "", options: .regularExpression) }
    return t.trimmingCharacters(in: .whitespaces)
}

extension UIColor { var swiftUI: Color { Color(uiColor: self) } }

struct ReaderHost: UIViewControllerRepresentable {
    let session: ReaderSession
    func makeUIViewController(context: Context) -> ReaderController {
        let c = ReaderController(book: session.book!, model: session.model)
        session.controller = c
        return c
    }
    func updateUIViewController(_ c: ReaderController, context: Context) {}
    static func dismantleUIViewController(_ c: ReaderController, coordinator: ()) { c.flush() }
}

// MARK: - display menu

struct DisplayMenu: View {
    @Bindable var model: ReaderModel
    let controller: ReaderController?
    let book: BookMeta?
    @Environment(AppState.self) private var app
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            label("Zoom")
            HStack {
                IconButton(symbol: "minus", label: "Smaller") { controller?.zoom(by: 1 / 1.2) }
                Spacer()
                Text("\(controller?.zoomPercent ?? 100)%").font(Theme.num(14, .semibold))
                Spacer()
                IconButton(symbol: "plus", label: "Larger") { controller?.zoom(by: 1.2) }
            }
            .padding(2).background(Theme.panel2, in: RoundedRectangle(cornerRadius: 12))
            HStack(spacing: 8) {
                Button("Fit width") { controller?.fitWidth() }.buttonStyle(.bordered).frame(maxWidth: .infinity)
                Button("Fit page") { controller?.fitPage() }.buttonStyle(.bordered).frame(maxWidth: .infinity)
            }
            label("Page colour")
            HStack(spacing: 18) {
                swatch("paper", "Paper", "#ffffff"); swatch("sepia", "Sepia", "#f4ecd8"); swatch("night", "Night", "#111214")
            }
            if let b = book {
                Button {
                    model.showDisplay = false
                    let id = Library.shared.newNotebook(name: "Solving · " + cleanTitle(b.name), template: .grid, subject: b.subject)
                    app.say("A notebook for solving was created", 2)
                    app.open(.note(id))
                } label: {
                    Label("Solve in a notebook", systemImage: "book.closed").font(Theme.ui(14, .semibold)).frame(maxWidth: .infinity).frame(height: 42)
                        .foregroundStyle(Theme.accent).background(Theme.accentSoft, in: RoundedRectangle(cornerRadius: 12))
                }.buttonStyle(.plain)
            }
        }
        .padding(14).frame(width: 280)
    }
    private func label(_ t: String) -> some View { Text(t.uppercased()).font(Theme.label()).tracking(0.8).foregroundStyle(Theme.muted) }
    private func swatch(_ id: String, _ name: String, _ color: String) -> some View {
        Button { model.theme = id; Library.shared.set("readerTheme", id); controller?.applyTheme() } label: {
            VStack(spacing: 6) {
                Circle().fill(Color(uiColor: UIColor(css: color))).frame(width: 40, height: 40)
                    .overlay(Circle().strokeBorder(Theme.lineStrong, lineWidth: 0.5))
                    .overlay(Circle().strokeBorder(Theme.accent, lineWidth: model.theme == id ? 2.5 : 0).padding(-4))
                    .overlay { if model.theme == id { Image(systemName: "checkmark").font(.system(size: 14, weight: .bold)).foregroundStyle(id == "night" ? .white : Theme.accent) } }
                Text(name).font(Theme.ui(12, model.theme == id ? .semibold : .regular)).foregroundStyle(model.theme == id ? Theme.fg : Theme.muted)
            }
        }.buttonStyle(.plain).frame(maxWidth: .infinity)
    }
}

// MARK: - rail

struct ReaderRail: View {
    @Bindable var model: ReaderModel
    let controller: ReaderController
    let tab: RailTab
    var body: some View {
        VStack(spacing: 10) {
            Picker("", selection: Binding(get: { model.rail ?? .pages }, set: { model.rail = $0 })) {
                Text("Pages").tag(RailTab.pages); Text("Contents").tag(RailTab.contents); Text("Highlights").tag(RailTab.highlights)
            }.pickerStyle(.segmented)
            switch tab {
            case .pages: ThumbnailRail(controller: controller)
            case .contents:
                if model.outline.isEmpty { Text("This PDF has no table of contents.").font(Theme.ui(13)).foregroundStyle(Theme.muted).padding(.top, 20); Spacer() }
                else {
                    ScrollView {
                        LazyVStack(alignment: .leading, spacing: 0) {
                            ForEach(model.outline) { o in
                                Button { controller.go(to: o.page) } label: {
                                    HStack { Text(o.title).font(Theme.ui(o.level == 0 ? 14 : 13, o.level == 0 ? .semibold : .regular)).lineLimit(2); Spacer(); Text("\(o.page + 1)").font(Theme.num(11)).foregroundStyle(Theme.muted) }
                                        .padding(.leading, CGFloat(o.level) * 14).padding(.vertical, 8).contentShape(Rectangle())
                                }.buttonStyle(.plain)
                            }
                        }
                    }
                }
            case .highlights:
                if model.highlights.isEmpty { Text("Highlights appear here. Choose Highlight and drag the Pencil across text.").font(Theme.ui(13)).foregroundStyle(Theme.muted).padding(.top, 20); Spacer() }
                else {
                    ScrollView {
                        LazyVStack(alignment: .leading, spacing: 8) {
                            ForEach(model.highlights) { h in
                                Button { controller.go(to: h.page - 1) } label: {
                                    HStack(alignment: .top, spacing: 8) {
                                        RoundedRectangle(cornerRadius: 2).fill(Color(uiColor: ReaderStore.colors[h.color]!.withAlphaComponent(1))).frame(width: 4)
                                        VStack(alignment: .leading, spacing: 3) {
                                            Text(h.text.isEmpty ? "Highlight" : h.text).font(Theme.ui(13)).lineLimit(4).multilineTextAlignment(.leading)
                                            Text("p. \(h.page)").font(Theme.num(11)).foregroundStyle(Theme.muted)
                                        }
                                    }.contentShape(Rectangle())
                                }
                                .buttonStyle(.plain)
                                .contextMenu {
                                    ForEach(["yellow", "green", "blue", "pink"], id: \.self) { c in Button(c.capitalized) { controller.recolorHighlight(h.id, c) } }
                                    Button("Copy text", systemImage: "doc.on.doc") { UIPasteboard.general.string = h.text }
                                    Button("Remove highlight", systemImage: "trash", role: .destructive) { controller.removeHighlight(h.id) }
                                }
                            }
                        }
                    }
                }
            }
        }
        .padding(12).frame(width: 250).floating(18).padding(.leading, 14)
    }
}

/// PDFKit's own page thumbnails.
struct ThumbnailRail: UIViewRepresentable {
    let controller: ReaderController
    func makeUIView(context: Context) -> PDFThumbnailView {
        let t = PDFThumbnailView()
        t.pdfView = controller.pdfView
        t.layoutMode = .vertical
        t.thumbnailSize = CGSize(width: 150, height: 200)
        t.backgroundColor = .clear
        return t
    }
    func updateUIView(_ v: PDFThumbnailView, context: Context) {}
}

// MARK: - ask about a circled region

struct AskBox: View {
    let target: AskTarget
    let controller: ReaderController
    @Bindable var model: ReaderModel
    let book: BookMeta
    @State private var text = ""
    var body: some View {
        GeometryReader { geo in
            let w: CGFloat = 400
            let below = target.anchor.maxY + 190 < geo.size.height
            let y = below ? target.anchor.maxY + 12 + 75 : target.anchor.minY - 12 - 75
            VStack(alignment: .leading, spacing: 8) {
                HStack(spacing: 2) {
                    Text("ASK ABOUT THIS SELECTION").font(Theme.label()).tracking(0.6).foregroundStyle(Theme.muted)
                    Spacer()
                    IconButton(symbol: "highlighter", label: "Highlight", size: 32) { controller.highlightAsk(target); model.ask = nil }
                    IconButton(symbol: "doc.on.doc", label: "Copy text", size: 32) { UIPasteboard.general.string = target.text; model.ask = nil; AppState.shared.say("Copied", 0.8) }
                    IconButton(symbol: "xmark", label: "Close", size: 32) { model.ask = nil }
                }
                HStack(spacing: 0) {
                    TextField("Ask about this…", text: $text).textFieldStyle(.plain).padding(.leading, 16).submitLabel(.send)
                        .onSubmit { send(text) }
                    Button { send(text) } label: { Image(systemName: "arrow.up").font(.system(size: 15, weight: .bold)).foregroundStyle(.white).frame(width: 32, height: 32).background(Theme.accent.opacity(text.trimmingCharacters(in: .whitespaces).isEmpty ? 0.35 : 1), in: Circle()) }
                        .buttonStyle(.plain).disabled(text.trimmingCharacters(in: .whitespaces).isEmpty).padding(5)
                }
                .frame(height: 42).background(Theme.panel2, in: Capsule())
                HStack(spacing: 6) {
                    chip("Explain") { send("Explain this passage rigorously, step by step.") }
                    chip("Fill in steps") { send("Fill in the details of this argument: justify every step that the book skips.") }
                    chip("Hint") { send("Give me a hint for this. Not the solution.") }
                }
            }
            .padding(12).frame(width: w).floating(18)
            .position(x: min(max(target.anchor.midX, w / 2 + 14), geo.size.width - w / 2 - 14), y: max(120, y))
        }
    }
    private func chip(_ t: String, _ action: @escaping () -> Void) -> some View {
        Button(action: action) { Text(t).font(Theme.ui(13, .medium)).padding(.horizontal, 12).frame(height: 32).background(Theme.panel2, in: RoundedRectangle(cornerRadius: 10)) }.buttonStyle(.plain)
    }
    private func send(_ q: String) {
        let question = q.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !question.isEmpty else { return }
        let img = controller.regionImage(page: target.page, rect: target.rect)
        model.ask = nil
        Tutor.shared.ask(question, about: .bookRegion(bookID: book.id, title: cleanTitle(book.name), page: target.page, text: target.text, image: img, pageText: controller.pageText(target.page)))
    }
}
