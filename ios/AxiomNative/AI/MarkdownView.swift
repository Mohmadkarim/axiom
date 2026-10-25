import SwiftMath
import SwiftUI

/// Markdown with LaTeX math, drawn natively: headings, paragraphs, lists, quotes, tables, code, $inline$ and
/// $$display$$ math, and the tutor's interactive ```quiz and ```flashcards blocks.
struct MarkdownView: View {
    let text: String
    var size: CGFloat = 15
    var color: UIColor = .label

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            ForEach(Array(MarkdownView.blocks(text).enumerated()), id: \.offset) { _, b in block(b) }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    enum Block {
        case heading(Int, String), paragraph(String), bullet([String]), numbered([String]), quote(String)
        case code(String, String), math(String), table([[String]]), quiz(String), cards(String), rule
    }

    static func blocks(_ s: String) -> [Block] {
        var out: [Block] = []
        let lines = s.replacingOccurrences(of: "\r", with: "").components(separatedBy: "\n")
        var i = 0
        var para: [String] = []
        func flush() { if !para.isEmpty { out.append(.paragraph(para.joined(separator: " "))); para = [] } }
        while i < lines.count {
            let raw = lines[i], line = raw.trimmingCharacters(in: .whitespaces)
            if line.hasPrefix("```") {
                flush()
                let lang = String(line.dropFirst(3)).trimmingCharacters(in: .whitespaces)
                var body: [String] = []; i += 1
                while i < lines.count && !lines[i].trimmingCharacters(in: .whitespaces).hasPrefix("```") { body.append(lines[i]); i += 1 }
                let b = body.joined(separator: "\n")
                out.append(lang == "quiz" ? .quiz(b) : lang == "flashcards" ? .cards(b) : .code(lang, b))
            } else if line.hasPrefix("$$") {
                flush()
                var m = String(line.dropFirst(2))
                if m.hasSuffix("$$") && m.count >= 2 { m = String(m.dropLast(2)) }
                else {
                    i += 1
                    while i < lines.count { let l = lines[i]; if l.contains("$$") { m += "\n" + l.replacingOccurrences(of: "$$", with: ""); break }; m += "\n" + l; i += 1 }
                }
                out.append(.math(m.trimmingCharacters(in: .whitespacesAndNewlines)))
            } else if line.hasPrefix("#") {
                flush()
                let level = line.prefix { $0 == "#" }.count
                out.append(.heading(min(level, 3), String(line.dropFirst(level)).trimmingCharacters(in: .whitespaces)))
            } else if line == "---" || line == "***" {
                flush(); out.append(.rule)
            } else if line.hasPrefix("|") {
                flush()
                var rows: [[String]] = []
                while i < lines.count, lines[i].trimmingCharacters(in: .whitespaces).hasPrefix("|") {
                    let r = lines[i].trimmingCharacters(in: .whitespaces)
                    let cells = r.split(separator: "|", omittingEmptySubsequences: false).dropFirst().dropLast().map { $0.trimmingCharacters(in: .whitespaces) }
                    if !cells.allSatisfy({ $0.allSatisfy { "-: ".contains($0) } }) { rows.append(cells) }
                    i += 1
                }
                out.append(.table(rows)); continue
            } else if line.hasPrefix("- ") || line.hasPrefix("* ") || line.hasPrefix("• ") {
                flush()
                var items: [String] = []
                while i < lines.count {
                    let l = lines[i].trimmingCharacters(in: .whitespaces)
                    if l.hasPrefix("- ") || l.hasPrefix("* ") || l.hasPrefix("• ") { items.append(String(l.dropFirst(2))) }
                    else if !l.isEmpty, !items.isEmpty, lines[i].hasPrefix("  ") { items[items.count - 1] += " " + l }
                    else { break }
                    i += 1
                }
                out.append(.bullet(items)); continue
            } else if let r = line.range(of: #"^\d+[.)]\s"#, options: .regularExpression) {
                flush()
                var items: [String] = [String(line[r.upperBound...])]
                i += 1
                while i < lines.count {
                    let l = lines[i].trimmingCharacters(in: .whitespaces)
                    if let r2 = l.range(of: #"^\d+[.)]\s"#, options: .regularExpression) { items.append(String(l[r2.upperBound...])) }
                    else if !l.isEmpty, lines[i].hasPrefix("  ") { items[items.count - 1] += " " + l }
                    else { break }
                    i += 1
                }
                out.append(.numbered(items)); continue
            } else if line.hasPrefix(">") {
                flush()
                var q: [String] = []
                while i < lines.count, lines[i].trimmingCharacters(in: .whitespaces).hasPrefix(">") { q.append(String(lines[i].trimmingCharacters(in: .whitespaces).dropFirst()).trimmingCharacters(in: .whitespaces)); i += 1 }
                out.append(.quote(q.joined(separator: " "))); continue
            } else if line.isEmpty {
                flush()
            } else {
                para.append(line)
            }
            i += 1
        }
        flush()
        return out
    }

    @ViewBuilder private func block(_ b: Block) -> some View {
        switch b {
        case .heading(let l, let t):
            MathText.text(t, size: l == 1 ? size + 6 : l == 2 ? size + 3 : size + 1, weight: .semibold, color: color).padding(.top, 4)
        case .paragraph(let t):
            MathText.text(t, size: size, color: color).fixedSize(horizontal: false, vertical: true)
        case .bullet(let items):
            VStack(alignment: .leading, spacing: 5) {
                ForEach(Array(items.enumerated()), id: \.offset) { _, it in
                    HStack(alignment: .firstTextBaseline, spacing: 8) { Text("•").font(.system(size: size)); MathText.text(it, size: size, color: color).fixedSize(horizontal: false, vertical: true) }
                }
            }
        case .numbered(let items):
            VStack(alignment: .leading, spacing: 5) {
                ForEach(Array(items.enumerated()), id: \.offset) { k, it in
                    HStack(alignment: .firstTextBaseline, spacing: 8) { Text("\(k + 1).").font(.system(size: size, design: .monospaced)).foregroundStyle(.secondary); MathText.text(it, size: size, color: color).fixedSize(horizontal: false, vertical: true) }
                }
            }
        case .quote(let t):
            HStack(spacing: 10) { RoundedRectangle(cornerRadius: 1.5).fill(Theme.accent).frame(width: 3); MathText.text(t, size: size, color: color.withAlphaComponent(0.85)).italic().fixedSize(horizontal: false, vertical: true) }
        case .code(_, let c):
            ScrollView(.horizontal, showsIndicators: false) { Text(c).font(.system(size: size - 2, design: .monospaced)).padding(10) }
                .background(Theme.panel2, in: RoundedRectangle(cornerRadius: 10))
        case .math(let m):
            ScrollView(.horizontal, showsIndicators: false) { MathText.display(m, size: size + 2, color: color).padding(.vertical, 4) }
                .frame(maxWidth: .infinity)
        case .table(let rows):
            ScrollView(.horizontal, showsIndicators: false) {
                Grid(alignment: .leading, horizontalSpacing: 14, verticalSpacing: 6) {
                    ForEach(Array(rows.enumerated()), id: \.offset) { r, row in
                        GridRow { ForEach(Array(row.enumerated()), id: \.offset) { _, cell in MathText.text(cell, size: size - 1, weight: r == 0 ? .semibold : .regular, color: color) } }
                        if r == 0 { Divider() }
                    }
                }.padding(10)
            }
            .background(Theme.panel2.opacity(0.6), in: RoundedRectangle(cornerRadius: 10))
        case .quiz(let j): QuizCards(json: j, size: size)
        case .cards(let j): FlashCards(json: j, size: size)
        case .rule: Divider()
        }
    }
}

/// Inline text with $math$, as one SwiftUI Text (math becomes inline pictures).
enum MathText {
    private static let cache = NSCache<NSString, UIImage>()

    static func text(_ s: String, size: CGFloat, weight: Font.Weight = .regular, color: UIColor) -> Text {
        var result = Text("")
        for (isMath, part) in split(s) {
            if isMath, let (img, descent) = image(part, size: size, color: color, display: false) {
                result = result + Text(Image(uiImage: img)).baselineOffset(-descent)
            } else {
                let attr = (try? AttributedString(markdown: part, options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace))) ?? AttributedString(part)
                result = result + Text(attr).font(.system(size: size, weight: weight)).foregroundColor(Color(uiColor: color))
            }
        }
        return result
    }
    static func display(_ latex: String, size: CGFloat, color: UIColor) -> some View {
        Group {
            if let (img, _) = image(latex, size: size, color: color, display: true) { Image(uiImage: img) }
            else { Text(latex).font(.system(size: size - 2, design: .monospaced)) }
        }
    }
    /// $…$ (not $$) split from ordinary text; \$ stays a dollar sign
    static func split(_ s: String) -> [(Bool, String)] {
        var out: [(Bool, String)] = []
        var cur = "", inMath = false
        let chars = Array(s)
        var i = 0
        while i < chars.count {
            let c = chars[i]
            if c == "\\" && i + 1 < chars.count && chars[i + 1] == "$" { cur.append("$"); i += 2; continue }
            if c == "$" {
                if !cur.isEmpty { out.append((inMath, cur)); cur = "" }
                inMath.toggle(); i += 1; continue
            }
            cur.append(c); i += 1
        }
        if !cur.isEmpty { out.append((false, inMath ? "$" + cur : cur)) }   // an unclosed $ stays text
        return out
    }
    static func image(_ latex: String, size: CGFloat, color: UIColor, display: Bool) -> (UIImage, CGFloat)? {
        let key = "\(display)|\(size)|\(color.cssHex)|\(latex)" as NSString
        if let c = cache.object(forKey: key) { return (c, c.accessibilityValue.flatMap { Double($0) }.map { CGFloat($0) } ?? 0) }
        var m = MathImage(latex: latex, fontSize: size, textColor: color, labelMode: display ? .display : .text, textAlignment: .left)
        let (err, img, info) = m.asImage()
        guard err == nil, let img else { return nil }
        let descent = info?.descent ?? 0
        img.accessibilityValue = "\(descent)"
        cache.setObject(img, forKey: key)
        return (img, descent)
    }
}

/// ```quiz [{q, options, answer, explain}]
struct QuizCards: View {
    let json: String
    var size: CGFloat
    @State private var picked: [Int: Int] = [:]
    var items: [JSON] { (json.data(using: .utf8).flatMap(JSONIO.parse) as? [Any])?.compactMap { $0 as? JSON } ?? [] }
    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            ForEach(Array(items.enumerated()), id: \.offset) { k, q in
                VStack(alignment: .leading, spacing: 8) {
                    HStack(alignment: .firstTextBaseline, spacing: 6) { Text("\(k + 1).").font(.system(size: size, weight: .semibold)); MathText.text(q.str("q") ?? "", size: size, weight: .medium, color: .label).fixedSize(horizontal: false, vertical: true) }
                    let opts = (q["options"] as? [Any])?.compactMap { $0 as? String } ?? []
                    ForEach(Array(opts.enumerated()), id: \.offset) { o, opt in
                        let answer = q.int("answer") ?? -1
                        let chosen = picked[k]
                        Button { if picked[k] == nil { picked[k] = o } } label: {
                            HStack { MathText.text(opt, size: size - 1, color: .label).multilineTextAlignment(.leading); Spacer()
                                if chosen != nil && o == answer { Image(systemName: "checkmark.circle.fill").foregroundStyle(Theme.ok) } else if chosen == o { Image(systemName: "xmark.circle.fill").foregroundStyle(Theme.danger) }
                            }
                            .padding(10).frame(maxWidth: .infinity, alignment: .leading)
                            .background((chosen != nil && o == answer ? Theme.ok.opacity(0.14) : chosen == o ? Theme.danger.opacity(0.12) : Theme.panel2), in: RoundedRectangle(cornerRadius: 10))
                        }.buttonStyle(.plain)
                    }
                    if picked[k] != nil, let e = q.str("explain") { MathText.text(e, size: size - 1, color: .secondaryLabel).fixedSize(horizontal: false, vertical: true) }
                }
            }
        }
    }
}

/// ```flashcards [{front, back}]
struct FlashCards: View {
    let json: String
    var size: CGFloat
    @State private var index = 0
    @State private var flipped = false
    var cards: [JSON] { (json.data(using: .utf8).flatMap(JSONIO.parse) as? [Any])?.compactMap { $0 as? JSON } ?? [] }
    var body: some View {
        if cards.isEmpty { EmptyView() } else {
            VStack(spacing: 10) {
                Button { withAnimation(.snappy(duration: 0.25)) { flipped.toggle() } } label: {
                    VStack(spacing: 8) {
                        Text(flipped ? "ANSWER" : "QUESTION").font(Theme.label()).tracking(0.8).foregroundStyle(Theme.muted)
                        MathText.text((flipped ? cards[index].str("back") : cards[index].str("front")) ?? "", size: size + 1, color: .label).multilineTextAlignment(.center).fixedSize(horizontal: false, vertical: true)
                    }
                    .padding(18).frame(maxWidth: .infinity, minHeight: 150)
                    .background(flipped ? Theme.accentSoft : Theme.panel2, in: RoundedRectangle(cornerRadius: 14))
                }.buttonStyle(.plain)
                HStack {
                    Button { index = max(0, index - 1); flipped = false } label: { Image(systemName: "chevron.left") }.disabled(index == 0)
                    Spacer()
                    Text("\(index + 1) / \(cards.count)").font(Theme.num(12)).foregroundStyle(Theme.muted)
                    Spacer()
                    Button { index = min(cards.count - 1, index + 1); flipped = false } label: { Image(systemName: "chevron.right") }.disabled(index == cards.count - 1)
                }.padding(.horizontal, 8)
            }
        }
    }
}
