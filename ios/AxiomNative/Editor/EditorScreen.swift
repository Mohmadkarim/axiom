import PhotosUI
import SwiftUI
import UniformTypeIdentifiers

/// Holds the editor's UIKit controller so the SwiftUI bars can talk to it.
@Observable
final class EditorSession {
    let model = EditorModel()
    var controller: EditorController?
    let doc: NoteDocument?
    init(docID: String) {
        doc = NoteDocument(id: docID)
        model.load()
        if let d = doc {
            model.title = d.name
            model.isNotebook = d.isNotebook
            if !d.isNotebook, let i = model.slots.firstIndex(where: { $0.kind == .pen && $0.color == "#16181d" }) { model.slots[i].color = "#e8eaee" }
        }
    }
}

struct EditorScreen: View {
    let docID: String
    @Environment(AppState.self) private var app
    @Environment(Library.self) private var lib
    @State private var session: EditorSession
    @State private var photoItem: PhotosPickerItem?
    @State private var showPhotos = false
    @State private var showCamera = false
    @State private var importing = false
    @State private var renaming = false
    @State private var newName = ""
    @State private var paperSheet = false
    @State private var cropTarget: Element?

    init(docID: String) {
        self.docID = docID
        _session = State(initialValue: EditorSession(docID: docID))
    }

    private var model: EditorModel { session.model }

    var body: some View {
        ZStack {
            if session.doc != nil {
                EditorHost(session: session).ignoresSafeArea()
                overlays
            } else {
                VStack(spacing: 12) {
                    Text("This notebook could not be opened.").font(Theme.ui(17, .medium))
                    Button("Back to the library") { app.close() }
                }
            }
        }
        .background(Theme.bg)
        .photosPicker(isPresented: $showPhotos, selection: $photoItem, matching: .images)
        .onChange(of: photoItem) { _, item in
            guard let item else { return }
            Task {
                if let data = try? await item.loadTransferable(type: Data.self), let img = UIImage(data: data) { await MainActor.run { session.controller?.insertImage(img) } }
                photoItem = nil
            }
        }
        .fullScreenCover(isPresented: $showCamera) { CameraPicker { img in showCamera = false; if let img { session.controller?.insertImage(img) } }.ignoresSafeArea() }
        .fileImporter(isPresented: $importing, allowedContentTypes: [.image, .pdf]) { res in
            guard case .success(let url) = res else { return }
            if url.pathExtension.lowercased() == "pdf" { session.controller?.insertPDF(url) }
            else {
                let ok = url.startAccessingSecurityScopedResource(); defer { if ok { url.stopAccessingSecurityScopedResource() } }
                if let d = try? Data(contentsOf: url), let img = UIImage(data: d) { session.controller?.insertImage(img) }
            }
        }
        .alert("Rename", isPresented: $renaming) {
            TextField("Name", text: $newName)
            Button("Cancel", role: .cancel) {}
            Button("Rename") { let n = newName.trimmingCharacters(in: .whitespaces); if !n.isEmpty { session.doc?.name = n; model.title = n; session.controller?.scheduleSave() } }
        }
        .sheet(isPresented: $paperSheet) { if let c = session.controller { PaperSheet(controller: c) } }
        .fullScreenCover(item: Binding(get: { cropTarget.map { CropItem(element: $0) } }, set: { cropTarget = $0?.element })) { item in
            CropView(element: item.element) { rect in
                cropTarget = nil
                if let r = rect { session.controller?.applyCrop(item.element, rect: r) }
            }
        }
    }

    // MARK: bars

    @ViewBuilder private var overlays: some View {
        VStack(spacing: 0) {
            HStack(alignment: .top) {
                titleBar
                Spacer()
                actionBar
            }
            .padding(.horizontal, 14).padding(.top, 10)
            Spacer()
            if model.isNotebook { HStack { pageCounter; Spacer() }.padding(.horizontal, 14).padding(.bottom, 14) }
        }
        HStack {
            if model.showPages, let c = session.controller { PagesSidebar(controller: c, model: model).transition(.move(edge: .leading).combined(with: .opacity)) }
            Spacer()
            ToolRail(model: model, onTool: { session.controller?.applyTool() }, insert: insertMenu)
                .padding(.trailing, 12)
        }
        .padding(.top, 70).padding(.bottom, 16)
        if let sel = model.selection, sel.frame != .zero, !model.editingText { SelectionBar(info: sel, controller: session.controller, crop: { cropTarget = session.controller?.selectedImageElement }) }
        if model.editingText, let c = session.controller { VStack { TextFormatBar(controller: c).padding(.top, 70); Spacer() } }
        if let p = model.menuAt, let c = session.controller { PageMenu(at: p, controller: c, model: model, photo: { showPhotos = true }) }
    }

    private var titleBar: some View {
        HStack(spacing: 4) {
            IconButton(symbol: "chevron.left", label: "Back to the library") { session.controller?.flush(); app.close() }
            Button { newName = model.title; renaming = true } label: {
                VStack(alignment: .leading, spacing: 1) {
                    Text(model.title).font(Theme.ui(15, .semibold)).foregroundStyle(Theme.fg).lineLimit(1)
                    Text(subtitle).font(Theme.ui(11)).foregroundStyle(Theme.muted).lineLimit(1)
                }
                .frame(maxWidth: 260, alignment: .leading)
            }.buttonStyle(.plain).padding(.trailing, 12)
        }
        .padding(4).floating()
    }
    private var subtitle: String {
        guard let d = session.doc else { return "" }
        let course = lib.subject(d.subject)?.name
        let kind = d.isNotebook ? d.format.name : "Canvas · " + model.zoomText
        return [course, kind].compactMap { $0 }.joined(separator: " · ")
    }

    private var actionBar: some View {
        HStack(spacing: 2) {
            IconButton(symbol: "arrow.uturn.backward", label: "Undo", tint: model.canUndo ? Theme.fg : Theme.faint) { session.controller?.performUndo() }.disabled(!model.canUndo)
            IconButton(symbol: "arrow.uturn.forward", label: "Redo", tint: model.canRedo ? Theme.fg : Theme.faint) { session.controller?.performRedo() }.disabled(!model.canRedo)
            Rectangle().fill(Theme.lineStrong).frame(width: 1, height: 22).padding(.horizontal, 4)
            if model.isNotebook {
                IconButton(symbol: "rectangle.portrait.on.rectangle.portrait", label: "Pages", on: model.showPages) { withAnimation(.snappy(duration: 0.22)) { model.showPages.toggle() } }
            }
            Menu {
                Button(model.isNotebook ? "Paper and page size" : "Paper", systemImage: "doc.richtext") { paperSheet = true }
                Toggle(isOn: Binding(get: { model.ruler }, set: { model.ruler = $0; session.controller?.applyTool() })) { Label("Ruler", systemImage: "ruler") }
                Toggle(isOn: Binding(get: { model.shapes }, set: { model.shapes = $0; Library.shared.set("shapeHold", $0) })) { Label("Draw and hold for shapes", systemImage: "circle.square") }
                Toggle(isOn: Binding(get: { model.fingerDraws }, set: { model.fingerDraws = $0; Library.shared.set("fingerAction", $0 ? "draw" : "auto"); session.controller?.applyTool() })) { Label("Draw with finger", systemImage: "hand.draw") }
                Divider()
                Button("Share as PDF", systemImage: "square.and.arrow.up") { session.controller?.flush(); if let d = session.doc { Exporter.sharePDF(doc: d, drawing: session.controller?.surface.canvas.drawing) } }
            } label: {
                Image(systemName: "ellipsis").font(.system(size: 17, weight: .medium)).foregroundStyle(Theme.fg).frame(width: 40, height: 40).contentShape(Rectangle())
            }
        }
        .padding(4).floating()
    }

    private var pageCounter: some View {
        HStack(spacing: 2) {
            IconButton(symbol: "chevron.up", label: "Previous page", size: 34) { session.controller?.surface.scrollTo(page: max(0, model.page - 1)) }
            Text("\(model.page + 1) / \(model.pageCount)").font(Theme.num(13)).foregroundStyle(Theme.fg).frame(minWidth: 54)
            IconButton(symbol: "chevron.down", label: "Next page", size: 34) { session.controller?.surface.scrollTo(page: min(model.pageCount - 1, model.page + 1)) }
        }
        .padding(3).floating(14)
    }

    @ViewBuilder private func insertMenu() -> some View {
        Button("Photo or picture", systemImage: "photo") { showPhotos = true }
        Button("Camera", systemImage: "camera") { showCamera = true }
        Button("From Files (picture or PDF)", systemImage: "folder") { importing = true }
        Button("Sticky note", systemImage: "note.text") { session.controller?.insertStickyNote() }
        if model.isNotebook { Button("New page", systemImage: "doc.badge.plus") { if let c = session.controller { c.insertPage(at: model.page + 1); c.surface.scrollTo(page: model.page + 1) } } }
        Divider()
        Button("Laser pointer", systemImage: "cursorarrow.rays") { model.addOrSelect(.laser); session.controller?.applyTool() }
        Button(model.ruler ? "Put the ruler away" : "Ruler", systemImage: "ruler") { model.ruler.toggle(); session.controller?.applyTool() }
    }
}

struct CropItem: Identifiable { let element: Element; var id: String { element.id } }

extension EditorModel {
    /// a tool that is not on the rail (laser) is added for the moment
    func addOrSelect(_ kind: ToolKind) {
        if let i = slots.firstIndex(where: { $0.kind == kind }) { select(i); return }
        var s = ToolSlot(id: (slots.map(\.id).max() ?? 0) + 1, kind: kind, color: ToolSlot.palettes[kind]?.first ?? "#ff3b30", size: 6)
        s.opacity = 1
        slots.append(s)
        select(slots.count - 1)
    }
}

/// The UIKit editor inside SwiftUI.
struct EditorHost: UIViewControllerRepresentable {
    let session: EditorSession
    func makeUIViewController(context: Context) -> EditorController {
        let c = EditorController(doc: session.doc!, model: session.model)
        session.controller = c
        return c
    }
    func updateUIViewController(_ c: EditorController, context: Context) {}
    static func dismantleUIViewController(_ c: EditorController, coordinator: ()) { c.flush() }
}

// MARK: - tool rail

struct ToolRail<Insert: View>: View {
    @Bindable var model: EditorModel
    let onTool: () -> Void
    @ViewBuilder let insert: () -> Insert

    var body: some View {
        VStack(spacing: 4) {
            ForEach(model.slots) { slot in
                let i = model.slots.firstIndex(of: slot) ?? 0
                Button {
                    model.select(i); onTool()
                } label: {
                    ZStack(alignment: .bottomTrailing) {
                        Image(systemName: slot.symbol)
                            .font(.system(size: 18, weight: .medium))
                            .foregroundStyle(model.active == i ? Theme.accent : Theme.fg)
                            .frame(width: 44, height: 44)
                            .background(model.active == i ? Theme.accentSoft : .clear, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                        if slot.hasColor {
                            Circle().fill(Color(uiColor: slot.uiColor)).frame(width: 9, height: 9)
                                .overlay(Circle().strokeBorder(.white.opacity(0.6), lineWidth: 0.5)).offset(x: -6, y: -6)
                        }
                    }
                }
                .buttonStyle(.plain)
                .accessibilityLabel(slot.kind.rawValue)
                .popover(isPresented: Binding(get: { model.flyout == i }, set: { if !$0 && model.flyout == i { model.flyout = nil } }), attachmentAnchor: .rect(.bounds), arrowEdge: .trailing) {
                    ToolOptions(model: model, index: i, onChange: onTool).presentationCompactAdaptation(.popover)
                }
            }
            Rectangle().fill(Theme.lineStrong).frame(width: 26, height: 1).padding(.vertical, 4)
            Menu { insert() } label: {
                Image(systemName: "plus").font(.system(size: 18, weight: .medium)).foregroundStyle(Theme.fg).frame(width: 44, height: 44).contentShape(Rectangle())
            }
            .accessibilityLabel("Insert")
        }
        .padding(5).floating(18)
    }
}

/// Colour, size and type of the active tool.
struct ToolOptions: View {
    @Bindable var model: EditorModel
    let index: Int
    let onChange: () -> Void
    @State private var custom = Color.black

    var slot: ToolSlot { model.slots[index] }
    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            if slot.kind == .pen {
                Picker("Pen", selection: binding(\.ink)) {
                    Text("Pen").tag("pen"); Text("Fountain").tag("fountain"); Text("Pencil").tag("pencil"); Text("Fine liner").tag("monoline"); Text("Crayon").tag("crayon")
                }.pickerStyle(.segmented)
            }
            if slot.kind == .eraser {
                Picker("Eraser", selection: binding(\.eraseWhole)) { Text("Whole strokes").tag(true); Text("Partial").tag(false) }.pickerStyle(.segmented)
            }
            if slot.kind == .text {
                Picker("Font", selection: binding(\.font)) { Text("Sans").tag("sans"); Text("Serif").tag("serif"); Text("Mono").tag("mono"); Text("Round").tag("round") }.pickerStyle(.segmented)
            }
            if let palette = ToolSlot.palettes[slot.kind] {
                HStack(spacing: 10) {
                    ForEach(palette, id: \.self) { c in
                        Button { model.slots[index].color = c; model.save(); onChange() } label: {
                            Circle().fill(Color(uiColor: UIColor(css: c))).frame(width: 30, height: 30)
                                .overlay(Circle().strokeBorder(Theme.lineStrong, lineWidth: 0.5))
                                .overlay(Circle().strokeBorder(Theme.accent, lineWidth: slot.color == c ? 2.5 : 0).padding(-4))
                        }.buttonStyle(.plain)
                    }
                    ColorPicker("", selection: Binding(get: { Color(uiColor: slot.uiColor) }, set: { model.slots[index].color = UIColor($0).cssHex; model.save(); onChange() }), supportsOpacity: false).labelsHidden()
                }
            }
            if let sizes = ToolSlot.sizes[slot.kind], slot.kind != .eraser || !slot.eraseWhole {
                HStack(spacing: 12) {
                    ForEach(sizes, id: \.self) { s in
                        Button { model.slots[index].size = s; model.save(); onChange() } label: {
                            Capsule().fill(Theme.fg).frame(width: 34, height: max(2, min(14, s * (slot.kind == .highlighter ? 0.45 : 1.6))))
                                .frame(width: 52, height: 40)
                                .background(abs(slot.size - s) < 0.01 ? Theme.accentSoft : Theme.panel2, in: RoundedRectangle(cornerRadius: 10))
                        }.buttonStyle(.plain)
                    }
                }
            }
        }
        .padding(16).frame(width: 330)
    }
    private func binding<T>(_ kp: WritableKeyPath<ToolSlot, T>) -> Binding<T> {
        Binding(get: { model.slots[index][keyPath: kp] }, set: { model.slots[index][keyPath: kp] = $0; model.save(); onChange() })
    }
}

// MARK: - selection bar

struct SelectionBar: View {
    let info: SelectionInfo
    let controller: EditorController?
    let crop: () -> Void
    var body: some View {
        GeometryReader { geo in
            let w: CGFloat = info.canCrop ? 300 : 264
            let above = info.frame.minY - 62 > 70
            let y = above ? info.frame.minY - 34 - 18 : min(geo.size.height - 120, info.frame.maxY + 34 + 18)
            let x = min(max(info.frame.midX, w / 2 + 12), geo.size.width - w / 2 - 70)
            HStack(spacing: 2) {
                IconButton(symbol: "plus.square.on.square", label: "Duplicate") { controller?.duplicateSelection() }
                IconButton(symbol: "doc.on.doc", label: "Copy") { controller?.copySelection() }
                IconButton(symbol: "trash", label: "Delete", tint: Theme.danger) { controller?.deleteSelection() }
                if info.canCrop { IconButton(symbol: "crop", label: "Crop picture") { crop() } }
                if info.strokes > 0 || info.texts > 0 {
                    Menu {
                        ForEach(ToolSlot.palettes[.pen]!, id: \.self) { c in
                            Button { controller?.recolorSelection(c) } label: { Label(c, systemImage: "circle.fill") }.tint(Color(uiColor: UIColor(css: c)))
                        }
                    } label: { Image(systemName: "paintpalette").font(.system(size: 16, weight: .medium)).foregroundStyle(Theme.fg).frame(width: 40, height: 40) }
                }
                Rectangle().fill(Theme.lineStrong).frame(width: 1, height: 22).padding(.horizontal, 2)
                Menu {
                    Button("Cut", systemImage: "scissors") { controller?.copySelection(cut: true) }
                    Button("Flip horizontally", systemImage: "arrow.left.and.right.righttriangle.left.righttriangle.right") { controller?.flipSelection(horizontal: true) }
                    Button("Flip vertically", systemImage: "arrow.up.and.down.righttriangle.up.righttriangle.down") { controller?.flipSelection(horizontal: false) }
                    if info.images + info.texts > 0 {
                        Button("Bring to front", systemImage: "square.3.layers.3d.top.filled") { controller?.arrangeSelection(front: true) }
                        Button("Send to back", systemImage: "square.3.layers.3d.bottom.filled") { controller?.arrangeSelection(front: false) }
                    }
                } label: { Image(systemName: "ellipsis").font(.system(size: 16, weight: .medium)).foregroundStyle(Theme.fg).frame(width: 40, height: 40) }
            }
            .padding(3).floating(14)
            .position(x: x, y: y)
        }
        .allowsHitTesting(true)
    }
}

// MARK: - text format bar

struct TextFormatBar: View {
    let controller: EditorController
    var body: some View {
        HStack(spacing: 4) {
            Button { controller.changeText { e in let fonts = ["sans", "serif", "mono", "round"]; e.font = fonts[((fonts.firstIndex(of: e.font) ?? 0) + 1) % fonts.count] } } label: {
                Text("Aa").font(.system(size: 16, weight: .semibold)).foregroundStyle(Theme.fg).frame(width: 40, height: 40)
            }.buttonStyle(.plain)
            IconButton(symbol: "minus", label: "Smaller") { controller.changeText { $0.fontSize = max(8, ($0.fontSize / 1.15).rounded()) } }
            IconButton(symbol: "plus", label: "Larger") { controller.changeText { $0.fontSize = min(160, ($0.fontSize * 1.15).rounded()) } }
            ForEach(ToolSlot.palettes[.text]!, id: \.self) { c in
                Button { controller.changeText { $0.color = c } } label: { Circle().fill(Color(uiColor: UIColor(css: c))).frame(width: 24, height: 24).overlay(Circle().strokeBorder(Theme.lineStrong, lineWidth: 0.5)) }.buttonStyle(.plain).padding(.horizontal, 2)
            }
            Rectangle().fill(Theme.lineStrong).frame(width: 1, height: 22).padding(.horizontal, 4)
            IconButton(symbol: "trash", label: "Delete text box", tint: Theme.danger) { controller.deleteEditingText() }
            Button("Done") { controller.endTextEdit() }.font(Theme.ui(15, .semibold)).padding(.horizontal, 12)
        }
        .padding(4).floating()
    }
}

// MARK: - press-and-hold page menu

struct PageMenu: View {
    let at: CGPoint
    let controller: EditorController
    let model: EditorModel
    let photo: () -> Void
    var body: some View {
        ZStack(alignment: .topLeading) {
            Color.black.opacity(0.001).onTapGesture { model.menuAt = nil }
            VStack(alignment: .leading, spacing: 0) {
                if model.menuHasPaste { row("Paste", "doc.on.clipboard") { controller.paste(at: controller.menuWorld) } }
                if model.menuHasImage && !model.menuHasPaste { row("Paste picture", "photo.on.rectangle") { controller.paste(at: controller.menuWorld) } }
                row("Text here", "textformat") { controller.beginTextAt(controller.menuWorld) }
                row("Insert picture", "photo") { photo() }
                if model.isNotebook { row("New page after this one", "doc.badge.plus") { controller.insertPage(at: model.page + 1) } }
            }
            .padding(6).frame(width: 240).floating(14)
            .offset(x: min(at.x, UIScreen.main.bounds.width - 260), y: at.y + 8)
        }
        .ignoresSafeArea()
    }
    private func row(_ t: String, _ icon: String, _ action: @escaping () -> Void) -> some View {
        Button { model.menuAt = nil; action() } label: {
            Label(t, systemImage: icon).font(Theme.ui(15)).foregroundStyle(Theme.fg).frame(maxWidth: .infinity, alignment: .leading).padding(.horizontal, 12).frame(height: 42).contentShape(Rectangle())
        }.buttonStyle(.plain)
    }
}

extension EditorController {
    func beginTextAt(_ w: CGPoint) {
        if let i = model.slots.firstIndex(where: { $0.kind == .text }) { model.select(i); applyTool() }
        let t = model.tool
        let e = Element.textBox(at: CGPoint(x: w.x, y: w.y - t.size * 0.8), width: min(420, max(220, surface.bounds.width * 0.4 / surface.zoom)), size: t.size, color: t.color, font: t.font)
        let before = snapshot()
        doc.elements.append(e)
        surface.addElementView(e)
        beginTextEditNew(e, before: before)
    }
}

// MARK: - camera

struct CameraPicker: UIViewControllerRepresentable {
    let done: (UIImage?) -> Void
    func makeUIViewController(context: Context) -> UIImagePickerController {
        let p = UIImagePickerController()
        p.sourceType = UIImagePickerController.isSourceTypeAvailable(.camera) ? .camera : .photoLibrary
        p.delegate = context.coordinator
        return p
    }
    func updateUIViewController(_ c: UIImagePickerController, context: Context) {}
    func makeCoordinator() -> Coord { Coord(done: done) }
    final class Coord: NSObject, UIImagePickerControllerDelegate, UINavigationControllerDelegate {
        let done: (UIImage?) -> Void
        init(done: @escaping (UIImage?) -> Void) { self.done = done }
        func imagePickerController(_ p: UIImagePickerController, didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]) { done(info[.originalImage] as? UIImage) }
        func imagePickerControllerDidCancel(_ p: UIImagePickerController) { done(nil) }
    }
}
