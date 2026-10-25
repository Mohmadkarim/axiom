import UIKit

/// Draws notebook page templates and canvas grids with Core Graphics, in world units (CSS px at 96 dpi), the same
/// patterns and spacings as earlier versions so existing notebooks look unchanged.
enum PaperRenderer {
    static let mm: CGFloat = 96 / 25.4
    static let darkPaper = UIColor(css: "#1c1f25")

    static func isDark(_ c: UIColor) -> Bool { c.luminance < 0.45 }
    static func lineRGB(_ bg: UIColor) -> (CGFloat, CGFloat, CGFloat) { isDark(bg) ? (1, 1, 1) : (40 / 255, 52 / 255, 72 / 255) }

    /// - hair: one device pixel in world units (thin lines stay one pixel at every zoom)
    static func drawTemplate(_ ctx: CGContext, rect: CGRect, template: String, bg: UIColor, hair: CGFloat) {
        let x0 = rect.minX, y0 = rect.minY, x1 = rect.maxX, y1 = rect.maxY, W = rect.width, H = rect.height
        let dark = isDark(bg)
        let (r, g, b) = lineRGB(bg)
        func line(_ a: CGFloat) -> CGColor { UIColor(red: r, green: g, blue: b, alpha: a).cgColor }
        func hl(_ y: CGFloat, _ a: CGFloat, _ w: CGFloat = 1) { ctx.setStrokeColor(line(a)); ctx.setLineWidth(hair * w); ctx.move(to: CGPoint(x: x0, y: y)); ctx.addLine(to: CGPoint(x: x1, y: y)); ctx.strokePath() }
        func vl(_ x: CGFloat, _ a: CGFloat, _ w: CGFloat = 1, _ ya: CGFloat? = nil, _ yb: CGFloat? = nil) { ctx.setStrokeColor(line(a)); ctx.setLineWidth(hair * w); ctx.move(to: CGPoint(x: x, y: ya ?? y0)); ctx.addLine(to: CGPoint(x: x, y: yb ?? y1)); ctx.strokePath() }
        func ruled(_ sp: CGFloat, _ top: CGFloat, _ margin: CGFloat) {
            ctx.setStrokeColor(dark ? UIColor(red: 120 / 255, green: 170 / 255, blue: 1, alpha: 0.22).cgColor : UIColor(red: 70 / 255, green: 120 / 255, blue: 200 / 255, alpha: 0.30).cgColor)
            ctx.setLineWidth(hair)
            var y = y0 + top
            while y < y1 - 6 * mm { ctx.move(to: CGPoint(x: x0, y: y)); ctx.addLine(to: CGPoint(x: x1, y: y)); y += sp }
            ctx.strokePath()
            if margin > 0 {
                ctx.setStrokeColor(dark ? UIColor(red: 1, green: 120 / 255, blue: 120 / 255, alpha: 0.35).cgColor : UIColor(red: 220 / 255, green: 70 / 255, blue: 70 / 255, alpha: 0.45).cgColor)
                ctx.move(to: CGPoint(x: x0 + margin, y: y0)); ctx.addLine(to: CGPoint(x: x0 + margin, y: y1)); ctx.strokePath()
            }
        }
        let css = hair > 0 ? 1 / hair : 1
        func lod(_ sp: CGFloat) -> CGFloat { var s = sp; while s * css < 7 { s *= 2 }; return s }
        func grid(_ sp0: CGFloat, _ a: CGFloat, _ major0: Int = 0) {
            let sp = lod(sp0); let major = sp != sp0 ? 0 : major0
            let nx = Int(floor(W / sp)), ny = Int(floor(H / sp))
            let ox = x0 + (W - CGFloat(nx) * sp) / 2, oy = y0 + (H - CGFloat(ny) * sp) / 2
            ctx.setLineWidth(hair); ctx.setStrokeColor(line(a))
            for i in 0...max(0, nx) where major == 0 || i % major != 0 { ctx.move(to: CGPoint(x: ox + CGFloat(i) * sp, y: oy)); ctx.addLine(to: CGPoint(x: ox + CGFloat(i) * sp, y: oy + CGFloat(ny) * sp)) }
            for j in 0...max(0, ny) where major == 0 || j % major != 0 { ctx.move(to: CGPoint(x: ox, y: oy + CGFloat(j) * sp)); ctx.addLine(to: CGPoint(x: ox + CGFloat(nx) * sp, y: oy + CGFloat(j) * sp)) }
            ctx.strokePath()
            if major > 0 {
                ctx.setStrokeColor(line(a * 2.4))
                for i in stride(from: 0, through: nx, by: major) { ctx.move(to: CGPoint(x: ox + CGFloat(i) * sp, y: oy)); ctx.addLine(to: CGPoint(x: ox + CGFloat(i) * sp, y: oy + CGFloat(ny) * sp)) }
                for j in stride(from: 0, through: ny, by: major) { ctx.move(to: CGPoint(x: ox, y: oy + CGFloat(j) * sp)); ctx.addLine(to: CGPoint(x: ox + CGFloat(nx) * sp, y: oy + CGFloat(j) * sp)) }
                ctx.strokePath()
            }
        }
        ctx.saveGState()
        defer { ctx.restoreGState() }
        switch template {
        case "lined": ruled(7.1 * mm, 22 * mm, 25 * mm)
        case "narrow": ruled(6 * mm, 18 * mm, 20 * mm)
        case "wide": ruled(8.7 * mm, 26 * mm, 30 * mm)
        case "grid": grid(5 * mm, 0.16)
        case "smallgrid": grid(4 * mm, 0.14)
        case "graph": grid(1 * mm, 0.07, 10)
        case "dot", "dotted":
            let sp = lod(5 * mm), rad = hair * 1.25
            let nx = Int(floor(W / sp)), ny = Int(floor(H / sp))
            let ox = x0 + (W - CGFloat(nx) * sp) / 2, oy = y0 + (H - CGFloat(ny) * sp) / 2
            ctx.setFillColor(line(0.38))
            if nx > 1 && ny > 1 { for i in 1..<nx { for j in 1..<ny { ctx.addRect(CGRect(x: ox + CGFloat(i) * sp - rad, y: oy + CGFloat(j) * sp - rad, width: rad * 2, height: rad * 2)) } } }
            ctx.fillPath()
        case "cornell":
            ruled(7.1 * mm, 32 * mm, 0)
            vl(x0 + 62 * mm, 0.45, 1.4, y0 + 24 * mm, y1 - 52 * mm)
            hl(y0 + 24 * mm, 0.45, 1.4); hl(y1 - 52 * mm, 0.45, 1.4)
        case "eng":
            ctx.setFillColor(dark ? UIColor(red: 80 / 255, green: 140 / 255, blue: 90 / 255, alpha: 0.10).cgColor : UIColor(red: 210 / 255, green: 235 / 255, blue: 205 / 255, alpha: 0.55).cgColor)
            ctx.fill(rect)
            grid(5 * mm, 0.13)
            hl(y0 + 20 * mm, 0.5, 1.4); vl(x0 + 20 * mm, 0.35, 1.2)
        case "iso":
            let sp = lod(6 * mm), h3 = sp * sqrt(3) / 2, rad = hair * 1.25
            ctx.setFillColor(line(0.38))
            var j = 0; var y = y0 + 8 * mm
            while y < y1 - 6 * mm {
                var x = x0 + 8 * mm + (j % 2 == 1 ? sp / 2 : 0)
                while x < x1 - 6 * mm { ctx.addRect(CGRect(x: x - rad, y: y - rad, width: rad * 2, height: rad * 2)); x += sp }
                y += h3; j += 1
            }
            ctx.fillPath()
        case "music":
            let st = 2 * mm, block = 22 * mm
            ctx.setStrokeColor(line(0.4)); ctx.setLineWidth(hair)
            var y = y0 + 22 * mm
            while y + 4 * st < y1 - 12 * mm {
                for k in 0..<5 { ctx.move(to: CGPoint(x: x0 + 15 * mm, y: y + CGFloat(k) * st)); ctx.addLine(to: CGPoint(x: x1 - 15 * mm, y: y + CGFloat(k) * st)) }
                y += block
            }
            ctx.strokePath()
        case "polar":
            let c = CGPoint(x: x0 + W / 2, y: y0 + H / 2), R0 = min(W, H) * 0.42
            ctx.setStrokeColor(line(0.16)); ctx.setLineWidth(hair)
            for k in 1...8 { ctx.addEllipse(in: CGRect(x: c.x - R0 * CGFloat(k) / 8, y: c.y - R0 * CGFloat(k) / 8, width: R0 * CGFloat(k) / 4, height: R0 * CGFloat(k) / 4)) }
            for k in 0..<24 { let a = CGFloat(k) * .pi / 12; ctx.move(to: c); ctx.addLine(to: CGPoint(x: c.x + cos(a) * R0, y: c.y + sin(a) * R0)) }
            ctx.strokePath()
        case "todo":
            ruled(9 * mm, 24 * mm, 0)
            ctx.setStrokeColor(line(0.4)); ctx.setLineWidth(hair * 1.2)
            var y = y0 + 24 * mm
            while y < y1 - 6 * mm { ctx.stroke(CGRect(x: x0 + 14 * mm, y: y - 6 * mm, width: 4.2 * mm, height: 4.2 * mm)); y += 9 * mm }
        default: break
        }
    }

    /// canvas background grid over a world rect. type: dot | grid | graph | iso | none ; spacing in world units
    static func drawCanvasGrid(_ ctx: CGContext, rect: CGRect, type: String, spacing: CGFloat, divisions: Int, bg: UIColor, hair: CGFloat, opacity: CGFloat = 1) {
        guard type != "none", spacing > 0 else { return }
        let (r, g, b) = lineRGB(bg)
        func col(_ a: CGFloat) -> CGColor { UIColor(red: r, green: g, blue: b, alpha: a * opacity).cgColor }
        var sp = spacing
        let css = hair > 0 ? 1 / hair : 1
        while sp * css < 9 { sp *= 2 }
        let x0 = floor(rect.minX / sp) * sp, y0 = floor(rect.minY / sp) * sp
        ctx.saveGState(); defer { ctx.restoreGState() }
        switch type {
        case "dot":
            let rad = hair * 1.3
            ctx.setFillColor(col(0.34))
            var x = x0
            while x <= rect.maxX { var y = y0; while y <= rect.maxY { ctx.addRect(CGRect(x: x - rad, y: y - rad, width: rad * 2, height: rad * 2)); y += sp }; x += sp }
            ctx.fillPath()
        case "iso":
            let h3 = sp * sqrt(3) / 2, rad = hair * 1.3
            ctx.setFillColor(col(0.34))
            var j = Int(floor(rect.minY / h3)); var y = CGFloat(j) * h3
            while y <= rect.maxY { var x = floor(rect.minX / sp) * sp + (j % 2 != 0 ? sp / 2 : 0); while x <= rect.maxX { ctx.addRect(CGRect(x: x - rad, y: y - rad, width: rad * 2, height: rad * 2)); x += sp }; y += h3; j += 1 }
            ctx.fillPath()
        default:
            let major = type == "graph" ? max(1, divisions) : 0
            let unit = type == "graph" ? sp / CGFloat(max(1, divisions)) : sp
            let minor = unit * css >= 7 && type == "graph"
            ctx.setLineWidth(hair)
            if minor {
                ctx.setStrokeColor(col(0.07))
                var x = floor(rect.minX / unit) * unit; while x <= rect.maxX { ctx.move(to: CGPoint(x: x, y: rect.minY)); ctx.addLine(to: CGPoint(x: x, y: rect.maxY)); x += unit }
                var y = floor(rect.minY / unit) * unit; while y <= rect.maxY { ctx.move(to: CGPoint(x: rect.minX, y: y)); ctx.addLine(to: CGPoint(x: rect.maxX, y: y)); y += unit }
                ctx.strokePath()
            }
            ctx.setStrokeColor(col(major > 0 ? 0.18 : 0.14))
            var x = x0; while x <= rect.maxX { ctx.move(to: CGPoint(x: x, y: rect.minY)); ctx.addLine(to: CGPoint(x: x, y: rect.maxY)); x += sp }
            var y = y0; while y <= rect.maxY { ctx.move(to: CGPoint(x: rect.minX, y: y)); ctx.addLine(to: CGPoint(x: rect.maxX, y: y)); y += sp }
            ctx.strokePath()
        }
    }
}
