import PencilKit
import UIKit

/// Library pictures of notebooks and canvases (first page, or everything on a canvas), and drawing of pictures and
/// text boxes into a plain Core Graphics context (also used for page images sent to the tutor and for export).
enum Thumbnail {
    static func render(doc: NoteDocument, drawing: PKDrawing, width: CGFloat = 270) -> UIImage? {
        if doc.isNotebook { return page(doc: doc, drawing: drawing, index: 0, width: width) }
        let o = doc.origin
        var bb = drawing.bounds.offsetBy(dx: -o.x, dy: -o.y)
        for e in doc.elements { bb = bb.union(e.bounds) }
        let size = CGSize(width: 360, height: 270)
        if bb.isNull || bb.isEmpty { bb = CGRect(x: -180, y: -135, width: 360, height: 270) }
        bb = bb.insetBy(dx: -24, dy: -24)
        let s = min(size.width / bb.width, size.height / bb.height)
        let view = CGRect(x: bb.midX - size.width / s / 2, y: bb.midY - size.height / s / 2, width: size.width / s, height: size.height / s)
        return region(doc: doc, drawing: drawing, rect: view, pixelWidth: size.width, background: UIColor(css: doc.paperColor), grid: true)
    }

    static func page(doc: NoteDocument, drawing: PKDrawing, index: Int, width: CGFloat) -> UIImage? {
        guard doc.pages.indices.contains(index) else { return nil }
        let r = doc.pageRect(index)
        return region(doc: doc, drawing: drawing, rect: r, pixelWidth: width, background: UIColor(css: doc.color(of: index)), template: doc.template(of: index))
    }

    /// any world rect: paper, pictures and text, then the ink
    static func region(doc: NoteDocument, drawing: PKDrawing, rect: CGRect, pixelWidth: CGFloat, background: UIColor, template: String? = nil, grid: Bool = false) -> UIImage? {
        guard rect.width > 0, rect.height > 0 else { return nil }
        let s = pixelWidth / rect.width
        let size = CGSize(width: pixelWidth, height: (rect.height * s).rounded())
        let fmt = UIGraphicsImageRendererFormat(); fmt.scale = 1; fmt.opaque = true
        let o = doc.origin
        return UIGraphicsImageRenderer(size: size, format: fmt).image { ctx in
            let cg = ctx.cgContext
            background.setFill(); cg.fill(CGRect(origin: .zero, size: size))
            cg.saveGState()
            cg.scaleBy(x: s, y: s); cg.translateBy(x: -rect.minX, y: -rect.minY)
            if let t = template { PaperRenderer.drawTemplate(cg, rect: rect, template: t, bg: background, hair: 1 / s) }
            if grid { PaperRenderer.drawCanvasGrid(cg, rect: rect, type: doc.gridType, spacing: doc.gridSpacing, divisions: doc.gridDivisions, bg: background, hair: 1 / s) }
            for e in doc.elements where e.bounds.intersects(rect) { draw(e, in: cg) }
            cg.restoreGState()
            let inkRect = rect.offsetBy(dx: o.x, dy: o.y)
            let ink = drawing.image(from: inkRect, scale: s)
            ink.draw(in: CGRect(origin: .zero, size: size))
        }
    }

    static func draw(_ e: Element, in cg: CGContext, extra: CGAffineTransform = .identity) {
        cg.saveGState()
        cg.concatenate(e.m.concatenating(extra))
        cg.setAlpha(e.opacity)
        let box = CGRect(x: 0, y: 0, width: e.iw, height: e.ih)
        if e.kind == .image, let img = e.loadImage(), let cgImg = img.cgImage {
            var source = cgImg
            if let c = e.crop, let base = e.cropBase {
                let kx = CGFloat(cgImg.width) / base.width, ky = CGFloat(cgImg.height) / base.height
                if let cr = cgImg.cropping(to: CGRect(x: c.minX * kx, y: c.minY * ky, width: c.width * kx, height: c.height * ky).integral) { source = cr }
            }
            cg.saveGState()
            cg.translateBy(x: 0, y: e.ih); cg.scaleBy(x: 1, y: -1)
            cg.draw(source, in: box)
            cg.restoreGState()
        } else if e.kind == .text {
            if let bg = e.bg { cg.setFillColor(UIColor(css: bg).cgColor); cg.addPath(UIBezierPath(roundedRect: box, cornerRadius: 6).cgPath); cg.fillPath() }
            let pad = e.bg != nil ? max(10, e.fontSize * 0.6) : 2
            UIGraphicsPushContext(cg)
            (e.text as NSString).draw(in: box.insetBy(dx: pad, dy: pad), withAttributes: [.font: e.uiFont, .foregroundColor: e.bg != nil ? UIColor(css: "#2a2620") : UIColor(css: e.color), .paragraphStyle: Element.para(e.fontSize)])
            UIGraphicsPopContext()
        }
        cg.restoreGState()
    }
}
