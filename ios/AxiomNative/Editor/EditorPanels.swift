import PencilKit
import SwiftUI

// MARK: - pages sidebar

struct PagesSidebar: View {
    let controller: EditorController
    @Bindable var model: EditorModel
    @State private var onlyBookmarks = false
    @State private var thumbs: [String: UIImage] = [:]

    var body: some View {
        VStack(spacing: 10) {
            Picker("", selection: $onlyBookmarks) { Text("All pages").tag(false); Text("Bookmarked").tag(true) }.pickerStyle(.segmented)
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(spacing: 14) {
                        ForEach(Array(controller.doc.pages.enumerated()), id: \.element.id) { i, page in
                            if !onlyBookmarks || page.bookmark { pageCell(i, page).id(page.id) }
                        }
                    }
                    .padding(.vertical, 6)
                }
                .onAppear { if controller.doc.pages.indices.contains(model.page) { proxy.scrollTo(controller.doc.pages[model.page].id, anchor: .center) } }
            }
            Button { controller.insertPage(at: controller.doc.pages.count); controller.surface.scrollTo(page: controller.doc.pages.count - 1) } label: {
                Label("Add page", systemImage: "plus").font(Theme.ui(14, .medium)).frame(maxWidth: .infinity).frame(height: 38)
            }.buttonStyle(.bordered)
        }
        .padding(12)
        .frame(width: 168)
        .floating(18)
        .padding(.leading, 12)
        .task(id: model.pageCount) { await renderThumbs() }
        .task(id: model.canUndo) { await renderThumbs() }
    }

    private func pageCell(_ i: Int, _ page: PageInfo) -> some View {
        let size = controller.doc.pageSize
        return VStack(spacing: 4) {
            Button { controller.surface.scrollTo(page: i) } label: {
                Color(uiColor: UIColor(css: controller.doc.color(of: i)))
                    .aspectRatio(size.width / size.height, contentMode: .fit)
                    .overlay { if let t = thumbs[page.id] { Image(uiImage: t).resizable().scaledToFit() } }
                    .clipShape(RoundedRectangle(cornerRadius: 6))
                    .overlay(RoundedRectangle(cornerRadius: 6).strokeBorder(model.page == i ? Theme.accent : Theme.line, lineWidth: model.page == i ? 2.5 : 0.5))
                    .overlay(alignment: .topTrailing) { if page.bookmark { Image(systemName: "bookmark.fill").foregroundStyle(Theme.danger).font(.system(size: 13)).padding(5) } }
            }
            .buttonStyle(.plain)
            .contextMenu {
                Button("Insert page before", systemImage: "arrow.up.doc") { controller.insertPage(at: i) }
                Button("Insert page after", systemImage: "arrow.down.doc") { controller.insertPage(at: i + 1) }
                Button("Duplicate page", systemImage: "plus.square.on.square") { controller.duplicatePage(i) }
                if i > 0 { Button("Move up", systemImage: "chevron.up") { controller.movePage(i, to: i - 1) } }
                if i < controller.doc.pages.count - 1 { Button("Move down", systemImage: "chevron.down") { controller.movePage(i, to: i + 1) } }
                Button(page.bookmark ? "Remove bookmark" : "Bookmark", systemImage: "bookmark") { controller.toggleBookmark(i) }
                Divider()
                Button("Delete page", systemImage: "trash", role: .destructive) { controller.deletePage(i) }
            }
            Text("\(i + 1)").font(Theme.num(11)).foregroundStyle(model.page == i ? Theme.accent : Theme.muted)
        }
    }

    @MainActor private func renderThumbs() async {
        let doc = controller.doc, drawing = controller.surface.canvas.drawing
        var out: [String: UIImage] = [:]
        for (i, p) in doc.pages.enumerated() {
            if let img = Thumbnail.page(doc: doc, drawing: drawing, index: i, width: 260) { out[p.id] = img }
            if i % 4 == 3 { thumbs.merge(out) { $1 }; await Task.yield() }
        }
        thumbs.merge(out) { $1 }
    }
}

// MARK: - paper

struct PaperSheet: View {
    let controller: EditorController
    @Environment(\.dismiss) private var dismiss
    @State private var thisPage = false
    private let colors = ["#ffffff", "#f8f5ec", "#eef1f4", "#fff8e1", "#e8f4ea", "#2a2e36", "#1c1f25", "#15171c"]
    private let grids: [(String, String)] = [("none", "None"), ("dot", "Dots"), ("graph", "Graph"), ("lined", "Lines"), ("iso", "Isometric")]

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    if controller.doc.isNotebook {
                        Picker("", selection: $thisPage) { Text("All pages").tag(false); Text("Page \(controller.model.page + 1) only").tag(true) }.pickerStyle(.segmented)
                        label("Template")
                        LazyVGrid(columns: [GridItem(.adaptive(minimum: 92), spacing: 12)], spacing: 12) {
                            ForEach(PaperTemplate.allCases) { t in
                                Button { controller.setPaper(template: t.rawValue, color: nil, pageOnly: thisPage ? controller.model.page : nil) } label: {
                                    VStack(spacing: 5) {
                                        PaperPreview(template: t.rawValue, color: controller.doc.color(of: controller.model.page)).frame(height: 110)
                                            .overlay(RoundedRectangle(cornerRadius: 6).strokeBorder(controller.doc.template(of: controller.model.page) == t.rawValue ? Theme.accent : Theme.line, lineWidth: controller.doc.template(of: controller.model.page) == t.rawValue ? 2.5 : 0.5))
                                        Text(t.label).font(Theme.ui(11)).foregroundStyle(Theme.muted)
                                    }
                                }.buttonStyle(.plain)
                            }
                        }
                    } else {
                        label("Grid")
                        Picker("Grid", selection: Binding(get: { controller.doc.gridType }, set: { controller.setCanvasPaper(color: nil, grid: $0) })) { ForEach(grids, id: \.0) { Text($0.1).tag($0.0) } }.pickerStyle(.segmented)
                    }
                    label("Colour")
                    HStack(spacing: 12) {
                        ForEach(colors, id: \.self) { c in
                            Button {
                                if controller.doc.isNotebook { controller.setPaper(template: nil, color: c, pageOnly: thisPage ? controller.model.page : nil) } else { controller.setCanvasPaper(color: c, grid: nil) }
                            } label: { Circle().fill(Color(uiColor: UIColor(css: c))).frame(width: 34, height: 34).overlay(Circle().strokeBorder(Theme.lineStrong, lineWidth: 0.5)) }.buttonStyle(.plain)
                        }
                    }
                }
                .padding(24)
            }
            .navigationTitle("Paper").navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
        }
        .presentationDetents([.medium, .large])
    }
    private func label(_ t: String) -> some View { Text(t.uppercased()).font(Theme.label()).tracking(0.8).foregroundStyle(Theme.muted) }
}

// MARK: - crop

struct CropView: View {
    let element: Element
    let done: (CGRect?) -> Void
    @State private var rect: CGRect = .zero      // in original picture units
    @State private var start: CGRect = .zero
    private var base: CGSize { element.cropBase ?? CGSize(width: element.iw, height: element.ih) }

    var body: some View {
        GeometryReader { geo in
            let img = element.loadImage()
            let avail = CGSize(width: geo.size.width - 80, height: geo.size.height - 200)
            let s = min(avail.width / base.width, avail.height / base.height)
            let shown = CGSize(width: base.width * s, height: base.height * s)
            let ox = (geo.size.width - shown.width) / 2, oy = (geo.size.height - shown.height) / 2 - 20
            let r = CGRect(x: ox + rect.minX * s, y: oy + rect.minY * s, width: rect.width * s, height: rect.height * s)
            ZStack(alignment: .topLeading) {
                Color.black.ignoresSafeArea()
                if let img { Image(uiImage: img).resizable().frame(width: shown.width, height: shown.height).offset(x: ox, y: oy) }
                Path { p in p.addRect(CGRect(origin: .zero, size: geo.size)); p.addRect(r) }.fill(Color.black.opacity(0.55), style: FillStyle(eoFill: true)).allowsHitTesting(false)
                Rectangle().strokeBorder(.white, lineWidth: 2).frame(width: r.width, height: r.height).offset(x: r.minX, y: r.minY)
                    .gesture(DragGesture().onChanged { g in
                        if start == .zero { start = rect }
                        var n = start.offsetBy(dx: g.translation.width / s, dy: g.translation.height / s)
                        n.origin.x = min(max(0, n.minX), base.width - n.width); n.origin.y = min(max(0, n.minY), base.height - n.height)
                        rect = n
                    }.onEnded { _ in start = .zero })
                ForEach(0..<4, id: \.self) { k in
                    let corner = CGPoint(x: k % 2 == 0 ? r.minX : r.maxX, y: k < 2 ? r.minY : r.maxY)
                    Circle().fill(.white).frame(width: 26, height: 26).shadow(radius: 2)
                        .position(corner)
                        .gesture(DragGesture().onChanged { g in
                            if start == .zero { start = rect }
                            let dx = g.translation.width / s, dy = g.translation.height / s
                            var x0 = start.minX, y0 = start.minY, x1 = start.maxX, y1 = start.maxY
                            if k % 2 == 0 { x0 = min(max(0, x0 + dx), x1 - 8) } else { x1 = max(min(base.width, x1 + dx), x0 + 8) }
                            if k < 2 { y0 = min(max(0, y0 + dy), y1 - 8) } else { y1 = max(min(base.height, y1 + dy), y0 + 8) }
                            rect = CGRect(x: x0, y: y0, width: x1 - x0, height: y1 - y0)
                        }.onEnded { _ in start = .zero })
                }
                VStack {
                    Spacer()
                    HStack(spacing: 14) {
                        Button("Cancel") { done(nil) }.buttonStyle(.bordered).tint(.white)
                        Button("Reset") { rect = CGRect(origin: .zero, size: base) }.buttonStyle(.bordered).tint(.white)
                        Button("Crop") { done(rect) }.buttonStyle(.borderedProminent)
                    }
                    .padding(.bottom, 40)
                }
                .frame(width: geo.size.width)
            }
        }
        .onAppear { rect = element.crop ?? CGRect(origin: .zero, size: base) }
    }
}

// MARK: - export

enum Exporter {
    /// every page (or the canvas drawing) as a PDF, shared through the system sheet
    @MainActor static func sharePDF(doc: NoteDocument, drawing: PKDrawing?) {
        let d = drawing ?? doc.loadInk()
        let url = FileManager.default.temporaryDirectory.appendingPathComponent((doc.name.isEmpty ? "Axiom" : doc.name).replacingOccurrences(of: "/", with: "-") + ".pdf")
        let rects: [CGRect]
        if doc.isNotebook { rects = doc.pageRects }
        else {
            let o = doc.origin
            var bb = d.bounds.offsetBy(dx: -o.x, dy: -o.y)
            for e in doc.elements { bb = bb.union(e.bounds) }
            rects = [bb.isNull ? CGRect(x: 0, y: 0, width: 800, height: 600) : bb.insetBy(dx: -30, dy: -30)]
        }
        let renderer = UIGraphicsPDFRenderer(bounds: CGRect(origin: .zero, size: rects.first?.size ?? CGSize(width: 794, height: 1123)))
        try? renderer.writePDF(to: url) { ctx in
            for (i, r) in rects.enumerated() {
                ctx.beginPage(withBounds: CGRect(origin: .zero, size: r.size), pageInfo: [:])
                let img = Thumbnail.region(doc: doc, drawing: d, rect: r, pixelWidth: r.width * 2, background: UIColor(css: doc.isNotebook ? doc.color(of: i) : doc.paperColor), template: doc.isNotebook ? doc.template(of: i) : nil, grid: !doc.isNotebook)
                img?.draw(in: CGRect(origin: .zero, size: r.size))
            }
        }
        let vc = UIActivityViewController(activityItems: [url], applicationActivities: nil)
        guard let root = UIApplication.shared.connectedScenes.compactMap({ ($0 as? UIWindowScene)?.keyWindow }).first?.rootViewController else { return }
        var top = root; while let p = top.presentedViewController { top = p }
        vc.popoverPresentationController?.sourceView = top.view
        vc.popoverPresentationController?.sourceRect = CGRect(x: top.view.bounds.maxX - 60, y: 60, width: 1, height: 1)
        top.present(vc, animated: true)
    }
}

// MARK: - lecture audio

struct RecordingPill: View {
    let controller: EditorController
    @Bindable var audio = LectureAudio.shared
    var body: some View {
        HStack(spacing: 10) {
            Circle().fill(Color.red).frame(width: 10, height: 10).opacity(Int(audio.elapsed * 2) % 2 == 0 ? 1 : 0.35)
            Text(LectureAudio.clock(audio.elapsed)).font(Theme.num(14, .semibold)).foregroundStyle(.white)
            Button { controller.stopRecording() } label: { Label("Stop", systemImage: "stop.fill").font(Theme.ui(13, .semibold)).foregroundStyle(.white).padding(.horizontal, 10).frame(height: 30).background(.white.opacity(0.18), in: Capsule()) }.buttonStyle(.plain)
        }
        .padding(.horizontal, 14).frame(height: 44).background(Color(red: 0.85, green: 0.2, blue: 0.2), in: Capsule())
        .shadow(color: .black.opacity(0.25), radius: 10, y: 4)
    }
}

struct AudioBar: View {
    let controller: EditorController
    @Bindable var model: EditorModel
    var compact = false
    @Bindable var audio = LectureAudio.shared
    @State private var renaming = false
    @State private var newName = ""
    var rec: JSON? { controller.activeRecording }
    var body: some View {
        if let rec, let id = rec.str("id") {
            let dur = max(audio.playingID == id ? audio.duration : 0, rec.num("dur") ?? 0)
            HStack(spacing: 10) {
                Button { audio.toggle(id: id) } label: { Image(systemName: audio.isPlaying && audio.playingID == id ? "pause.fill" : "play.fill").font(.system(size: 16)).frame(width: 34, height: 34) }.buttonStyle(.plain)
                Slider(value: Binding(get: { audio.playingID == id ? audio.time : 0 }, set: { t in if audio.playingID != id { audio.play(id: id, at: t); audio.pause() } else { audio.seek(t) } }), in: 0...max(1, dur))
                    .frame(width: compact ? 110 : 220)
                if !compact { Text("\(LectureAudio.clock(audio.playingID == id ? audio.time : 0)) / \(LectureAudio.clock(dur))").font(Theme.num(12)).foregroundStyle(Theme.muted) }
                Menu {
                    ForEach([0.75, 1, 1.25, 1.5, 2] as [Float], id: \.self) { r in Button { audio.setRate(r) } label: { if audio.rate == r { Label("\(r.formatted())×", systemImage: "checkmark") } else { Text("\(r.formatted())×") } } }
                } label: { Text("\(audio.rate.formatted())×").font(Theme.num(12, .semibold)).padding(.horizontal, 8).frame(height: 28).background(Theme.panel2, in: Capsule()) }
                Menu {
                    Section("Recordings") {
                        ForEach(model.recordings.reversed(), id: \.self.description) { r in
                            Button { model.activeRec = r.str("id"); audio.stopPlayback() } label: {
                                Label("\(r.str("name") ?? "Recording") · \(LectureAudio.clock(r.num("dur") ?? 0))", systemImage: model.activeRec == r.str("id") ? "checkmark" : "waveform")
                            }
                        }
                    }
                    Toggle("Replay ink with the audio", isOn: $model.replayInk)
                    Button("Back 10 seconds", systemImage: "gobackward.10") { audio.seek(audio.time - 10) }
                    Button("Rename this recording", systemImage: "pencil") { newName = rec.str("name") ?? ""; renaming = true }
                    Button("New recording", systemImage: "mic") { audio.stopPlayback(); controller.startRecording() }
                    Divider()
                    Button("Delete this recording", systemImage: "trash", role: .destructive) { controller.deleteRecording(id) }
                } label: {
                    if compact { Image(systemName: "waveform").font(.system(size: 15, weight: .medium)).frame(width: 30, height: 30) }
                    else { Text(rec.str("name") ?? "Recording").font(Theme.ui(13, .medium)).lineLimit(1).frame(maxWidth: 120) }
                }
            }
            .padding(.horizontal, 12).padding(.vertical, 6).floating(16)
            .alert("Rename recording", isPresented: $renaming) {
                TextField("Name", text: $newName)
                Button("Cancel", role: .cancel) {}
                Button("Rename") { controller.renameRecording(id, newName) }
            }
        }
    }
}
