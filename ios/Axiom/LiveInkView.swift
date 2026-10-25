import UIKit

/// Draws the stroke being written natively, straight from the Pencil (with Apple's predicted touches),
/// above the web page. The page still records and renders the real stroke; this layer only removes the
/// web round trip so the ink stays on the tip. It clears itself once the page has drawn the stroke.
final class LiveInkView: UIView {
    struct Style {
        var enabled = false
        var color = UIColor.black
        var alpha: CGFloat = 1
        var width: CGFloat = 2          // screen points at full pressure multiplier 1
        var minMul: CGFloat = 0.6       // width multiplier at light pressure
        var maxMul: CGFloat = 1.2       // width multiplier at full pressure
        var dx: CGFloat = 0             // Pencil calibration offset
        var dy: CGFloat = 0
        var cap: CAShapeLayerLineCap = .round
    }
    var style = Style()

    private let shape = CAShapeLayer()
    private var pts: [CGPoint] = []
    private var force: CGFloat = 0.5
    private var active = false
    private var suspended = false
    private var clearTimer: Timer?

    override init(frame: CGRect) {
        super.init(frame: frame)
        isUserInteractionEnabled = false
        backgroundColor = .clear
        isOpaque = false
        shape.fillColor = nil
        shape.lineJoin = .round
        shape.contentsScale = UIScreen.main.scale
        layer.addSublayer(shape)
    }
    required init?(coder: NSCoder) { fatalError() }

    override func layoutSubviews() {
        super.layoutSubviews()
        shape.frame = bounds
    }

    private func point(_ t: UITouch, in v: UIView) -> CGPoint {
        let p = t.preciseLocation(in: v)
        return CGPoint(x: p.x + style.dx, y: p.y + style.dy)
    }
    private func normForce(_ t: UITouch) -> CGFloat {
        t.maximumPossibleForce > 0 ? min(1, t.force / t.maximumPossibleForce) : 0.5
    }

    func began(_ touches: [UITouch], in v: UIView) {
        clearTimer?.invalidate()
        pts.removeAll(keepingCapacity: true)
        suspended = false
        active = style.enabled
        guard active else { shape.path = nil; return }
        CATransaction.begin(); CATransaction.setDisableActions(true)
        shape.strokeColor = style.color.withAlphaComponent(style.alpha).cgColor
        shape.lineCap = style.cap
        CATransaction.commit()
        force = touches.first.map(normForce) ?? 0.5
        add(touches, in: v)
        redraw(predicted: [])
    }

    func moved(_ coalesced: [UITouch], predicted: [UITouch], in v: UIView) {
        guard active, !suspended else { return }
        add(coalesced, in: v)
        redraw(predicted: predicted.map { point($0, in: v) })
    }

    func ended(_ coalesced: [UITouch], in v: UIView) {
        guard active else { return }
        if !suspended { add(coalesced, in: v); redraw(predicted: []) }
        active = false
        // safety net: the page normally clears us as soon as it has drawn the stroke
        clearTimer = Timer.scheduledTimer(withTimeInterval: 0.8, repeats: false) { [weak self] _ in self?.clear() }
    }

    func cancelled() { active = false; clear() }

    /// The page has drawn the finished stroke (ignored while a new stroke is being written).
    func clearIfIdle() { if !active { clear() } }

    /// The page took over this stroke (shape recognition, ruler): hide the native copy until the pen lifts.
    func suspend() { suspended = true; CATransaction.begin(); CATransaction.setDisableActions(true); shape.path = nil; CATransaction.commit() }

    func clear() {
        clearTimer?.invalidate()
        pts.removeAll(keepingCapacity: true)
        CATransaction.begin(); CATransaction.setDisableActions(true)
        shape.path = nil
        CATransaction.commit()
    }

    private func add(_ touches: [UITouch], in v: UIView) {
        for t in touches {
            let p = point(t, in: v)
            force = force * 0.75 + normForce(t) * 0.25
            if let last = pts.last, hypot(p.x - last.x, p.y - last.y) < 0.4 { pts[pts.count - 1] = p; continue }
            pts.append(p)
        }
    }

    private func redraw(predicted: [CGPoint]) {
        let all = pts + predicted
        guard let first = all.first else { return }
        let path = UIBezierPath()
        path.move(to: first)
        if all.count == 1 {
            path.addLine(to: CGPoint(x: first.x + 0.01, y: first.y))
        } else if all.count == 2 {
            path.addLine(to: all[1])
        } else {
            for i in 1..<(all.count - 1) {
                let mid = CGPoint(x: (all[i].x + all[i + 1].x) / 2, y: (all[i].y + all[i + 1].y) / 2)
                path.addQuadCurve(to: mid, controlPoint: all[i])
            }
            path.addLine(to: all[all.count - 1])
        }
        CATransaction.begin(); CATransaction.setDisableActions(true)
        shape.lineWidth = max(0.5, style.width * (style.minMul + (style.maxMul - style.minMul) * force))
        shape.path = path.cgPath
        CATransaction.commit()
    }
}
