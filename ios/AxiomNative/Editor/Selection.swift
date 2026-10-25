import PencilKit
import UIKit

/// Drawn above the ink: the lasso line, the selection (lifted ink, box, handles) and the laser pointer.
/// It only takes touches on the selection itself; everything else goes through to the page.
final class OverlayView: UIView {
    let world = UIView()                     // world coordinates (transform = world → screen)
    let lifted = UIImageView()               // the selected ink, in world units
    let lasso = CAShapeLayer()
    let box = CAShapeLayer()
    let handles = CAShapeLayer()
    let laser = CAShapeLayer()
    let laserCore = CAShapeLayer()
    var hitPolygon: [CGPoint] = []           // screen polygon of the selection (+ handles) that takes touches
    var hitCircles: [(CGPoint, CGFloat)] = []
    var layoutHook: (() -> Void)?

    override init(frame: CGRect) {
        super.init(frame: frame)
        backgroundColor = .clear
        world.layer.anchorPoint = .zero
        world.isUserInteractionEnabled = false
        addSubview(world)
        lifted.layer.anchorPoint = .zero
        lifted.layer.magnificationFilter = .linear
        world.addSubview(lifted)
        for l in [lasso, box, handles, laser, laserCore] { layer.addSublayer(l); l.fillColor = nil }
        lasso.strokeColor = UIColor.systemBlue.cgColor; lasso.lineWidth = 1.5; lasso.lineDashPattern = [6, 5]
        lasso.fillColor = UIColor.systemBlue.withAlphaComponent(0.06).cgColor
        box.strokeColor = UIColor.systemBlue.cgColor; box.lineWidth = 1.2; box.lineDashPattern = [5, 4]
        handles.fillColor = UIColor.white.cgColor; handles.strokeColor = UIColor.systemBlue.cgColor; handles.lineWidth = 1.5
        handles.shadowColor = UIColor.black.cgColor; handles.shadowOpacity = 0.25; handles.shadowRadius = 2; handles.shadowOffset = CGSize(width: 0, height: 1)
        laser.lineCap = .round; laser.lineJoin = .round; laserCore.lineCap = .round; laserCore.lineJoin = .round
        laserCore.strokeColor = UIColor.white.cgColor
    }
    required init?(coder: NSCoder) { fatalError() }
    override func layoutSubviews() { super.layoutSubviews(); layoutHook?() }
    override func point(inside point: CGPoint, with event: UIEvent?) -> Bool {
        (hitPolygon.count >= 3 && Geometry.pointInPolygon(point, hitPolygon)) || hitCircles.contains { Geometry.dist($0.0, point) < $0.1 }
    }
}

/// What is selected: ink lifted out of the drawing (so it can move freely) and pictures/text boxes.
final class Selection {
    var strokes: [PKStroke]
    var strokeIndices: [Int]
    var elements: [Element]
    let baseDrawing: PKDrawing               // the drawing before the ink was lifted
    let elementsBefore: [JSON]
    var T: CGAffineTransform = .identity     // world-space change being previewed or applied
    let bounds: CGRect                       // world bounds before T
    var moved: Bool { !T.isIdentity }

    init(strokes: [(Int, PKStroke)], elements: [Element], drawing: PKDrawing, origin: CGPoint) {
        let sorted = strokes.sorted { $0.0 < $1.0 }
        self.strokes = sorted.map(\.1)
        strokeIndices = sorted.map(\.0)
        self.elements = elements
        baseDrawing = drawing
        elementsBefore = elements.map(\.json)
        var bb = CGRect.null
        for s in self.strokes { bb = bb.union(s.renderBounds.offsetBy(dx: -origin.x, dy: -origin.y)) }
        for e in elements { bb = bb.union(e.bounds) }
        bounds = bb.isNull ? .zero : bb
    }
    var corners: [CGPoint] {
        let b = bounds.insetBy(dx: -6, dy: -6)
        return [CGPoint(x: b.minX, y: b.minY), CGPoint(x: b.maxX, y: b.minY), CGPoint(x: b.maxX, y: b.maxY), CGPoint(x: b.minX, y: b.maxY)].map { $0.applying(T) }
    }
    var center: CGPoint { CGPoint(x: bounds.midX, y: bounds.midY).applying(T) }
    /// the drawing with the ink lifted out
    func drawingWithout() -> PKDrawing {
        let gone = Set(strokeIndices)
        return PKDrawing(strokes: baseDrawing.strokes.enumerated().filter { !gone.contains($0.offset) }.map(\.element))
    }
    /// the drawing with the (changed) ink put back where it was in the stacking order
    func drawingWith(origin: CGPoint) -> PKDrawing {
        let d = CGAffineTransform(translationX: -origin.x, y: -origin.y).concatenating(T).concatenating(CGAffineTransform(translationX: origin.x, y: origin.y))
        var all = drawingWithout().strokes
        for (k, idx) in strokeIndices.enumerated() {
            let s = strokes[k]
            let moved = moved ? PKStroke(ink: s.ink, path: s.path, transform: s.transform.concatenating(d), mask: s.mask) : s
            all.insert(moved, at: min(idx, all.count))
        }
        return PKDrawing(strokes: all)
    }
}

enum Geometry {
    static func pointInPolygon(_ p: CGPoint, _ poly: [CGPoint]) -> Bool {
        var inside = false
        var j = poly.count - 1
        for i in 0..<poly.count {
            let a = poly[i], b = poly[j]
            if (a.y > p.y) != (b.y > p.y), p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y + 1e-9) + a.x { inside.toggle() }
            j = i
        }
        return inside
    }
    static func dist(_ a: CGPoint, _ b: CGPoint) -> CGFloat { hypot(a.x - b.x, a.y - b.y) }
    static func distToSegment(_ p: CGPoint, _ a: CGPoint, _ b: CGPoint) -> CGFloat {
        let dx = b.x - a.x, dy = b.y - a.y, l = dx * dx + dy * dy
        guard l > 0 else { return dist(p, a) }
        let t = max(0, min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l))
        return dist(p, CGPoint(x: a.x + t * dx, y: a.y + t * dy))
    }

    /// world points of a stroke (every few units)
    static func points(_ s: PKStroke, origin: CGPoint, step: CGFloat = 4) -> [CGPoint] {
        s.path.interpolatedPoints(by: .distance(step)).map { $0.location.applying(s.transform) }.map { CGPoint(x: $0.x - origin.x, y: $0.y - origin.y) }
    }
    /// the topmost stroke under a world point
    static func strokeAt(_ p: CGPoint, drawing: PKDrawing, origin: CGPoint, tolerance: CGFloat) -> Int? {
        let q = CGPoint(x: p.x + origin.x, y: p.y + origin.y)
        for (i, s) in drawing.strokes.enumerated().reversed() {
            guard s.renderBounds.insetBy(dx: -tolerance, dy: -tolerance).contains(q) else { continue }
            let pts = s.path.interpolatedPoints(by: .distance(2)).map { $0.location.applying(s.transform) }
            let w = (s.path.first?.size.width ?? 2) / 2
            var prev: CGPoint?
            for pt in pts {
                if let a = prev { if distToSegment(q, a, pt) < tolerance + w { return i } } else if dist(q, pt) < tolerance + w { return i }
                prev = pt
            }
        }
        return nil
    }
    /// strokes mostly inside a world polygon (85% of up to 40 samples, as before)
    static func strokesInside(_ poly: [CGPoint], drawing: PKDrawing, origin: CGPoint) -> [Int] {
        let xs = poly.map(\.x), ys = poly.map(\.y)
        guard let x0 = xs.min(), let x1 = xs.max(), let y0 = ys.min(), let y1 = ys.max() else { return [] }
        let box = CGRect(x: x0 + origin.x, y: y0 + origin.y, width: x1 - x0, height: y1 - y0)
        var out: [Int] = []
        for (i, s) in drawing.strokes.enumerated() where s.renderBounds.intersects(box) {
            let pts = points(s, origin: origin, step: 3)
            guard !pts.isEmpty else { continue }
            let step = max(1, pts.count / 40)
            var ins = 0, tot = 0
            for k in stride(from: 0, to: pts.count, by: step) { tot += 1; if pointInPolygon(pts[k], poly) { ins += 1 } }
            if Double(ins) >= Double(tot) * 0.85 { out.append(i) }
        }
        return out
    }
    /// the word or formula written in one go around a stroke: strokes that touch or nearly touch on the same line
    static func wordAround(_ index: Int, drawing: PKDrawing) -> [Int] {
        let strokes = drawing.strokes
        guard strokes.indices.contains(index) else { return [] }
        var box = strokes[index].renderBounds
        let pad = max(8, min(40, box.height * 0.45))
        var out: Set<Int> = [index]
        var grew = true
        while grew {
            grew = false
            for (i, s) in strokes.enumerated() where !out.contains(i) {
                let b = s.renderBounds
                let near = b.minX <= box.maxX + pad && b.maxX >= box.minX - pad && b.minY <= box.maxY + pad * 0.4 && b.maxY >= box.minY - pad * 0.4
                if near && b.height < max(box.height * 2.5, 60) { out.insert(i); box = box.union(b); grew = true }
            }
        }
        return out.sorted()
    }
}

extension CGAffineTransform {
    static func about(_ t: CGAffineTransform, _ c: CGPoint) -> CGAffineTransform {
        CGAffineTransform(translationX: -c.x, y: -c.y).concatenating(t).concatenating(CGAffineTransform(translationX: c.x, y: c.y))
    }
}
