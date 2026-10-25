import SwiftUI

struct NewNotebookSheet: View {
    @Environment(Library.self) private var lib
    @Environment(\.dismiss) private var dismiss
    var defaultSubject: String?
    let onCreate: (String) -> Void

    @State private var name = ""
    @State private var template: PaperTemplate = .lined
    @State private var format: PageFormat = .a4
    @State private var landscape = false
    @State private var color = "#ffffff"
    @State private var subject: String?

    private let colors: [(String, String)] = [("#ffffff", "White"), ("#f8f5ec", "Ivory"), ("#eef1f4", "Mist"), ("#2a2e36", "Slate"), ("#15171c", "Night")]
    private let shown: [PaperTemplate] = [.blank, .lined, .narrow, .dot, .grid, .graph, .cornell, .eng, .iso, .music, .todo, .polar]

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 22) {
                    TextField("Untitled notebook", text: $name)
                        .font(Theme.title(28)).textFieldStyle(.plain)
                    label("Paper")
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 96), spacing: 14)], spacing: 14) {
                        ForEach(shown) { t in
                            Button { template = t } label: {
                                VStack(spacing: 6) {
                                    PaperPreview(template: t.rawValue, color: color, landscape: landscape)
                                        .frame(height: landscape ? 72 : 120)
                                        .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(template == t ? Theme.accent : Theme.line, lineWidth: template == t ? 2.5 : 0.5))
                                    Text(t.label).font(Theme.ui(12, template == t ? .semibold : .regular)).foregroundStyle(template == t ? Theme.accent : Theme.muted)
                                }
                            }.buttonStyle(.plain)
                        }
                    }
                    HStack(spacing: 28) {
                        VStack(alignment: .leading, spacing: 8) {
                            label("Colour")
                            HStack(spacing: 10) {
                                ForEach(colors, id: \.0) { c in
                                    Button { color = c.0 } label: {
                                        Circle().fill(Color(uiColor: UIColor(css: c.0))).frame(width: 30, height: 30)
                                            .overlay(Circle().strokeBorder(Theme.lineStrong, lineWidth: 0.5))
                                            .overlay(Circle().strokeBorder(Theme.accent, lineWidth: color == c.0 ? 2.5 : 0).padding(-4))
                                    }.buttonStyle(.plain).accessibilityLabel(c.1)
                                }
                            }
                        }
                        VStack(alignment: .leading, spacing: 8) {
                            label("Size")
                            Picker("Size", selection: $format) { ForEach(PageFormat.allCases) { Text($0.name).tag($0) } }.pickerStyle(.menu)
                        }
                        VStack(alignment: .leading, spacing: 8) {
                            label("Orientation")
                            Picker("Orientation", selection: $landscape) { Text("Portrait").tag(false); Text("Landscape").tag(true) }.pickerStyle(.segmented).frame(width: 220)
                        }
                    }
                    if !lib.subjects.isEmpty {
                        label("Course")
                        ScrollView(.horizontal, showsIndicators: false) {
                            HStack(spacing: 8) {
                                chip("None", nil)
                                ForEach(lib.subjects) { s in chip(s.name, s.id, Color(uiColor: s.uiColor)) }
                            }
                        }
                    }
                }
                .padding(28)
            }
            .navigationTitle("New notebook").navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Create") {
                        let id = lib.newNotebook(name: name.trimmingCharacters(in: .whitespaces).isEmpty ? "Untitled notebook" : name, format: format, landscape: landscape, template: template, color: color, subject: subject)
                        onCreate(id)
                    }.bold()
                }
            }
        }
        .onAppear { subject = defaultSubject }
    }

    private func label(_ t: String) -> some View { Text(t.uppercased()).font(Theme.label()).tracking(0.8).foregroundStyle(Theme.muted) }
    private func chip(_ t: String, _ id: String?, _ c: Color? = nil) -> some View {
        Button { subject = id } label: {
            HStack(spacing: 6) {
                if let c { Circle().fill(c).frame(width: 8, height: 8) }
                Text(t).font(Theme.ui(14, subject == id ? .semibold : .regular))
            }
            .padding(.horizontal, 12).frame(height: 34)
            .foregroundStyle(subject == id ? Theme.accent : Theme.fg)
            .background(subject == id ? Theme.accentSoft : Theme.panel2, in: Capsule())
        }.buttonStyle(.plain)
    }
}

/// A small live drawing of a paper template.
struct PaperPreview: View {
    let template: String
    let color: String
    var landscape = false
    var body: some View {
        Canvas { ctx, size in
            let page = PageFormat.a4.size(landscape: landscape)
            let s = min(size.width / page.width, size.height / page.height)
            let w = page.width * s, h = page.height * s
            let rect = CGRect(x: (size.width - w) / 2, y: (size.height - h) / 2, width: w, height: h)
            let bg = UIColor(css: color)
            ctx.fill(Path(roundedRect: rect, cornerRadius: 4), with: .color(Color(uiColor: bg)))
            ctx.withCGContext { cg in
                cg.saveGState()
                cg.translateBy(x: rect.minX, y: rect.minY); cg.scaleBy(x: s, y: s)
                PaperRenderer.drawTemplate(cg, rect: CGRect(origin: .zero, size: page), template: template, bg: bg, hair: 1 / s * 0.9)
                cg.restoreGState()
            }
        }
    }
}
