import SwiftUI

@main
struct AxiomApp: App {
    @State private var app = AppState.shared
    @Environment(\.scenePhase) private var phase

    init() {
        #if DEBUG
        DebugChannel.shared.start()
        #endif
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(app)
                .environment(Library.shared)
                .preferredColorScheme(app.colorScheme)
                .persistentSystemOverlays(.hidden)
                .statusBarHidden(true)
        }
        .onChange(of: phase) { _, p in
            if p != .active { NotificationCenter.default.post(name: .axiomFlush, object: nil); Library.shared.flushSettings() }
        }
    }
}

extension Notification.Name {
    /// write everything that is waiting to be saved (the app is going to the background)
    static let axiomFlush = Notification.Name("axiomFlush")
}

enum Route: Equatable {
    case note(String)
    case book(String, page: Int?)
}

@Observable
final class AppState {
    static let shared = AppState()
    var route: Route?
    var toast: String?
    var graphOpen = false { didSet { if graphOpen { Tutor.shared.isOpen = false; besideOpen = false } } }
    var besideOpen = false { didSet { if besideOpen { Tutor.shared.isOpen = false; graphOpen = false } } }
    var besideBook: String?
    weak var editor: EditorController?
    private var toastWork: DispatchWorkItem?

    var colorScheme: ColorScheme? {
        switch (Library.shared.settings.str("theme") ?? "dark") { case "light": .light; case "system": nil; default: .dark }
    }

    func open(_ r: Route) {
        withAnimation(.snappy(duration: 0.28)) { route = r }
        switch r {
        case .note(let id): Library.shared.set("session", ["t": "doc", "id": id, "at": Date().ms] as JSON)
        case .book(let id, _): Library.shared.set("session", ["t": "read", "id": id, "at": Date().ms] as JSON)
        }
    }
    func close() {
        NotificationCenter.default.post(name: .axiomFlush, object: nil)
        graphOpen = false
        besideOpen = false
        withAnimation(.snappy(duration: 0.24)) { route = nil }
        Library.shared.set("session", nil)
    }
    func say(_ text: String, _ seconds: Double = 1.8) {
        toastWork?.cancel()
        withAnimation(.easeOut(duration: 0.18)) { toast = text }
        let w = DispatchWorkItem { [weak self] in withAnimation(.easeIn(duration: 0.2)) { self?.toast = nil } }
        toastWork = w
        DispatchQueue.main.asyncAfter(deadline: .now() + seconds, execute: w)
    }
}

struct RootView: View {
    @Environment(AppState.self) private var app
    var body: some View {
        ZStack {
            LibraryView()
            if let r = app.route {
                // the tutor docks beside the page; the page narrows instead of being covered
                GeometryReader { geo in
                    let side = Tutor.shared.isOpen || app.graphOpen || app.besideOpen
                    let tw: CGFloat = side ? min(420, max(340, geo.size.width * 0.42)) : 0
                    HStack(spacing: 0) {
                        Group {
                            switch r {
                            case .note(let id): EditorScreen(docID: id).id(id)
                            case .book(let id, let page):
                                if let b = Library.shared.books.first(where: { $0.id == id }), b.type == "epub" { EpubReaderScreen(book: b).id(id) }
                                else { ReaderScreen(bookID: id, startPage: page).id(id) }
                            }
                        }
                        .frame(width: geo.size.width - tw)
                        .clipped()
                        if app.besideOpen { BookPanel(width: tw).transition(.move(edge: .trailing)) }
                        else if app.graphOpen { GraphPanel(width: tw).transition(.move(edge: .trailing)) }
                        else if Tutor.shared.isOpen { TutorPanel(width: tw).transition(.move(edge: .trailing)) }
                    }
                }
                .ignoresSafeArea()
                .transition(.opacity.combined(with: .scale(scale: 0.985)))
                .zIndex(1)
            }
                        if let t = app.toast {
                VStack {
                    Spacer()
                    Text(t).font(Theme.ui(14, .medium)).padding(.horizontal, 16).padding(.vertical, 10).floating(14).padding(.bottom, 40)
                }
                .transition(.move(edge: .bottom).combined(with: .opacity))
                .allowsHitTesting(false)
                .zIndex(2)
            }
        }
        .background(Theme.bg)
    }
}
