import SwiftUI
import UniformTypeIdentifiers

// MARK: - cards on Home and course pages

struct ExamCards: View {
    var course: String?
    @Environment(Library.self) private var lib
    @State private var editing: ExamInfo?
    @State private var opened: ExamInfo?
    var exams: [ExamInfo] { ExamStore.all.filter { (course == nil || $0.course == course) && $0.daysLeft >= -1 }.sorted { $0.date < $1.date } }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("PREPARING FOR").font(Theme.label(12)).tracking(0.8).foregroundStyle(Theme.muted)
                Spacer()
                Button { var e = ExamInfo.new(); e.course = course; editing = e } label: { Label("Exam prep", systemImage: "plus").font(Theme.ui(13, .medium)) }
                    .foregroundStyle(Theme.accent)
            }
            if exams.isEmpty {
                Button { var e = ExamInfo.new(); e.course = course; editing = e } label: {
                    HStack(spacing: 12) {
                        Image(systemName: "graduationcap").font(.system(size: 22)).foregroundStyle(Theme.accent)
                        VStack(alignment: .leading, spacing: 2) {
                            Text("Prepare for an exam, quiz or lab").font(Theme.ui(15, .semibold)).foregroundStyle(Theme.fg)
                            Text("Give it the syllabus, past exams and the date; get a plan, guides and practice.").font(Theme.ui(12)).foregroundStyle(Theme.muted)
                        }
                        Spacer()
                    }
                    .padding(14).background(Theme.panel2, in: RoundedRectangle(cornerRadius: 14))
                }.buttonStyle(.plain)
            } else {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 14) { ForEach(exams) { e in card(e).onTapGesture { opened = e } } }
                }
            }
        }
        .sheet(item: $editing) { e in ExamEditSheet(exam: e) { saved, build in editing = nil; if let saved, build { opened = saved } } }
        .fullScreenCover(item: $opened) { e in ExamPrepView(exam: e) }
    }

    private func card(_ e: ExamInfo) -> some View {
        let p = ExamStore.loadPrep(e.id)
        let all = ExamStore.sessions(p), done = (p["done"] as? JSON) ?? [:]
        let today = all.filter { $0.day == ExamStore.todayKey() && done[$0.key] == nil }
        return VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 6) {
                Circle().fill(Color(uiColor: lib.subject(e.course)?.uiColor ?? .systemGray)).frame(width: 8, height: 8)
                Text(e.kind.label.uppercased()).font(Theme.label()).tracking(0.6).foregroundStyle(Theme.muted)
                Spacer()
                Text(e.leftLabel).font(Theme.num(12, .semibold)).foregroundStyle(e.daysLeft <= 2 ? Theme.danger : Theme.accent)
            }
            Text(e.title.isEmpty ? e.kind.label : e.title).font(Theme.ui(16, .semibold)).foregroundStyle(Theme.fg).lineLimit(2)
            if !all.isEmpty {
                ProgressView(value: Double(all.filter { done[$0.key] != nil }.count), total: Double(all.count)).tint(Theme.accent)
                Text(today.first.map { "Today: " + plain($0.s.str("task") ?? "") } ?? (e.daysLeft > 0 ? "Nothing left for today" : "")).font(Theme.ui(12)).foregroundStyle(Theme.muted).lineLimit(2)
            } else {
                Text(e.built ? "" : "Not built yet").font(Theme.ui(12)).foregroundStyle(Theme.muted)
            }
        }
        .padding(14).frame(width: 260, height: 140, alignment: .topLeading)
        .background(Theme.panel2, in: RoundedRectangle(cornerRadius: 14))
        .contentShape(Rectangle())
    }
}

func plain(_ s: String) -> String { s.replacingOccurrences(of: #"[*_`#]"#, with: "", options: .regularExpression).replacingOccurrences(of: #"\$([^$]*)\$"#, with: "$1", options: .regularExpression) }

// MARK: - create / edit

struct ExamEditSheet: View {
    @State var exam: ExamInfo
    let done: (ExamInfo?, Bool) -> Void
    @Environment(Library.self) private var lib
    @State private var importing = false
    @State private var importRole: MaterialRole = .past
    @State private var bookPick = false
    @State private var notePick = false
    private var isNew: Bool { !exam.built }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Picker("Kind", selection: $exam.kind) { ForEach(ExamKind.allCases, id: \.self) { Text($0.label).tag($0) } }.pickerStyle(.segmented)
                    TextField(exam.kind == .lab ? "Which lab (e.g. Lab 4 · Diffraction)" : exam.kind == .quiz ? "What is it (e.g. Quiz 3)" : "What is it (e.g. Midterm 2)", text: $exam.title)
                    Picker("Course", selection: $exam.course) { Text("None").tag(String?.none); ForEach(lib.subjects) { Text($0.name).tag(String?.some($0.id)) } }
                    DatePicker("When", selection: $exam.date)
                }
                Section("Materials") {
                    ForEach(Array(exam.files.enumerated()), id: \.offset) { i, f in
                        HStack { Image(systemName: (f.str("type") ?? "").contains("pdf") ? "doc.richtext" : "photo"); VStack(alignment: .leading) { Text(f.str("name") ?? "file").lineLimit(1); Text(MaterialRole(rawValue: f.str("role") ?? "")?.label ?? "").font(.caption).foregroundStyle(.secondary) } }
                            .swipeActions { Button("Remove", role: .destructive) { exam.files.remove(at: i) } }
                    }
                    ForEach(Array(exam.books.enumerated()), id: \.offset) { i, b in
                        let name = lib.books.first { $0.id == b.str("docId") }.map { cleanTitle($0.name) } ?? "Book"
                        HStack {
                            Image(systemName: "book.closed")
                            Text(name).lineLimit(1)
                            Spacer()
                            Stepper("p. \(b.int("from") ?? 1)", value: Binding(get: { exam.books[i].int("from") ?? 1 }, set: { exam.books[i]["from"] = max(1, $0) }), in: 1...9999).fixedSize()
                            Stepper("– \(b.int("to") ?? 1)", value: Binding(get: { exam.books[i].int("to") ?? 1 }, set: { exam.books[i]["to"] = max(exam.books[i].int("from") ?? 1, min($0, (exam.books[i].int("from") ?? 1) + 79)) }), in: 1...9999).fixedSize()
                        }
                        .swipeActions { Button("Remove", role: .destructive) { exam.books.remove(at: i) } }
                    }
                    ForEach(exam.notebooks, id: \.self) { id in
                        HStack { Image(systemName: "pencil.and.scribble"); Text(lib.notes.first { $0.id == id }?.name ?? "Notebook") }
                            .swipeActions { Button("Remove", role: .destructive) { exam.notebooks.removeAll { $0 == id } } }
                    }
                    Menu {
                        ForEach(MaterialRole.allCases, id: \.self) { r in Button(r == .syllabus ? "Syllabus (or the topic list)" : r.label) { importRole = r; importing = true } }
                        Button("Chapters from a book") { bookPick = true }
                        Button("One of your notebooks") { notePick = true }
                    } label: { Label("Add material", systemImage: "plus") }
                }
                Section("Anything else") { TextField("What the instructor said, topics to stress…", text: $exam.notes, axis: .vertical).lineLimit(2...6) }
            }
            .navigationTitle(isNew ? "New exam prep" : "Edit exam prep").navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { done(nil, false) } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(isNew ? "Build my prep" : "Save and rebuild") { ExamStore.save(exam); done(exam, true) }.bold()
                        .disabled(exam.title.trimmingCharacters(in: .whitespaces).isEmpty && exam.files.isEmpty)
                }
            }
            .fileImporter(isPresented: $importing, allowedContentTypes: [.pdf, .image], allowsMultipleSelection: true) { res in
                guard case .success(let urls) = res else { return }
                for u in urls {
                    let ok = u.startAccessingSecurityScopedResource(); defer { if ok { u.stopAccessingSecurityScopedResource() } }
                    guard let d = try? Data(contentsOf: u), d.count < 25_000_000 else { AppState.shared.say("Files up to 25 MB"); continue }
                    let id = UID.make()
                    Store.shared.saveFile("exf_" + id, d)
                    exam.files.append(["id": id, "name": u.lastPathComponent, "type": u.pathExtension.lowercased() == "pdf" ? "application/pdf" : "image/jpeg", "role": importRole.rawValue, "size": d.count])
                }
            }
            .confirmationDialog("Chapters from which book?", isPresented: $bookPick) {
                ForEach(lib.books.filter { $0.type == "pdf" }) { b in Button(cleanTitle(b.name)) { exam.books.append(["docId": b.id, "from": max(1, b.lastPage), "to": min(b.pages ?? 1, max(1, b.lastPage) + 19)]) } }
            }
            .confirmationDialog("Which notebook?", isPresented: $notePick) {
                ForEach(lib.notes.filter { !exam.notebooks.contains($0.id) }.prefix(20)) { n in Button(n.name) { exam.notebooks.append(n.id) } }
            }
        }
    }
}

// MARK: - the prep

@Observable
final class ExamSession {
    var exam: ExamInfo
    var prep: JSON
    var building = false
    var status = ""
    var error: String?
    var tab = 0
    var topicOpen: String?
    var streaming: [String: String] = [:]     // live text per key (guide:<tid>, hint:<qid>, sol:<qid>, deeper:<tid>:<i>)
    init(_ e: ExamInfo) { exam = e; prep = ExamStore.loadPrep(e.id) }
    func save() { ExamStore.savePrep(exam.id, prep) }

    @MainActor func build() async {
        guard Claude.hasKey else { error = "Exam prep needs a Claude API key. Add it in Settings."; return }
        building = true; error = nil
        do {
            prep = try await ExamAI.buildPlan(exam, prep: prep) { [weak self] s in self?.status = s }
            exam.built = true; ExamStore.save(exam); save()
        } catch { self.error = error.localizedDescription }
        building = false
    }
    var topics: [JSON] { prep.arr("topics") }
    var questions: [JSON] { prep.arr("questions") }
    func topic(_ id: String) -> JSON? { topics.first { $0.str("id") == id } }
    var done: JSON { (prep["done"] as? JSON) ?? [:] }
    func toggle(_ key: String) {
        var d = done
        if d[key] != nil { d.removeValue(forKey: key) } else { d[key] = Date().ms }
        prep["done"] = d; save()
    }
}

struct ExamPrepView: View {
    @State private var session: ExamSession
    @Environment(\.dismiss) private var dismiss
    @Environment(Library.self) private var lib
    @State private var editing = false
    @State private var confirmDelete = false
    init(exam: ExamInfo) { _session = State(initialValue: ExamSession(exam)) }

    var body: some View {
        NavigationStack {
            Group {
                if session.building { building }
                else if session.prep.arr("topics").isEmpty { start }
                else { tabs }
            }
            .navigationTitle(session.exam.title.isEmpty ? session.exam.kind.label : session.exam.title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button { dismiss() } label: { Label("Close", systemImage: "chevron.left") } }
                ToolbarItem(placement: .principal) {
                    VStack(spacing: 0) {
                        Text(session.exam.title.isEmpty ? session.exam.kind.label : session.exam.title).font(Theme.ui(15, .semibold))
                        Text([lib.subject(session.exam.course)?.name, session.exam.kind.label, session.exam.date.formatted(date: .abbreviated, time: .shortened)].compactMap { $0 }.joined(separator: " · ")).font(Theme.ui(11)).foregroundStyle(Theme.muted)
                    }
                }
                ToolbarItem(placement: .primaryAction) {
                    HStack {
                        Text(session.exam.leftLabel).font(Theme.num(12, .semibold)).foregroundStyle(Theme.accent)
                        Menu {
                            Button("Edit details and materials", systemImage: "pencil") { editing = true }
                            Button("Re-plan from today", systemImage: "arrow.clockwise") { Task { await session.build() } }
                            Divider()
                            Button("Delete this prep", systemImage: "trash", role: .destructive) { confirmDelete = true }
                        } label: { Image(systemName: "ellipsis.circle") }
                    }
                }
            }
            .sheet(isPresented: $editing) { ExamEditSheet(exam: session.exam) { saved, build in editing = false; if let saved { session.exam = saved; if build { Task { await session.build() } } } } }
            .confirmationDialog("Delete this prep and its materials?", isPresented: $confirmDelete, titleVisibility: .visible) {
                Button("Delete", role: .destructive) { ExamStore.delete(session.exam); dismiss() }
            }
            .task { if !session.exam.built && session.prep.arr("topics").isEmpty && Claude.hasKey { await session.build() } }
        }
    }

    private var building: some View {
        VStack(spacing: 16) { ProgressView().controlSize(.large); Text(session.status).font(Theme.ui(15)).foregroundStyle(Theme.muted).multilineTextAlignment(.center).frame(maxWidth: 420) }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
    private var start: some View {
        VStack(spacing: 14) {
            Image(systemName: "graduationcap").font(.system(size: 40)).foregroundStyle(Theme.accent)
            if let e = session.error { Text(e).font(Theme.ui(15)).foregroundStyle(Theme.danger).multilineTextAlignment(.center).frame(maxWidth: 460) }
            Button("Build my prep") { Task { await session.build() } }.buttonStyle(.borderedProminent)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var tabs: some View {
        VStack(spacing: 0) {
            Picker("", selection: $session.tab) { Text("Plan").tag(0); Text("Topics").tag(1); Text("Past questions").tag(2); Text("Practice").tag(3) }
                .pickerStyle(.segmented).frame(maxWidth: 560).padding(12)
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    if let e = session.error { Text(e).foregroundStyle(Theme.danger) }
                    switch session.tab {
                    case 0: PlanTab(session: session)
                    case 1: TopicsTab(session: session)
                    case 2: QuestionsTab(session: session, questions: session.questions)
                    default: PracticeTab(session: session)
                    }
                }
                .frame(maxWidth: 760, alignment: .leading).padding(.horizontal, 24).padding(.bottom, 40)
                .frame(maxWidth: .infinity)
            }
        }
        .sheet(item: Binding(get: { session.topicOpen.map { TopicRef(id: $0) } }, set: { session.topicOpen = $0?.id })) { ref in TopicGuide(session: session, tid: ref.id) }
    }
}
struct TopicRef: Identifiable { let id: String }

struct PlanTab: View {
    let session: ExamSession
    var body: some View {
        let all = ExamStore.sessions(session.prep), done = session.done
        let today = ExamStore.todayKey()
        let missed = all.filter { $0.day < today && done[$0.key] == nil }.count
        VStack(alignment: .leading, spacing: 16) {
            MarkdownView(text: session.prep.str("summary") ?? "")
            if let f = session.prep.str("format"), !f.isEmpty { Text("Format: " + f).font(Theme.ui(13)).foregroundStyle(Theme.muted) }
            ProgressView(value: Double(all.filter { done[$0.key] != nil }.count), total: Double(max(1, all.count))).tint(Theme.accent)
            if missed > 0 {
                HStack { Text("\(missed) session\(missed == 1 ? "" : "s") from earlier days not done"); Spacer(); Button("Re-plan from today") { Task { await session.build() } } }
                    .font(Theme.ui(13, .medium)).padding(12).background(Theme.danger.opacity(0.1), in: RoundedRectangle(cornerRadius: 12))
            }
            ForEach(session.prep.arr("plan"), id: \.self.description) { d in
                let day = d.str("day") ?? ""
                VStack(alignment: .leading, spacing: 8) {
                    Text(day == today ? "Today" : dayLabel(day)).font(Theme.ui(15, .semibold)).foregroundStyle(day == today ? Theme.accent : Theme.fg)
                    ForEach(Array(d.arr("sessions").enumerated()), id: \.offset) { i, s in
                        let key = day + ":\(i)"
                        HStack(alignment: .top, spacing: 10) {
                            Button { session.toggle(key) } label: { Image(systemName: done[key] != nil ? "checkmark.circle.fill" : "circle").font(.system(size: 20)).foregroundStyle(done[key] != nil ? Theme.ok : Theme.faint) }.buttonStyle(.plain)
                            VStack(alignment: .leading, spacing: 5) {
                                HStack(spacing: 6) {
                                    Text((s.str("kind") ?? "").uppercased()).font(Theme.label(10)).tracking(0.6).padding(.horizontal, 6).padding(.vertical, 2).background(Theme.accentSoft, in: Capsule()).foregroundStyle(Theme.accent)
                                    Text("\(s.int("minutes") ?? 30) min").font(Theme.num(11)).foregroundStyle(Theme.muted)
                                }
                                MarkdownView(text: s.str("task") ?? "", size: 14).opacity(done[key] != nil ? 0.5 : 1)
                                topicChips((s["topics"] as? [Any])?.compactMap { $0 as? String } ?? [])
                            }
                        }
                    }
                }
                .padding(14).background(Theme.panel2.opacity(0.6), in: RoundedRectangle(cornerRadius: 14))
            }
        }
    }
    private func dayLabel(_ s: String) -> String {
        let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd"
        guard let d = f.date(from: s) else { return s }
        return d.formatted(.dateTime.weekday(.wide).day().month(.abbreviated))
    }
    @ViewBuilder func topicChips(_ ids: [String]) -> some View {
        if !ids.isEmpty {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 6) {
                    ForEach(ids, id: \.self) { id in
                        Button { session.topicOpen = id } label: { Text(session.topic(id)?.str("title") ?? id).font(Theme.ui(12, .medium)).padding(.horizontal, 10).frame(height: 26).background(Theme.panel2, in: Capsule()) }.buttonStyle(.plain)
                    }
                }
            }
        }
    }
}

struct TopicsTab: View {
    let session: ExamSession
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            ForEach(session.topics, id: \.self.description) { t in
                let tid = t.str("id") ?? ""
                let n = session.questions.filter { (($0["topics"] as? [Any]) ?? []).contains { ($0 as? String) == tid } }.count
                Button { session.topicOpen = tid } label: {
                    VStack(alignment: .leading, spacing: 6) {
                        HStack {
                            Text(t.str("title") ?? "").font(Theme.ui(16, .semibold)).foregroundStyle(Theme.fg)
                            Spacer()
                            Text((t.str("weight") ?? "").uppercased()).font(Theme.label(10)).padding(.horizontal, 6).padding(.vertical, 2)
                                .background((t.str("weight") == "high" ? Theme.danger : t.str("weight") == "medium" ? Theme.accent : Theme.faint).opacity(0.15), in: Capsule())
                            if n > 0 { Text("\(n) past Q").font(Theme.num(11)).foregroundStyle(Theme.muted) }
                            Text("Guide").font(Theme.ui(12, .semibold)).foregroundStyle(Theme.accent)
                        }
                        MarkdownView(text: t.str("why") ?? "", size: 13)
                        Text(t.str("sources") ?? "").font(Theme.ui(12)).foregroundStyle(Theme.muted)
                    }
                    .padding(14).background(Theme.panel2.opacity(0.6), in: RoundedRectangle(cornerRadius: 14)).contentShape(Rectangle())
                }.buttonStyle(.plain)
            }
            let gaps = session.prep.arr("gaps")
            if !gaps.isEmpty {
                Text("NEVER ASKED IN PAST EXAMS, STILL TO KNOW").font(Theme.label(11)).tracking(0.8).foregroundStyle(Theme.muted).padding(.top, 8)
                ForEach(gaps, id: \.self.description) { g in VStack(alignment: .leading, spacing: 3) { Text(g.str("topic") ?? "").font(Theme.ui(14, .semibold)); MarkdownView(text: g.str("note") ?? "", size: 13) } }
            }
        }
    }
}

struct TopicGuide: View {
    let session: ExamSession
    let tid: String
    @Environment(\.dismiss) private var dismiss
    @State private var asking: Int?
    @State private var question = ""
    var guide: JSON? { (session.prep["guides"] as? JSON)?[tid] as? JSON }
    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    if let g = guide {
                        ForEach(Array(g.arr("blocks").enumerated()), id: \.offset) { i, b in
                            VStack(alignment: .leading, spacing: 8) {
                                MarkdownView(text: b.str("md") ?? "").contentShape(Rectangle()).onTapGesture { asking = i; question = "" }
                                ForEach(Array(b.arr("deeper").enumerated()), id: \.offset) { _, d in
                                    VStack(alignment: .leading, spacing: 4) { Text("Deeper: " + (d.str("q") ?? "")).font(Theme.ui(12, .semibold)).foregroundStyle(Theme.accent); MarkdownView(text: d.str("md") ?? "", size: 14) }
                                        .padding(12).background(Theme.accentSoft.opacity(0.6), in: RoundedRectangle(cornerRadius: 12))
                                }
                                if let live = session.streaming["deeper:\(tid):\(i)"] { MarkdownView(text: live.isEmpty ? "_Thinking…_" : live, size: 14).padding(12).background(Theme.accentSoft.opacity(0.6), in: RoundedRectangle(cornerRadius: 12)) }
                                if asking == i {
                                    HStack {
                                        TextField("What is unclear about this part?", text: $question).textFieldStyle(.roundedBorder).onSubmit { ask(i) }
                                        Button("Ask") { ask(i) }.buttonStyle(.borderedProminent).disabled(question.trimmingCharacters(in: .whitespaces).isEmpty)
                                    }
                                }
                            }
                        }
                        let qs = session.questions.filter { (($0["topics"] as? [Any]) ?? []).contains { ($0 as? String) == tid } }
                        if !qs.isEmpty { Text("PAST QUESTIONS ON THIS").font(Theme.label(11)).tracking(0.8).foregroundStyle(Theme.muted).padding(.top, 10); QuestionsTab(session: session, questions: qs, grouped: false) }
                    } else if let live = session.streaming["guide:" + tid] {
                        MarkdownView(text: live.isEmpty ? "_Writing the guide…_" : live)
                    } else {
                        ProgressView().frame(maxWidth: .infinity).padding(40)
                    }
                }
                .padding(24)
            }
            .navigationTitle(session.topic(tid)?.str("title") ?? "Guide").navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
            .task { await writeGuide() }
        }
    }
    @MainActor private func writeGuide() async {
        guard guide == nil, session.streaming["guide:" + tid] == nil, let t = session.topic(tid), Claude.hasKey else { return }
        session.streaming["guide:" + tid] = ""
        do {
            let text = try await ExamAI.guide(topic: t, prep: session.prep, exam: session.exam) { s in Task { @MainActor in session.streaming["guide:" + tid] = s } }
            var guides = (session.prep["guides"] as? JSON) ?? [:]
            guides[tid] = ["blocks": ExamAI.splitBlocks(text).map { ["md": $0] as JSON }, "at": Date().ms] as JSON
            session.prep["guides"] = guides; session.save()
        } catch { session.error = error.localizedDescription }
        session.streaming["guide:" + tid] = nil
    }
    private func ask(_ i: Int) {
        let q = question.trimmingCharacters(in: .whitespaces)
        guard !q.isEmpty, var g = guide else { return }
        asking = nil
        var blocks = g.arr("blocks")
        let above = blocks.prefix(i + 1).map { b in (b.str("md") ?? "") + b.arr("deeper").map { "\n\n### Deeper: \($0.str("q") ?? "")\n\($0.str("md") ?? "")" }.joined() }.joined(separator: "\n\n")
        let key = "deeper:\(tid):\(i)"
        session.streaming[key] = ""
        Task { @MainActor in
            do {
                let text = try await ExamAI.deeper(above: above, line: blocks[i].str("md") ?? "", question: q) { s in Task { @MainActor in session.streaming[key] = s } }
                var deeper = blocks[i].arr("deeper"); deeper.append(["q": q, "md": text, "at": Date().ms])
                blocks[i]["deeper"] = deeper; g["blocks"] = blocks
                var guides = (session.prep["guides"] as? JSON) ?? [:]; guides[tid] = g
                session.prep["guides"] = guides; session.save()
            } catch { session.error = error.localizedDescription }
            session.streaming[key] = nil
        }
    }
}

struct QuestionsTab: View {
    let session: ExamSession
    let questions: [JSON]
    var grouped = true
    var body: some View {
        let groups = Dictionary(grouping: questions) { q in (q.str("source") ?? "").components(separatedBy: ",").first ?? "" }
        let order = questions.map { (q: JSON) in (q.str("source") ?? "").components(separatedBy: ",").first ?? "" }.reduce(into: [String]()) { if !$0.contains($1) { $0.append($1) } }
        VStack(alignment: .leading, spacing: 14) {
            if questions.isEmpty { Text("No past questions were found in the materials.").foregroundStyle(Theme.muted) }
            ForEach(grouped ? order : [""], id: \.self) { g in
                if grouped { Text(g.uppercased()).font(Theme.label(11)).tracking(0.8).foregroundStyle(Theme.muted).padding(.top, 6) }
                ForEach(grouped ? (groups[g] ?? []) : questions, id: \.self.description) { q in QuestionCard(session: session, q: q) }
            }
        }
    }
}

struct QuestionCard: View {
    let session: ExamSession
    let q: JSON
    var qid: String { q.str("id") ?? "" }
    var answers: JSON { ((session.prep["answers"] as? JSON)?[qid] as? JSON) ?? [:] }
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack { Text(q.str("source") ?? "").font(Theme.ui(12, .semibold)).foregroundStyle(Theme.muted); Spacer(); Text(q.str("difficulty") ?? "").font(Theme.label(10)).foregroundStyle(Theme.muted) }
            MarkdownView(text: q.str("text") ?? "")
            HStack(spacing: 8) {
                Button("Hint") { run(hint: true) }.buttonStyle(.bordered)
                Button("Solution") { run(hint: false) }.buttonStyle(.bordered)
                Button("Solve in a notebook") { solve() }.buttonStyle(.bordered)
            }
            .font(Theme.ui(13, .medium))
            ForEach(["hint", "solution"], id: \.self) { k in
                if let t = session.streaming[k + ":" + qid] ?? answers.str(k) {
                    VStack(alignment: .leading, spacing: 4) { Text(k == "hint" ? "Hint" : "Solution").font(Theme.ui(12, .semibold)).foregroundStyle(Theme.accent); MarkdownView(text: t.isEmpty ? "_Thinking…_" : t, size: 14) }
                        .padding(12).background(Theme.accentSoft.opacity(0.5), in: RoundedRectangle(cornerRadius: 12))
                }
            }
        }
        .padding(14).background(Theme.panel2.opacity(0.6), in: RoundedRectangle(cornerRadius: 14))
    }
    private func run(hint: Bool) {
        let k = hint ? "hint" : "solution"
        guard answers.str(k) == nil, session.streaming[k + ":" + qid] == nil, Claude.hasKey else { return }
        session.streaming[k + ":" + qid] = ""
        Task { @MainActor in
            do {
                let text = try await ExamAI.answer(q, hint: hint) { s in Task { @MainActor in session.streaming[k + ":" + qid] = s } }
                var all = (session.prep["answers"] as? JSON) ?? [:]; var a = (all[qid] as? JSON) ?? [:]; a[k] = text; all[qid] = a
                session.prep["answers"] = all; session.save()
            } catch { session.error = error.localizedDescription }
            session.streaming[k + ":" + qid] = nil
        }
    }
    /// one practice notebook per exam, the question written at the top of a new page
    private func solve() {
        var e = session.exam
        let lib = Library.shared
        var id = e.raw.str("notebookId").flatMap { nid in lib.notes.contains { $0.id == nid } ? nid : nil }
        if id == nil { id = lib.newNotebook(name: "\(e.title.isEmpty ? e.kind.label : e.title) · practice", template: .grid, subject: e.course); e.raw["notebookId"] = id; ExamStore.save(e); session.exam = e }
        guard let nid = id, var doc = lib.loadDoc(nid) else { return }
        var pages = doc.arr("pages")
        let page = pages.count
        pages.append(["id": UID.make()]); doc["pages"] = pages
        let size = PageFormat(rawValue: doc.obj("page")?.str("size") ?? "a4")?.size(landscape: false) ?? PageFormat.a4.size(landscape: false)
        let top = CGFloat(page) * (size.height + NoteDocument.pageGap) + 40
        let text = plain(q.str("text") ?? "")
        var layers = doc.arr("layers")
        if !layers.isEmpty {
            var items = layers[0].arr("items")
            items.append(["t": "x", "id": UID.make(), "text": "\(q.str("source") ?? "")\n\(text)", "fs": 15, "font": "serif", "c": "#16181d", "o": 1, "iw": size.width - 80, "ih": 200, "m": [1, 0, 0, 1, 40, top], "bg": "#fff1a8"])
            layers[0]["items"] = items; doc["layers"] = layers
        }
        lib.save(doc: doc, thumb: nil)
        AppState.shared.say("Added to the practice notebook, page \(page + 1)", 2)
        UIApplication.shared.connectedScenes.compactMap { ($0 as? UIWindowScene)?.keyWindow }.first?.rootViewController?.dismiss(animated: true)
        AppState.shared.open(.note(nid))
    }
}

struct PracticeTab: View {
    let session: ExamSession
    @State private var picked: Set<String> = []
    @State private var making: String?
    @State private var shown: Set<String> = []
    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("TOPICS").font(Theme.label(11)).tracking(0.8).foregroundStyle(Theme.muted)
            FlowChips(items: session.topics.map { ($0.str("id") ?? "", $0.str("title") ?? "") }, picked: $picked)
            HStack(spacing: 10) {
                Button("Five problems on these") { make(mock: false) }.buttonStyle(.borderedProminent).disabled(picked.isEmpty || making != nil)
                Button("Mock exam") { make(mock: true) }.buttonStyle(.bordered).disabled(making != nil)
            }
            if let m = making { HStack { ProgressView(); Text(m).foregroundStyle(Theme.muted) } }
            ForEach(session.prep.arr("practice").reversed(), id: \.self.description) { set in
                let sid = set.str("id") ?? ""
                VStack(alignment: .leading, spacing: 10) {
                    Text(set.str("title") ?? "Practice").font(Theme.ui(16, .semibold))
                    Text("\(set.arr("problems").count) problems · \(set.int("minutes") ?? 0) min").font(Theme.num(11)).foregroundStyle(Theme.muted)
                    ForEach(Array(set.arr("problems").enumerated()), id: \.offset) { i, pr in
                        VStack(alignment: .leading, spacing: 6) {
                            HStack(alignment: .top) { Text("\(i + 1).").font(Theme.ui(14, .semibold)); MarkdownView(text: pr.str("text") ?? "", size: 14) }
                            let key = sid + ":\(i)"
                            Button(shown.contains(key) ? "Hide solution" : "Show solution") { if shown.contains(key) { shown.remove(key) } else { shown.insert(key) } }.font(Theme.ui(12, .medium))
                            if shown.contains(key) { MarkdownView(text: pr.str("solution") ?? "", size: 14).padding(10).background(Theme.accentSoft.opacity(0.5), in: RoundedRectangle(cornerRadius: 10)) }
                        }
                    }
                }
                .padding(14).background(Theme.panel2.opacity(0.6), in: RoundedRectangle(cornerRadius: 14))
            }
        }
        .onAppear { if picked.isEmpty { picked = Set(session.topics.filter { $0.str("weight") == "high" }.prefix(3).compactMap { $0.str("id") }) } }
    }
    private func make(mock: Bool) {
        guard Claude.hasKey else { session.error = "Practice needs a Claude API key. Add it in Settings."; return }
        making = mock ? "Writing a mock exam in the style of your past exams…" : "Writing five problems…"
        let topics = mock ? session.topics : session.topics.filter { picked.contains($0.str("id") ?? "") }
        Task { @MainActor in
            do {
                let data = try await ExamAI.practiceSet(mock: mock, topics: topics, prep: session.prep, exam: session.exam)
                var list = session.prep.arr("practice")
                list.append(["id": UID.make(), "kind": mock ? "mock" : "set", "title": data["title"] ?? "", "minutes": data["minutes"] ?? 0, "problems": data["problems"] ?? [], "at": Date().ms])
                session.prep["practice"] = list; session.save()
            } catch { session.error = error.localizedDescription }
            making = nil
        }
    }
}

struct FlowChips: View {
    let items: [(String, String)]
    @Binding var picked: Set<String>
    var body: some View {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 150), spacing: 8)], alignment: .leading, spacing: 8) {
            ForEach(items, id: \.0) { id, title in
                Button { if picked.contains(id) { picked.remove(id) } else { picked.insert(id) } } label: {
                    Text(title).font(Theme.ui(13, picked.contains(id) ? .semibold : .regular)).lineLimit(1).padding(.horizontal, 12).frame(height: 32).frame(maxWidth: .infinity)
                        .foregroundStyle(picked.contains(id) ? Theme.accent : Theme.fg)
                        .background(picked.contains(id) ? Theme.accentSoft : Theme.panel2, in: Capsule())
                }.buttonStyle(.plain)
            }
        }
    }
}
