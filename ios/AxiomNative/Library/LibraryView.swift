import SwiftUI
import UniformTypeIdentifiers

enum LibSection: Hashable {
    case home, books, notebooks, canvases, course(String), unfiled, trash
}

struct LibraryView: View {
    @Environment(Library.self) private var lib
    @Environment(AppState.self) private var app
    @State private var section: LibSection = .home
    @State private var query = ""
    @State private var showNewNotebook = false
    @State private var importing = false
    @State private var renaming: RenameTarget?
    @State private var newCourse = false
    @State private var courseName = ""
    @State private var showSettings = false

    var body: some View {
        HStack(spacing: 0) {
            sidebar
                .frame(width: 250)
                .background(Theme.panel.opacity(0.6))
            Divider().overlay(Theme.line)
            content
        }
        .background(Theme.bg)
        .sheet(isPresented: $showNewNotebook) { NewNotebookSheet(defaultSubject: currentCourse) { id in showNewNotebook = false; app.open(.note(id)) } }
        .sheet(isPresented: $showSettings) { SettingsView() }
        .fileImporter(isPresented: $importing, allowedContentTypes: [.pdf, .epub, .image], allowsMultipleSelection: true) { res in
            guard case .success(let urls) = res else { return }
            var last: BookMeta?
            for u in urls { last = lib.importBook(from: u, subject: currentCourse) ?? last }
            if urls.count == 1, let b = last { app.open(.book(b.id, page: nil)) } else if last != nil { app.say("Added \(urls.count) files") }
        }
        .alert("Rename", isPresented: Binding(get: { renaming != nil }, set: { if !$0 { renaming = nil } })) {
            TextField("Name", text: Binding(get: { renaming?.name ?? "" }, set: { renaming?.name = $0 }))
            Button("Cancel", role: .cancel) {}
            Button("Rename") { if let r = renaming { r.isBook ? lib.updateBook(r.id) { $0["title"] = r.name; $0["name"] = r.name } : lib.rename(r.id, r.name) } }
        }
        .alert("New course", isPresented: $newCourse) {
            TextField("Course name", text: $courseName)
            Button("Cancel", role: .cancel) { courseName = "" }
            Button("Add") { if let s = lib.addSubject(courseName) { section = .course(s.id) }; courseName = "" }
        }
    }

    private var currentCourse: String? { if case .course(let id) = section { return id }; return nil }

    // MARK: sidebar

    private var sidebar: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text("Axiom.").font(Theme.title(30)).foregroundStyle(Theme.fg).padding(.horizontal, 18).padding(.top, 26).padding(.bottom, 18)
            navRow("Home", "house", .home, nil)
            navRow("Books", "books.vertical", .books, lib.books.count)
            navRow("Notebooks", "book.closed", .notebooks, lib.notes.filter(\.isNotebook).count)
            navRow("Canvases", "scribble.variable", .canvases, lib.notes.filter { !$0.isNotebook }.count)
            HStack {
                Text("COURSES").font(Theme.label()).tracking(0.8).foregroundStyle(Theme.muted)
                Spacer()
                Button { newCourse = true } label: { Image(systemName: "plus").font(.system(size: 14, weight: .semibold)).foregroundStyle(Theme.muted).frame(width: 30, height: 30) }
                    .buttonStyle(.plain).accessibilityLabel("New course")
            }
            .padding(.horizontal, 18).padding(.top, 22).padding(.bottom, 4)
            ScrollView {
                VStack(spacing: 2) {
                    ForEach(lib.subjects) { s in
                        courseRow(s)
                    }
                    navRow("Unfiled", "tray", .unfiled, lib.notes.filter { $0.subject == nil }.count + lib.books.filter { $0.subject == nil }.count)
                    if !lib.trash.isEmpty { navRow("Recently deleted", "trash", .trash, lib.trash.count) }
                }
            }
            Spacer(minLength: 0)
            Button { showSettings = true } label: {
                Label("Settings", systemImage: "gearshape").font(Theme.ui(14)).foregroundStyle(Theme.muted).padding(.horizontal, 18).padding(.vertical, 14)
            }.buttonStyle(.plain)
        }
    }

    private func navRow(_ title: String, _ icon: String, _ s: LibSection, _ count: Int?) -> some View {
        Button { withAnimation(.snappy(duration: 0.2)) { section = s } } label: {
            HStack(spacing: 12) {
                Image(systemName: icon).font(.system(size: 16)).frame(width: 22)
                Text(title).font(Theme.ui(15, section == s ? .semibold : .regular))
                Spacer()
                if let c = count, c > 0 { Text("\(c)").font(Theme.num(12)).foregroundStyle(Theme.muted) }
            }
            .foregroundStyle(section == s ? Theme.accent : Theme.fg)
            .padding(.horizontal, 12).frame(height: 40)
            .background(section == s ? Theme.accentSoft : .clear, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain).padding(.horizontal, 8)
    }

    private func courseRow(_ s: Subject) -> some View {
        let n = lib.notes.filter { $0.subject == s.id }.count + lib.books.filter { $0.subject == s.id }.count
        return navRowCourse(s, n)
            .contextMenu {
                Button("Rename", systemImage: "pencil") { renaming = RenameTarget(id: s.id, name: s.name, isBook: false, isCourse: true) }
                Button("Remove course", systemImage: "trash", role: .destructive) { lib.removeSubject(s.id); if section == .course(s.id) { section = .home } }
            }
    }
    private func navRowCourse(_ s: Subject, _ n: Int) -> some View {
        Button { withAnimation(.snappy(duration: 0.2)) { section = .course(s.id) } } label: {
            HStack(spacing: 12) {
                Circle().fill(Color(uiColor: s.uiColor)).frame(width: 10, height: 10).frame(width: 22)
                Text(s.name).font(Theme.ui(15, section == .course(s.id) ? .semibold : .regular)).lineLimit(1)
                Spacer()
                if n > 0 { Text("\(n)").font(Theme.num(12)).foregroundStyle(Theme.muted) }
            }
            .foregroundStyle(section == .course(s.id) ? Theme.accent : Theme.fg)
            .padding(.horizontal, 12).frame(height: 40)
            .background(section == .course(s.id) ? Theme.accentSoft : .clear, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain).padding(.horizontal, 8)
    }

    // MARK: content

    private var title: String {
        switch section {
        case .home: return greeting
        case .books: return "Books"
        case .notebooks: return "Notebooks"
        case .canvases: return "Canvases"
        case .course(let id): return lib.subject(id)?.name ?? "Course"
        case .unfiled: return "Unfiled"
        case .trash: return "Recently deleted"
        }
    }
    private var greeting: String {
        let h = Calendar.current.component(.hour, from: Date())
        return h < 5 ? "Good night." : h < 12 ? "Good morning." : h < 18 ? "Good afternoon." : "Good evening."
    }

    private var content: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .firstTextBaseline) {
                Text(title).font(Theme.title(38)).foregroundStyle(Theme.fg)
                Spacer()
                newMenu
            }
            .padding(.horizontal, 32).padding(.top, 30)
            HStack(spacing: 10) {
                HStack(spacing: 8) {
                    Image(systemName: "magnifyingglass").foregroundStyle(Theme.muted)
                    TextField("Search", text: $query).textFieldStyle(.plain).font(Theme.ui(15))
                }
                .padding(.horizontal, 12).frame(height: 40).frame(maxWidth: 360)
                .background(Theme.panel2, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                Spacer()
            }
            .padding(.horizontal, 32).padding(.top, 14).padding(.bottom, 8)
            ScrollView {
                VStack(alignment: .leading, spacing: 28) {
                    switch section {
                    case .home: home
                    case .books: bookGrid(filteredBooks(lib.books))
                    case .notebooks: noteGrid(filteredNotes(lib.notes.filter(\.isNotebook)))
                    case .canvases: noteGrid(filteredNotes(lib.notes.filter { !$0.isNotebook }))
                    case .course(let id): courseContent(id)
                    case .unfiled: courseContent(nil)
                    case .trash: trashGrid
                    }
                }
                .padding(.horizontal, 32).padding(.vertical, 18)
            }
        }
    }

    private var newMenu: some View {
        Menu {
            Button("Notebook", systemImage: "book.closed") { showNewNotebook = true }
            Button("Canvas", systemImage: "scribble.variable") { app.open(.note(lib.newCanvas(subject: currentCourse))) }
            Divider()
            Button("Import PDF, book or picture…", systemImage: "square.and.arrow.down") { importing = true }
        } label: {
            Label("New", systemImage: "plus").font(Theme.ui(15, .semibold)).foregroundStyle(.white)
                .padding(.horizontal, 16).frame(height: 38)
                .background(Theme.accent, in: Capsule())
        }
    }

    private func filteredNotes(_ n: [NoteMeta]) -> [NoteMeta] {
        let q = query.trimmingCharacters(in: .whitespaces).lowercased()
        return q.isEmpty ? n : n.filter { $0.name.lowercased().contains(q) }
    }
    private func filteredBooks(_ b: [BookMeta]) -> [BookMeta] {
        let q = query.trimmingCharacters(in: .whitespaces).lowercased()
        let s = b.sorted { ($0.lastRead ?? $0.added) > ($1.lastRead ?? $1.added) }
        return q.isEmpty ? s : s.filter { $0.name.lowercased().contains(q) }
    }

    @ViewBuilder private var home: some View {
        let recentNotes = filteredNotes(lib.notes)
        let recentBooks = filteredBooks(lib.books)
        if recentNotes.isEmpty && recentBooks.isEmpty {
            emptyState
        }
        ExamCards()
        if !recentBooks.isEmpty {
            sectionHeader("Continue reading", action: recentBooks.count > 4 ? ("All books", { section = .books }) : nil)
            bookGrid(Array(recentBooks.prefix(4)))
        }
        if !recentNotes.isEmpty {
            sectionHeader("Recent", action: nil)
            noteGrid(Array(recentNotes.prefix(8)))
        }
    }

    private var emptyState: some View {
        VStack(spacing: 14) {
            Image(systemName: "pencil.and.scribble").font(.system(size: 44)).foregroundStyle(Theme.accent)
            Text("Start with a notebook, or bring in a book.").font(Theme.ui(17, .medium)).foregroundStyle(Theme.fg)
            HStack(spacing: 10) {
                Button("New notebook") { showNewNotebook = true }.buttonStyle(.borderedProminent)
                Button("Import a PDF") { importing = true }.buttonStyle(.bordered)
            }
        }
        .frame(maxWidth: .infinity).padding(.vertical, 80)
    }

    @ViewBuilder private func courseContent(_ id: String?) -> some View {
        let books = filteredBooks(lib.books.filter { $0.subject == id })
        let notes = filteredNotes(lib.notes.filter { $0.subject == id })
        if let id { ExamCards(course: id) }
        if books.isEmpty && notes.isEmpty {
            Text(id == nil ? "Everything has a course." : "Nothing in this course yet. Use New to add a notebook or a book.")
                .font(Theme.ui(15)).foregroundStyle(Theme.muted).padding(.vertical, 40)
        }
        if !books.isEmpty { sectionHeader("Books", action: nil); bookGrid(books) }
        if !notes.isEmpty { sectionHeader("Notebooks and canvases", action: nil); noteGrid(notes) }
    }

    private func sectionHeader(_ t: String, action: (String, () -> Void)?) -> some View {
        HStack {
            Text(t.uppercased()).font(Theme.label(12)).tracking(0.8).foregroundStyle(Theme.muted)
            Spacer()
            if let a = action { Button(a.0, action: a.1).font(Theme.ui(13, .medium)).foregroundStyle(Theme.accent) }
        }
    }

    private var trashGrid: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("Deleted notebooks and canvases stay here for 30 days.").font(Theme.ui(14)).foregroundStyle(Theme.muted)
            LazyVGrid(columns: cols, alignment: .leading, spacing: 26) {
                ForEach(lib.trash, id: \.self.description) { t in
                    let id = t.str("id") ?? ""
                    VStack(alignment: .leading, spacing: 8) {
                        Color.white.aspectRatio(t.str("kind") == "notebook" ? 0.75 : 1.33, contentMode: .fit)
                            .overlay { if let img = UIImage.fromDataURL(t.str("thumb")) { Image(uiImage: img).resizable().scaledToFill() } }
                            .clipShape(RoundedRectangle(cornerRadius: 12)).opacity(0.75)
                        Text(t.str("name") ?? "Untitled").font(Theme.ui(15, .semibold)).lineLimit(1)
                        let left = max(0, 30 - Int((Date().ms - (t.num("deleted") ?? 0)) / 86_400_000))
                        Text("\(left) day\(left == 1 ? "" : "s") left").font(Theme.ui(12)).foregroundStyle(Theme.muted)
                        HStack {
                            Button("Restore") { lib.restoreFromTrash(id) }.buttonStyle(.bordered)
                            Button("Delete now", role: .destructive) { lib.purge(id) }.buttonStyle(.bordered)
                        }
                    }
                }
            }
        }
    }

    private let cols = [GridItem(.adaptive(minimum: 180, maximum: 240), spacing: 22, alignment: .top)]

    private func noteGrid(_ notes: [NoteMeta]) -> some View {
        LazyVGrid(columns: cols, alignment: .leading, spacing: 26) {
            ForEach(notes) { n in
                NoteCard(meta: n, subject: lib.subject(n.subject))
                    .onTapGesture { app.open(.note(n.id)) }
                    .contextMenu { noteMenu(n) }
            }
        }
    }
    private func bookGrid(_ books: [BookMeta]) -> some View {
        LazyVGrid(columns: cols, alignment: .leading, spacing: 26) {
            ForEach(books) { b in
                BookCard(book: b, subject: lib.subject(b.subject))
                    .onTapGesture { app.open(.book(b.id, page: nil)) }
                    .contextMenu { bookMenu(b) }
            }
        }
    }

    @ViewBuilder private func noteMenu(_ n: NoteMeta) -> some View {
        Button("Rename", systemImage: "pencil") { renaming = RenameTarget(id: n.id, name: n.name, isBook: false) }
        courseMenu(current: n.subject) { lib.setSubject(n.id, $0) }
        Button(n.fav ? "Remove from favourites" : "Favourite", systemImage: n.fav ? "star.slash" : "star") { lib.toggleFav(n.id) }
        Button("Duplicate", systemImage: "plus.square.on.square") { lib.duplicate(n.id) }
        Divider()
        Button("Delete", systemImage: "trash", role: .destructive) { lib.delete(n.id); app.say("Moved to Recently deleted", 1.6) }
    }
    @ViewBuilder private func bookMenu(_ b: BookMeta) -> some View {
        Button("Rename", systemImage: "pencil") { renaming = RenameTarget(id: b.id, name: b.name, isBook: true) }
        courseMenu(current: b.subject) { s in lib.updateBook(b.id) { $0["subject"] = s ?? NSNull() } }
        Divider()
        Button("Remove from library", systemImage: "trash", role: .destructive) { lib.removeBook(b.id) }
    }
    private func courseMenu(current: String?, set: @escaping (String?) -> Void) -> some View {
        Menu {
            ForEach(lib.subjects) { s in
                Button { set(s.id) } label: { if current == s.id { Label(s.name, systemImage: "checkmark") } else { Text(s.name) } }
            }
            Divider()
            Button("No course") { set(nil) }
        } label: { Label("Course", systemImage: "folder") }
    }
}

struct RenameTarget { let id: String; var name: String; let isBook: Bool; var isCourse = false }

struct NoteCard: View {
    let meta: NoteMeta
    let subject: Subject?
    @State private var image: UIImage?
    var body: some View {
        VStack(alignment: .leading, spacing: 9) {
            Color(uiColor: UIColor(css: meta.paper ?? "#ffffff"))
                .aspectRatio(meta.isNotebook ? 0.75 : 1.33, contentMode: .fit)
                .overlay { if let image { Image(uiImage: image).resizable().scaledToFill() } }
                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(Theme.line, lineWidth: 0.5))
            .shadow(color: .black.opacity(0.18), radius: 10, y: 4)
            .overlay(alignment: .topTrailing) { if meta.fav { Image(systemName: "star.fill").font(.system(size: 12)).foregroundStyle(.yellow).padding(8) } }
            Text(meta.name).font(Theme.ui(15, .semibold)).foregroundStyle(Theme.fg).lineLimit(1)
            HStack(spacing: 6) {
                if let s = subject { Circle().fill(Color(uiColor: s.uiColor)).frame(width: 7, height: 7); Text(s.name).lineLimit(1); Text("·") }
                Text(Date(ms: meta.updated).formatted(.relative(presentation: .named)))
                if let p = meta.pages, p > 1 { Text("· \(p) pages") }
            }
            .font(Theme.ui(12)).foregroundStyle(Theme.muted)
        }
        .contentShape(Rectangle())
        .task(id: meta.thumb?.count) { image = UIImage.fromDataURL(meta.thumb) }
    }
}

struct BookCard: View {
    let book: BookMeta
    let subject: Subject?
    @State private var image: UIImage?
    var body: some View {
        VStack(alignment: .leading, spacing: 9) {
            Theme.panel2
                .aspectRatio(0.72, contentMode: .fit)
                .overlay {
                    if let image { Image(uiImage: image).resizable().scaledToFill() }
                    else { Image(systemName: book.type == "image" ? "photo" : "book.closed").font(.system(size: 30)).foregroundStyle(Theme.faint) }
                }
                .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).strokeBorder(Theme.line, lineWidth: 0.5))
            .shadow(color: .black.opacity(0.22), radius: 10, y: 4)
            Text(book.name).font(Theme.ui(15, .semibold)).foregroundStyle(Theme.fg).lineLimit(2)
            if let p = book.pages, p > 1 {
                ProgressView(value: Double(min(book.lastPage, p)), total: Double(p)).tint(Theme.accent)
                Text("Page \(book.lastPage) of \(p)").font(Theme.num(11)).foregroundStyle(Theme.muted)
            } else if let s = subject {
                HStack(spacing: 6) { Circle().fill(Color(uiColor: s.uiColor)).frame(width: 7, height: 7); Text(s.name) }.font(Theme.ui(12)).foregroundStyle(Theme.muted)
            }
        }
        .contentShape(Rectangle())
        .task(id: book.cover?.count) { image = UIImage.fromDataURL(book.cover) }
    }
}
