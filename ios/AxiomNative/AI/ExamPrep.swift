import Observation
import PDFKit
import PencilKit
import UIKit

/// Exam preparation: the test's details and materials (settings.exams), and what Claude built from them
/// (exprep_<id>: summary, topics, past questions, gaps, a daily plan, topic guides, hints/solutions, practice sets).
enum ExamKind: String, CaseIterable { case exam, quiz, lab, other
    var label: String { ["exam": "Exam", "quiz": "Quiz", "lab": "Lab", "other": "Other"][rawValue]! }
}
enum MaterialRole: String, CaseIterable { case syllabus, past, problems, notes
    var label: String { ["syllabus": "Syllabus", "past": "Past exam", "problems": "Problem set", "notes": "Notes or slides"][rawValue]! }
}

struct ExamInfo: Identifiable, Equatable {
    var id: String
    var title: String
    var kind: ExamKind
    var course: String?
    var date: Date
    var files: [JSON]                   // {id, name, type, role, size}
    var books: [JSON]                   // {docId, from, to}
    var notebooks: [String]
    var notes: String
    var built: Bool
    var raw: JSON
    static func == (a: ExamInfo, b: ExamInfo) -> Bool { a.id == b.id && a.title == b.title && a.date == b.date && a.built == b.built && a.files.count == b.files.count && a.books.count == b.books.count && a.notebooks == b.notebooks && a.notes == b.notes && a.course == b.course && a.kind == b.kind }

    init(raw j: JSON) {
        raw = j
        id = j.str("id") ?? UID.make(); title = j.str("title") ?? "Exam"; kind = ExamKind(rawValue: j.str("kind") ?? "exam") ?? .exam
        course = j.str("course"); date = Date(ms: j.num("date") ?? Date().ms); files = j.arr("files"); books = j.arr("books")
        notebooks = (j["notebooks"] as? [Any])?.compactMap { $0 as? String } ?? []; notes = j.str("notes") ?? ""; built = j.bool("built")
    }
    static func new() -> ExamInfo {
        var d = Calendar.current.date(byAdding: .day, value: 7, to: Date())!
        d = Calendar.current.date(bySettingHour: 9, minute: 30, second: 0, of: d) ?? d
        return ExamInfo(raw: ["id": UID.make(), "title": "", "kind": "exam", "date": d.ms, "files": [] as [Any], "books": [] as [Any], "notebooks": [] as [Any], "notes": "", "created": Date().ms])
    }
    var json: JSON {
        var j = raw
        j["id"] = id; j["title"] = title; j["kind"] = kind.rawValue; j["course"] = course ?? NSNull(); j["date"] = date.ms
        j["files"] = files; j["books"] = books; j["notebooks"] = notebooks; j["notes"] = notes; j["built"] = built
        return j
    }
    var daysLeft: Int { Calendar.current.dateComponents([.day], from: Calendar.current.startOfDay(for: Date()), to: Calendar.current.startOfDay(for: date)).day ?? 0 }
    var leftLabel: String { let d = daysLeft; return d < 0 ? "Done" : d == 0 ? "Today" : d == 1 ? "Tomorrow" : "In \(d) days" }
}

enum ExamStore {
    static var all: [ExamInfo] { Library.shared.settings.arr("exams").map(ExamInfo.init(raw:)) }
    static func save(_ e: ExamInfo) {
        var list = Library.shared.settings.arr("exams")
        if let i = list.firstIndex(where: { $0.str("id") == e.id }) { list[i] = e.json } else { list.append(e.json) }
        Library.shared.set("exams", list)
    }
    static func delete(_ e: ExamInfo) {
        Library.shared.set("exams", Library.shared.settings.arr("exams").filter { $0.str("id") != e.id })
        for f in e.files { if let id = f.str("id") { Store.shared.deleteFile("exf_" + id) } }
        Store.shared.deleteFile("exprep_" + e.id)
    }
    static func loadPrep(_ id: String) -> JSON { Store.shared.loadFile("exprep_" + id).flatMap(JSONIO.object) ?? [:] }
    static func savePrep(_ id: String, _ p: JSON) { if let d = JSONIO.data(p) { Store.shared.saveFile("exprep_" + id, d) } }
    /// the sessions of the plan with keys "YYYY-MM-DD:i"
    static func sessions(_ p: JSON) -> [(key: String, day: String, s: JSON)] {
        p.arr("plan").flatMap { d in d.arr("sessions").enumerated().map { (d.str("day")! + ":\($0.offset)", d.str("day") ?? "", $0.element) } }
    }
    static func todayKey() -> String { let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd"; return f.string(from: Date()) }
}

enum ExamAI {
    static let style = "The student is a university STEM student (mathematics and physics). Use precise mathematical language; give structural reasons (definitions, hypotheses of theorems, why a step is valid), not recipes; no analogies unless asked. Write all mathematics in LaTeX ($...$ inline, $$...$$ display). Markdown formatting."

    static let schema: JSON = {
        func obj(_ props: JSON, _ req: [String]) -> JSON { ["type": "object", "properties": props, "required": req, "additionalProperties": false] }
        let str: JSON = ["type": "string"], strs: JSON = ["type": "array", "items": str]
        return obj([
            "summary": ["type": "string", "description": "Two or three sentences: what this test is about and how to win it"],
            "format": ["type": "string", "description": "The expected format (length, number and type of questions) if it can be inferred, else empty"],
            "topics": ["type": "array", "items": obj(["id": ["type": "string", "description": "short id like t1"], "title": str, "weight": ["type": "string", "enum": ["high", "medium", "low"]],
                                                     "why": ["type": "string", "description": "What exactly gets asked about it (from past exams / syllabus)"],
                                                     "sources": ["type": "string", "description": "Where to learn it: book pages, files, notes"], "subtopics": strs], ["id", "title", "weight", "why", "sources", "subtopics"])],
            "questions": ["type": "array", "items": obj(["id": ["type": "string", "description": "q1, q2…"], "source": ["type": "string", "description": "e.g. \"Midterm 2023, Q3\" or \"Problem set 2, #4\""],
                                                        "file": ["type": "integer", "description": "File number it comes from (1-based), 0 if none"], "page": ["type": "integer", "description": "Page within that file (1-based), 0 if unknown"],
                                                        "text": ["type": "string", "description": "The full question, transcribed faithfully in Markdown with LaTeX"], "topics": strs,
                                                        "difficulty": ["type": "string", "enum": ["easy", "medium", "hard"]]], ["id", "source", "file", "page", "text", "topics", "difficulty"])],
            "gaps": ["type": "array", "items": obj(["topic": str, "note": str], ["topic", "note"]), "description": "Topics in the syllabus or chapters that past exams never asked about"],
            "plan": ["type": "array", "items": obj(["day": ["type": "string", "description": "YYYY-MM-DD"],
                                                   "sessions": ["type": "array", "items": obj(["minutes": ["type": "integer"], "kind": ["type": "string", "enum": ["learn", "practice", "review", "mock"]], "topics": strs,
                                                                                               "task": ["type": "string", "description": "One concrete instruction, e.g. \"Work past questions q3, q7 without notes\""]], ["minutes", "kind", "topics", "task"])]], ["day", "sessions"])],
        ], ["summary", "format", "topics", "questions", "gaps", "plan"])
    }()
    static let setSchema: JSON = [
        "type": "object", "additionalProperties": false, "required": ["title", "minutes", "problems"],
        "properties": ["title": ["type": "string"], "minutes": ["type": "integer"],
                       "problems": ["type": "array", "items": ["type": "object", "additionalProperties": false, "required": ["text", "topics", "solution"],
                                                               "properties": ["text": ["type": "string"], "topics": ["type": "array", "items": ["type": "string"]], "solution": ["type": "string"]]] as JSON]] as JSON,
    ]

    /// the materials as message blocks
    static func materials(_ e: ExamInfo) -> (blocks: [JSON], count: Int) {
        var blocks: [JSON] = [], count = 0
        for (i, f) in e.files.enumerated() {
            guard let id = f.str("id"), let data = Store.shared.loadFile("exf_" + id) else { continue }
            let role = MaterialRole(rawValue: f.str("role") ?? "notes")?.label ?? "Material"
            blocks.append(Claude.text("File \(i + 1): \"\(f.str("name") ?? "file")\" — \(role)"))
            if (f.str("type") ?? "").contains("pdf") { blocks.append(Claude.pdf(data, title: f.str("name") ?? "file")) }
            else if let img = UIImage(data: data), let j = Tutor.jpeg(img, 1600) { blocks.append(Claude.image(jpeg: j)) }
            count += 1
        }
        for b in e.books {
            guard let docID = b.str("docId"), let meta = Library.shared.books.first(where: { $0.id == docID }), let data = Store.shared.loadFile(meta.fileID), let pdf = PDFDocument(data: data) else { continue }
            let from = max(1, b.int("from") ?? 1), to = min(pdf.pageCount, b.int("to") ?? from)
            var text = ""
            if from <= to { for n in from...to where text.count < 90000 { text += "\n[p. \(n)]\n" + (pdf.page(at: n - 1)?.string ?? "").replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression) } }
            blocks.append(Claude.text("Book \"\(cleanTitle(meta.name))\", PDF pages \(from)–\(to):" + String(text.prefix(90000))))
            count += 1
        }
        for id in e.notebooks {
            guard let doc = NoteDocument(id: id) else { continue }
            let ink = doc.loadInk(), o = doc.origin
            var shots: [UIImage] = []
            if doc.isNotebook {
                for i in doc.pages.indices where shots.count < 8 {
                    let r = doc.pageRect(i)
                    if ink.strokes.contains(where: { r.intersects($0.renderBounds.offsetBy(dx: -o.x, dy: -o.y)) }) || doc.elements.contains(where: { r.intersects($0.bounds) }),
                       let img = Thumbnail.page(doc: doc, drawing: ink, index: i, width: 900) { shots.append(img) }
                }
            } else if let img = Thumbnail.render(doc: doc, drawing: ink) { shots.append(img) }
            if !shots.isEmpty {
                blocks.append(Claude.text("The student's handwritten notes \"\(doc.name)\":"))
                blocks += shots.compactMap { Tutor.jpeg($0, 900).map(Claude.image) }
                count += 1
            }
        }
        return (blocks, count)
    }

    static func buildPlan(_ e: ExamInfo, prep: JSON, onStatus: @escaping (String) -> Void) async throws -> JSON {
        onStatus("Gathering your materials…")
        let (blocks, count) = materials(e)
        if blocks.isEmpty && e.notes.trimmingCharacters(in: .whitespaces).isEmpty { throw Claude.APIError(status: -1, message: "Add at least one material (a syllabus, past exam, chapters or notes) first.") }
        let left = max(0, e.daysLeft)
        let done = (prep["done"] as? JSON) ?? [:]
        let doneTasks = ExamStore.sessions(prep).filter { done[$0.key] != nil }.map { $0.s.str("task") ?? "" }.joined(separator: "; ")
        let df = DateFormatter(); df.dateStyle = .full; df.timeStyle = .short; df.locale = Locale(identifier: "en")
        let tf = DateFormatter(); tf.dateStyle = .full; tf.locale = Locale(identifier: "en")
        let course = Library.shared.subject(e.course)?.name
        var system = "You prepare a university student for a \(e.kind.label.lowercased()): \"\(e.title)\"\(course.map { " in \($0)" } ?? ""), on \(df.string(from: e.date)). Today is \(tf.string(from: Date())), so there \(left == 1 ? "is 1 day" : "are \(left) days") left.\n\(style)\n"
        system += "Work from the materials only (and standard knowledge of the subject to fill gaps):\n"
        system += "1. Topics: exactly what will be tested, specific (named theorems, techniques, derivations, lab procedures), weighted by how often past exams and problem sets use them. Use ids t1, t2, …\n"
        system += "2. Questions: transcribe EVERY question from the past exams and problem sets faithfully (all parts), with its file number and page, tagged with topic ids.\n"
        system += "3. Gaps: syllabus or chapter topics that past exams never asked; they still need preparation.\n"
        system += "4. Plan: one entry per day from today until the day before the test (today included\(left == 0 ? "; the test is today, so make a short plan for the remaining hours" : "")). 1–4 sessions per day of 25–50 minutes. Start with high-weight topics, alternate learning with practice on real past questions (name them by id), use spaced review, and end with a timed mock exam built from past questions the day before. "
        if e.kind == .lab { system += "For a lab: theory, the procedure step by step, the pre-lab questions, error analysis and the report format." }
        if !doneTasks.isEmpty { system += "\nThe student has already completed these sessions: " + String(doneTasks.prefix(2000)) }
        onStatus("Reading \(count) material\(count == 1 ? "" : "s") and planning \(left) day\(left == 1 ? "" : "s")… this takes a minute or two.")
        let content = blocks + [Claude.text((e.notes.isEmpty ? "" : "Notes from the student: \(e.notes)\n\n") + "Build the preparation.")]
        var chars = 0
        let data = try await Claude.json(system: [Claude.text(system)], messages: [["role": "user", "content": content]], schema: schema, maxTokens: 48000, effort: "medium",
                                         onText: { t in if t.count - chars > 400 { chars = t.count; Task { @MainActor in onStatus("Writing your plan… \(chars / 1000)k characters") } } })
        var p = prep
        for k in ["summary", "format", "topics", "questions", "gaps", "plan"] { p[k] = data[k] }
        p["builtAt"] = Date().ms
        p["done"] = [:] as JSON
        return p
    }

    static func guide(topic t: JSON, prep: JSON, exam: ExamInfo, onText: @escaping (String) -> Void) async throws -> String {
        let tid = t.str("id") ?? ""
        let qs = prep.arr("questions").filter { (($0["topics"] as? [Any]) ?? []).contains { ($0 as? String) == tid } }.prefix(8).map { "- (\($0.str("id") ?? ""), \($0.str("source") ?? "")) \($0.str("text") ?? "")" }.joined(separator: "\n")
        let system = """
        You write one living study guide for a topic, read top-down. \(style)
        Format exactly:
        ## Big picture
        4–7 numbered one-line statements; line k maps to part k.
        ## 1. <title>
        Start with the main idea in one sentence, then the core content: definitions with hypotheses, key results, the formula in a $$ block, short bullets, one small worked example. Every symbol defined before use. Mark approximations and assumptions explicitly.
        (continue ## 2., ## 3. …)
        ## Quick reference
        A small table of the rules and formulas needed in the exam.
        Keep the big picture and the parts short; depth comes later as follow-up blocks. Separate paragraphs with blank lines.
        """
        let subs = ((t["subtopics"] as? [Any]) ?? []).compactMap { $0 as? String }.joined(separator: "; ")
        let user = "Topic: \(t.str("title") ?? "")\nWhat gets asked: \(t.str("why") ?? "")\nSubtopics: \(subs)\nWhere it is in the student's materials: \(t.str("sources") ?? "")\nPast questions on it:\n\(qs.isEmpty ? "(none)" : qs)\nTest: \(exam.title) (\(exam.kind.label))."
        return try await Claude.stream(system: [Claude.text(system)], messages: [["role": "user", "content": user]], maxTokens: 16000, effort: "medium", onText: onText).text
    }

    static func deeper(above: String, line: String, question: String, onText: @escaping (String) -> Void) async throws -> String {
        let system = "You answer a follow-up question about one line of a study guide. The answer is inserted directly under that line. \(style)\nRules: assume ONLY what appears in the guide above the line (given below). If you need a term not defined above, define it first. Build from definitions: what the objects are, which assumptions are made where, which step is an approximation. Give the structural reason. Include one tiny concrete example or numeric check when it makes the step obvious. Be concise; do not repeat the guide. No heading."
        let user = "The guide up to and including the line:\n\"\"\"\n\(String(above.suffix(14000)))\n\"\"\"\n\nThe line the student asks about:\n\"\"\"\n\(line)\n\"\"\"\n\nQuestion: \(question)"
        return try await Claude.stream(system: [Claude.text(system)], messages: [["role": "user", "content": user]], maxTokens: 8000, effort: "medium", onText: onText).text
    }

    static func answer(_ q: JSON, hint: Bool, onText: @escaping (String) -> Void) async throws -> String {
        let system = "\(style) " + (hint ? "Give one hint that unlocks the next step. Do not solve it. Two to four sentences." : "Give a complete, rigorous solution: state what is used (with hypotheses checked), every step justified, and end with what the examiner looks for and common mistakes.")
        return try await Claude.stream(system: [Claude.text(system)], messages: [["role": "user", "content": "Question (\(q.str("source") ?? "")):\n\(q.str("text") ?? "")"]], maxTokens: 16000, effort: hint ? "low" : "high", onText: onText).text
    }

    static func practiceSet(mock: Bool, topics: [JSON], prep: JSON, exam: ExamInfo) async throws -> JSON {
        let examples = String(prep.arr("questions").prefix(14).map { "- \($0.str("source") ?? ""): \($0.str("text") ?? "")" }.joined(separator: "\n").prefix(12000))
        let fmt = prep.str("format") ?? ""
        let ask = mock ? "A full mock \(exam.kind.label.lowercased()) with the expected format\(fmt.isEmpty ? "" : " (\(fmt))"), covering the topics in proportion to their weight." : "Five problems, from easier to harder."
        let user = "\(ask)\nTopics: \(topics.map { "\($0.str("id") ?? ""): \($0.str("title") ?? "") (\($0.str("why") ?? ""))" }.joined(separator: "\n"))\nPast questions for style:\n\(examples.isEmpty ? "(none given)" : examples)"
        let system = "\(style) You write new practice problems for \"\(exam.title)\". Match the style, length and difficulty of the past questions; never copy them. Every problem gets a complete rigorous solution."
        return try await Claude.json(system: [Claude.text(system)], messages: [["role": "user", "content": user]], schema: setSchema, maxTokens: 24000, effort: "medium")
    }

    /// split a guide into blocks on headings and blank lines (math and code blocks kept whole)
    static func splitBlocks(_ md: String) -> [String] {
        var out: [String] = [], cur: [String] = [], fence = false, math = false
        for line in md.components(separatedBy: "\n") {
            let t = line.trimmingCharacters(in: .whitespaces)
            if t.hasPrefix("```") { fence.toggle() }
            if t.hasPrefix("$$") && !(t.count > 2 && t.hasSuffix("$$")) { math.toggle() }
            if !fence && !math {
                if t.isEmpty { if !cur.isEmpty { out.append(cur.joined(separator: "\n")); cur = [] }; continue }
                if t.hasPrefix("#") && !cur.isEmpty { out.append(cur.joined(separator: "\n")); cur = [] }
            }
            cur.append(line)
        }
        if !cur.isEmpty { out.append(cur.joined(separator: "\n")) }
        return out
    }
}
