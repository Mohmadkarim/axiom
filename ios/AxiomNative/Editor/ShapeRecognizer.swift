import CoreGraphics
import Foundation

/// Draw-and-hold shapes: a freehand stroke becomes a clean line, arc, circle, ellipse, triangle, rectangle, square or
/// polygon (the same rules as earlier versions).
enum ShapeRecognizer {
    struct Shape { let kind: String; let points: [CGPoint]; let sharp: Bool }

    static func recognize(_ P: [CGPoint]) -> Shape? {
        guard P.count >= 4 else { return nil }
        let L = length(P)
        let xs = P.map(\.x), ys = P.map(\.y)
        let diag = hypot(xs.max()! - xs.min()!, ys.max()! - ys.min()!)
        guard diag >= 4 else { return nil }
        let first = P[0], last = P[P.count - 1]
        let chord = hypot(last.x - first.x, last.y - first.y)
        let step = max(diag / 80, 0.5)

        if chord / L > 0.94 { return Shape(kind: "line", points: densify([first, last], step), sharp: false) }

        let closed = chord < max(0.18 * L, diag * 0.22)
        if closed {
            let R = resample(P, L / 120)
            var cx: CGFloat = 0, cy: CGFloat = 0
            for p in R { cx += p.x; cy += p.y }
            cx /= CGFloat(R.count); cy /= CGFloat(R.count)
            var sxx: CGFloat = 0, syy: CGFloat = 0, sxy: CGFloat = 0
            for p in R { sxx += (p.x - cx) * (p.x - cx); syy += (p.y - cy) * (p.y - cy); sxy += (p.x - cx) * (p.y - cy) }
            sxx /= CGFloat(R.count); syy /= CGFloat(R.count); sxy /= CGFloat(R.count)
            let tr = sxx + syy, det = sxx * syy - sxy * sxy
            let root = sqrt(max(0, tr * tr / 4 - det))
            let l1 = tr / 2 + root, l2 = tr / 2 - root
            let rot = 0.5 * atan2(2 * sxy, sxx - syy)
            var rx = sqrt(2 * l1), ry = sqrt(2 * max(l2, 0))
            let c = cos(-rot), s = sin(-rot)
            var err: CGFloat = 0
            for p in R {
                let lx = (p.x - cx) * c - (p.y - cy) * s, ly = (p.x - cx) * s + (p.y - cy) * c
                err += abs(hypot(lx / (rx == 0 ? 1 : rx), ly / (ry == 0 ? 1 : ry)) - 1)
            }
            err /= CGFloat(R.count)

            var simp = rdp(P + [P[0]], diag * 0.085)
            if simp.count > 2, hypot(simp[0].x - simp[simp.count - 1].x, simp[0].y - simp[simp.count - 1].y) < diag * 0.1 { simp.removeLast() }
            var corners: [CGPoint] = []
            for i in simp.indices {
                let a = simp[(i - 1 + simp.count) % simp.count], b = simp[i], cc = simp[(i + 1) % simp.count]
                if angle(a, b, cc) < 160 * .pi / 180 { corners.append(b) }
            }
            let k = corners.count
            if (k == 3 || k == 4) && err > 0.075 {
                if k == 4 {
                    var rectish = true
                    for i in 0..<4 {
                        let a = corners[(i + 3) % 4], b = corners[i], cc = corners[(i + 1) % 4]
                        if abs(cos(angle(a, b, cc))) > 0.3 { rectish = false }
                    }
                    if rectish {
                        var best: CGFloat = 0, ang: CGFloat = 0
                        for i in 0..<4 {
                            let a = corners[i], b = corners[(i + 1) % 4], d = hypot(b.x - a.x, b.y - a.y)
                            if d > best { best = d; ang = atan2(b.y - a.y, b.x - a.x) }
                        }
                        let snapA = (ang / (.pi / 2)).rounded() * (.pi / 2)
                        if abs(ang - snapA) < 8 * .pi / 180 { ang = snapA }
                        let ca = cos(-ang), sa = sin(-ang)
                        let ccx = corners.map(\.x).reduce(0, +) / 4, ccy = corners.map(\.y).reduce(0, +) / 4
                        var mx0 = CGFloat.infinity, my0 = CGFloat.infinity, mx1 = -CGFloat.infinity, my1 = -CGFloat.infinity
                        for p in corners {
                            let lx = (p.x - ccx) * ca - (p.y - ccy) * sa, ly = (p.x - ccx) * sa + (p.y - ccy) * ca
                            mx0 = min(mx0, lx); mx1 = max(mx1, lx); my0 = min(my0, ly); my1 = max(my1, ly)
                        }
                        var w = mx1 - mx0, h = my1 - my0
                        let square = abs(w - h) / max(w, h) < 0.1
                        if square { w = (w + h) / 2; h = w }
                        let c2 = cos(ang), s2 = sin(ang)
                        let loc = [CGPoint(x: -w / 2, y: -h / 2), CGPoint(x: w / 2, y: -h / 2), CGPoint(x: w / 2, y: h / 2), CGPoint(x: -w / 2, y: h / 2), CGPoint(x: -w / 2, y: -h / 2)]
                        let world = loc.map { CGPoint(x: ccx + $0.x * c2 - $0.y * s2, y: ccy + $0.x * s2 + $0.y * c2) }
                        return Shape(kind: square ? "square" : "rectangle", points: densify(world, step), sharp: true)
                    }
                }
                return Shape(kind: k == 3 ? "triangle" : "polygon", points: densify(corners + [corners[0]], step), sharp: true)
            }
            if k >= 5 && k <= 8 && err > 0.11 { return Shape(kind: "polygon", points: densify(corners + [corners[0]], step), sharp: true) }
            if err < 0.16 {
                if abs(rx - ry) / max(rx, ry) < 0.12 { let rr = (rx + ry) / 2; rx = rr; ry = rr }
                return Shape(kind: rx == ry ? "circle" : "ellipse", points: ellipse(cx, cy, rx, ry, rot, 120), sharp: false)
            }
            return nil
        }
        let mid = P[P.count / 2]
        if let (ux, uy, rr) = circle3(first, mid, last) {
            var err: CGFloat = 0
            for p in P { err += abs(hypot(p.x - ux, p.y - uy) - rr) }
            err /= CGFloat(P.count) * rr
            if err < 0.06 && rr < diag * 6 {
                let a0 = atan2(first.y - uy, first.x - ux), am = atan2(mid.y - uy, mid.x - ux), a1 = atan2(last.y - uy, last.x - ux)
                func norm(_ a: CGFloat) -> CGFloat { (a.truncatingRemainder(dividingBy: 2 * .pi) + 2 * .pi).truncatingRemainder(dividingBy: 2 * .pi) }
                let ccw = norm(am - a0) < norm(a1 - a0)
                let sweep = ccw ? norm(a1 - a0) : -norm(a0 - a1)
                let N = max(12, Int(ceil(abs(sweep) * rr / step)))
                let arc = (0...N).map { i -> CGPoint in let t = a0 + sweep * CGFloat(i) / CGFloat(N); return CGPoint(x: ux + rr * cos(t), y: uy + rr * sin(t)) }
                return Shape(kind: "arc", points: arc, sharp: false)
            }
        }
        return nil
    }

    static func length(_ P: [CGPoint]) -> CGFloat { zip(P, P.dropFirst()).reduce(0) { $0 + hypot($1.1.x - $1.0.x, $1.1.y - $1.0.y) } }
    static func angle(_ a: CGPoint, _ b: CGPoint, _ c: CGPoint) -> CGFloat {
        let v1 = CGPoint(x: a.x - b.x, y: a.y - b.y), v2 = CGPoint(x: c.x - b.x, y: c.y - b.y)
        let d = (hypot(v1.x, v1.y) * hypot(v2.x, v2.y))
        return acos(max(-1, min(1, (v1.x * v2.x + v1.y * v2.y) / (d == 0 ? 1 : d))))
    }
    static func densify(_ P: [CGPoint], _ step: CGFloat) -> [CGPoint] {
        var o = [P[0]]
        for i in 1..<P.count {
            let a = P[i - 1], b = P[i], d = hypot(b.x - a.x, b.y - a.y), k = max(1, Int(ceil(d / step)))
            for j in 1...k { o.append(CGPoint(x: a.x + (b.x - a.x) * CGFloat(j) / CGFloat(k), y: a.y + (b.y - a.y) * CGFloat(j) / CGFloat(k))) }
        }
        return o
    }
    static func resample(_ P: [CGPoint], _ step: CGFloat) -> [CGPoint] {
        guard P.count > 1, step > 0 else { return P }
        var out = [P[0]], carry: CGFloat = 0
        for i in 1..<P.count {
            let a = P[i - 1], b = P[i], seg = hypot(b.x - a.x, b.y - a.y)
            var d = step - carry
            while d <= seg { let t = d / seg; out.append(CGPoint(x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t)); d += step }
            carry = seg - (d - step)
        }
        return out
    }
    static func rdp(_ P: [CGPoint], _ eps: CGFloat) -> [CGPoint] {
        guard P.count >= 3 else { return P }
        var dmax: CGFloat = 0, idx = 0
        let a = P[0], b = P[P.count - 1]
        for i in 1..<(P.count - 1) { let d = Geometry.distToSegment(P[i], a, b); if d > dmax { dmax = d; idx = i } }
        if dmax > eps { return Array(rdp(Array(P[0...idx]), eps).dropLast()) + rdp(Array(P[idx...]), eps) }
        return [a, b]
    }
    static func ellipse(_ cx: CGFloat, _ cy: CGFloat, _ rx: CGFloat, _ ry: CGFloat, _ rot: CGFloat, _ n: Int) -> [CGPoint] {
        let c = cos(rot), s = sin(rot)
        return (0...n).map { i in let t = CGFloat(i) / CGFloat(n) * 2 * .pi, x = rx * cos(t), y = ry * sin(t); return CGPoint(x: cx + x * c - y * s, y: cy + x * s + y * c) }
    }
    static func circle3(_ a: CGPoint, _ b: CGPoint, _ c: CGPoint) -> (CGFloat, CGFloat, CGFloat)? {
        let d = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y))
        guard abs(d) > 1e-9 else { return nil }
        let a2 = a.x * a.x + a.y * a.y, b2 = b.x * b.x + b.y * b.y, c2 = c.x * c.x + c.y * c.y
        let ux = (a2 * (b.y - c.y) + b2 * (c.y - a.y) + c2 * (a.y - b.y)) / d
        let uy = (a2 * (c.x - b.x) + b2 * (a.x - c.x) + c2 * (b.x - a.x)) / d
        return (ux, uy, hypot(a.x - ux, a.y - uy))
    }
}
