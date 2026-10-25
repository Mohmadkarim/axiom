import PDFKit
import SwiftUI

/// A book beside the notebook: read while writing, put a page (or the page on screen) into the notes, ask about it.
struct BookPanel: View {
    var width: CGFloat = 420
    @Environment(Library.self) private var lib
    @State private var bookID: String? = AppState.shared.besideBook
    @State private var pdf = PDFView()
    @State private var page = 0
    @State private var count = 0

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 8) {
                Menu {
                    ForEach(lib.books.filter { $0.type != "epub" }) { b in Button(cleanTitle(b.name)) { bookID = b.id } }
                } label: {
                    HStack(spacing: 4) {
                        Image(systemName: "book.closed")
                        Text(bookID.flatMap { id in lib.books.first { $0.id == id } }.map { cleanTitle($0.name) } ?? "Choose a book").lineLimit(1)
                        Image(systemName: "chevron.down").font(.system(size: 10, weight: .semibold))
                    }
                    .font(Theme.ui(14, .semibold)).foregroundStyle(Theme.fg).padding(.horizontal, 10).frame(height: 32).frame(maxWidth: 190).background(Theme.panel2, in: Capsule())
                }
                Spacer()
                if bookID != nil {
                    IconButton(symbol: "sparkles", label: "Ask about this page", tint: Theme.accent, size: 36) { ask() }
                    Button { insert() } label: {
                        Label("Insert", systemImage: "photo.badge.plus").font(Theme.ui(13, .semibold)).foregroundStyle(.white).padding(.horizontal, 12).frame(height: 32).background(Theme.accent, in: Capsule())
                    }.buttonStyle(.plain).disabled(AppState.shared.editor == nil)
                }
                IconButton(symbol: "xmark", label: "Close", size: 34) { withAnimation(.snappy(duration: 0.22)) { AppState.shared.besideOpen = false } }
            }
            .padding(10).padding(.top, 6)
            if let id = bookID {
                BookPDF(pdf: pdf, bookID: id, page: $page, count: $count)
                Text("Page \(page + 1) of \(count)").font(Theme.num(11)).foregroundStyle(Theme.muted).padding(6)
            } else {
                VStack(spacing: 10) {
                    Image(systemName: "books.vertical").font(.system(size: 34)).foregroundStyle(Theme.faint)
                    Text("Choose a book to read beside your notes.").font(Theme.ui(14)).foregroundStyle(Theme.muted)
                }.frame(maxHeight: .infinity)
            }
        }
        .frame(width: width)
        .background(Theme.panel)
        .overlay(alignment: .leading) { Rectangle().fill(Theme.line).frame(width: 0.5) }
        .onChange(of: bookID) { _, id in AppState.shared.besideBook = id }
    }

    private func pageImage() -> UIImage? {
        guard let p = pdf.currentPage else { return nil }
        let b = p.bounds(for: .cropBox)
        let s = min(3, 1800 / max(b.width, 1))
        return p.thumbnail(of: CGSize(width: b.width * s, height: b.height * s), for: .cropBox)
    }
    private func insert() {
        guard let img = pageImage() else { return }
        AppState.shared.editor?.insertImage(img)
        AppState.shared.say("Page added", 1.2)
    }
    private func ask() {
        guard let img = pageImage(), let id = bookID, let b = lib.books.first(where: { $0.id == id }) else { return }
        AppState.shared.besideOpen = false
        Tutor.shared.ask("Explain this page.", about: .bookRegion(bookID: id, title: cleanTitle(b.name), page: page, text: "", image: img, pageText: pdf.currentPage?.string ?? ""))
    }
}

struct BookPDF: UIViewRepresentable {
    let pdf: PDFView
    let bookID: String
    @Binding var page: Int
    @Binding var count: Int
    func makeUIView(context: Context) -> PDFView {
        pdf.displayMode = .singlePageContinuous
        pdf.autoScales = true
        pdf.backgroundColor = .clear
        NotificationCenter.default.addObserver(context.coordinator, selector: #selector(Coord.changed), name: .PDFViewPageChanged, object: pdf)
        load(context.coordinator)
        return pdf
    }
    func updateUIView(_ v: PDFView, context: Context) { if context.coordinator.loaded != bookID { load(context.coordinator) } }
    private func load(_ c: Coord) {
        c.loaded = bookID
        c.parent = self
        guard let b = Library.shared.books.first(where: { $0.id == bookID }), let data = Store.shared.loadFile(b.fileID) else { return }
        let doc: PDFDocument?
        if b.type == "image", let img = UIImage(data: data) { let d = PDFDocument(); if let p = PDFPage(image: img) { d.insert(p, at: 0) }; doc = d } else { doc = PDFDocument(data: data) }
        pdf.document = doc
        let n = doc?.pageCount ?? 0
        DispatchQueue.main.async { count = n }
        if let p = doc?.page(at: max(0, b.lastPage - 1)) { DispatchQueue.main.asyncAfter(deadline: .now() + 0.15) { pdf.go(to: p) } }
    }
    func makeCoordinator() -> Coord { Coord() }
    final class Coord: NSObject {
        var loaded = ""
        var parent: BookPDF?
        @objc func changed() {
            guard let p = parent, let doc = p.pdf.document, let cur = p.pdf.currentPage else { return }
            p.page = doc.index(for: cur)
        }
    }
}
