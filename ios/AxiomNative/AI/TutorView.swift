import SwiftUI

/// The tutor beside the page: one conversation per notebook or book, answers with real math, interactive practice.
struct TutorPanel: View {
    @Bindable var tutor = Tutor.shared
    @Environment(Library.self) private var lib
    @State private var showSettings = false
    @FocusState private var focused: Bool

    var body: some View {
        VStack(spacing: 0) {
            header
            Divider().overlay(Theme.line)
            if !Claude.hasKey && tutor.messages.isEmpty { setupCard }
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 16) {
                        if tutor.messages.isEmpty && Claude.hasKey { emptyState }
                        ForEach(tutor.messages) { m in bubble(m).id(m.id) }
                        if let s = tutor.status { HStack(spacing: 8) { ProgressView(); Text(s).font(Theme.ui(13)).foregroundStyle(Theme.muted) } }
                        Color.clear.frame(height: 1).id("end")
                    }
                    .padding(16)
                }
                .onChange(of: tutor.messages.last?.text.count) { _, _ in proxy.scrollTo("end", anchor: .bottom) }
                .onAppear { proxy.scrollTo("end", anchor: .bottom) }
            }
            input
        }
        .frame(width: 430)
        .background(.regularMaterial)
        .overlay(alignment: .leading) { Rectangle().fill(Theme.line).frame(width: 0.5) }
        .sheet(isPresented: $showSettings) { SettingsView() }
    }

    private var header: some View {
        HStack(spacing: 6) {
            Image(systemName: "sparkles").foregroundStyle(Theme.accent)
            VStack(alignment: .leading, spacing: 0) {
                Text("Tutor").font(Theme.ui(16, .semibold))
                if !tutor.title.isEmpty { Text(tutor.title).font(Theme.ui(11)).foregroundStyle(Theme.muted).lineLimit(1) }
            }
            Spacer()
            Menu {
                Picker("Mode", selection: $tutor.mode) { ForEach(TutorMode.allCases, id: \.self) { Text($0.label).tag($0) } }
                Toggle("Search the web", isOn: $tutor.web)
                Divider()
                Button("New conversation", systemImage: "square.and.pencil") { tutor.newChat() }
            } label: {
                HStack(spacing: 4) { Text(tutor.mode.label).font(Theme.ui(13, .medium)); Image(systemName: "chevron.down").font(.system(size: 10, weight: .semibold)) }
                    .foregroundStyle(Theme.fg).padding(.horizontal, 10).frame(height: 32).background(Theme.panel2, in: Capsule())
            }
            IconButton(symbol: "xmark", label: "Close the tutor", size: 34) { withAnimation(.snappy(duration: 0.22)) { tutor.isOpen = false } }
        }
        .padding(.horizontal, 14).padding(.vertical, 10).padding(.top, 6)
    }

    private var emptyState: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Ask about what you're reading or writing.").font(Theme.ui(15, .medium))
            Text("Circle a passage in a book, or ask here; the page on screen is attached when you tap the page button.").font(Theme.ui(13)).foregroundStyle(Theme.muted)
            ForEach(["Explain this page", "Give me a hint for the next step", "Quiz me on this section"], id: \.self) { s in
                Button { tutor.draft = s; tutor.sendDraft(attachPage: true) } label: {
                    Text(s).font(Theme.ui(14)).padding(.horizontal, 12).frame(height: 36).background(Theme.panel2, in: Capsule())
                }.buttonStyle(.plain)
            }
        }
        .padding(.top, 8)
    }

    private var setupCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Choose how the tutor answers").font(Theme.ui(15, .semibold))
            Button { showSettings = true } label: {
                VStack(alignment: .leading, spacing: 3) {
                    Text("Inside Axiom with an API key").font(Theme.ui(14, .semibold))
                    Text("Answers appear right here, with real math and interactive practice.").font(Theme.ui(12)).foregroundStyle(Theme.muted)
                }.padding(12).frame(maxWidth: .infinity, alignment: .leading).background(Theme.panel2, in: RoundedRectangle(cornerRadius: 12))
            }.buttonStyle(.plain)
            VStack(alignment: .leading, spacing: 3) {
                Text("My Claude or ChatGPT app").font(Theme.ui(14, .semibold))
                Text("Without a key, questions (with the page pictures) are handed to your app through the share sheet.").font(Theme.ui(12)).foregroundStyle(Theme.muted)
            }.padding(12).frame(maxWidth: .infinity, alignment: .leading).background(Theme.panel2.opacity(0.5), in: RoundedRectangle(cornerRadius: 12))
        }
        .padding(16)
    }

    @ViewBuilder private func bubble(_ m: TutorMessage) -> some View {
        if m.role == "user" {
            VStack(alignment: .trailing, spacing: 6) {
                if !m.images.isEmpty {
                    HStack { ForEach(Array(m.images.enumerated()), id: \.offset) { _, d in if let img = UIImage(data: d) { Image(uiImage: img).resizable().scaledToFit().frame(maxHeight: 120).clipShape(RoundedRectangle(cornerRadius: 8)) } } }
                }
                if let l = m.label { Text(l).font(Theme.ui(11)).foregroundStyle(Theme.muted) }
                Text(m.text).font(Theme.ui(15)).padding(.horizontal, 14).padding(.vertical, 10)
                    .background(Theme.accentSoft, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            }
            .frame(maxWidth: .infinity, alignment: .trailing)
        } else {
            VStack(alignment: .leading, spacing: 6) {
                if m.text.isEmpty && tutor.busy { ProgressView().padding(.vertical, 6) }
                else if m.error { Text(m.text).font(Theme.ui(14)).foregroundStyle(Theme.danger) }
                else { MarkdownView(text: m.text, size: 15).textSelection(.enabled) }
            }
            .contextMenu { Button("Copy", systemImage: "doc.on.doc") { UIPasteboard.general.string = m.text } }
        }
    }

    private var input: some View {
        HStack(alignment: .bottom, spacing: 8) {
            if tutor.pageProvider != nil {
                IconButton(symbol: "doc.viewfinder", label: "Ask about this page", size: 38) { tutor.draft = tutor.draft.isEmpty ? "Explain this page." : tutor.draft; tutor.sendDraft(attachPage: true) }
            }
            HStack(alignment: .bottom, spacing: 0) {
                TextField("Ask anything…", text: $tutor.draft, axis: .vertical)
                    .lineLimit(1...6).textFieldStyle(.plain).font(Theme.ui(15)).padding(.leading, 14).padding(.vertical, 10).focused($focused)
                    .onSubmit { tutor.sendDraft(attachPage: tutor.messages.isEmpty) }
                Button {
                    if tutor.busy { tutor.stop() } else { tutor.sendDraft(attachPage: tutor.messages.isEmpty) }
                } label: {
                    Image(systemName: tutor.busy ? "stop.fill" : "arrow.up").font(.system(size: 14, weight: .bold)).foregroundStyle(.white)
                        .frame(width: 32, height: 32).background(Theme.accent.opacity(tutor.busy || !tutor.draft.trimmingCharacters(in: .whitespaces).isEmpty ? 1 : 0.35), in: Circle())
                }
                .buttonStyle(.plain).padding(5)
                .disabled(!tutor.busy && tutor.draft.trimmingCharacters(in: .whitespaces).isEmpty)
            }
            .background(Theme.panel2, in: RoundedRectangle(cornerRadius: 21, style: .continuous))
        }
        .padding(12)
    }
}
