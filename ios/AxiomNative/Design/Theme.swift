import SwiftUI
import UIKit

/// Axiom's look: calm graphite neutrals with a cool bias, one ink-blue accent, system type (SF Pro, New York for
/// headings, SF Mono for numbers). Every colour adapts to light and dark.
enum Theme {
    static func dyn(_ light: UInt32, _ dark: UInt32, _ la: CGFloat = 1, _ da: CGFloat = 1) -> Color {
        Color(uiColor: UIColor { $0.userInterfaceStyle == .dark ? UIColor(hex: dark, alpha: da) : UIColor(hex: light, alpha: la) })
    }
    static let bg = dyn(0xEEF0F3, 0x111317)
    static let paper = dyn(0xFFFFFF, 0x1B1E24)
    static let panel = dyn(0xFBFBFC, 0x1F2229)
    static let panel2 = dyn(0xF1F3F6, 0x272B33)
    static let fg = dyn(0x1A1E26, 0xE8EAEE)
    static let muted = dyn(0x687082, 0x9AA2B2)
    static let faint = dyn(0x9AA1AF, 0x6B7282)
    static let line = dyn(0x182034, 0xFFFFFF, 0.10, 0.09)
    static let lineStrong = dyn(0x182034, 0xFFFFFF, 0.18, 0.16)
    static let accent = dyn(0x2F6FDB, 0x6F9BFF)
    static let accentSoft = dyn(0x2F6FDB, 0x6F9BFF, 0.12, 0.16)
    static let danger = dyn(0xD0453F, 0xFF6B63)
    static let ok = dyn(0x2F9E6B, 0x4CC38A)

    static let r: CGFloat = 14
    static let rSmall: CGFloat = 10

    static func title(_ size: CGFloat = 34) -> Font { .system(size: size, weight: .regular, design: .serif) }
    static func ui(_ size: CGFloat = 15, _ weight: Font.Weight = .regular) -> Font { .system(size: size, weight: weight) }
    static func num(_ size: CGFloat = 13, _ weight: Font.Weight = .medium) -> Font { .system(size: size, weight: weight, design: .monospaced) }
    static func label(_ size: CGFloat = 11) -> Font { .system(size: size, weight: .semibold) }
}

extension UIColor {
    convenience init(hex: UInt32, alpha: CGFloat = 1) {
        self.init(red: CGFloat((hex >> 16) & 0xFF) / 255, green: CGFloat((hex >> 8) & 0xFF) / 255, blue: CGFloat(hex & 0xFF) / 255, alpha: alpha)
    }
    /// "#rrggbb" (or "#rgb"); unknown strings give black
    convenience init(css: String, alpha: CGFloat = 1) {
        var s = css.trimmingCharacters(in: .whitespaces).replacingOccurrences(of: "#", with: "")
        if s.count == 3 { s = s.map { "\($0)\($0)" }.joined() }
        self.init(hex: UInt32(s.prefix(6), radix: 16) ?? 0, alpha: alpha)
    }
    var cssHex: String {
        var r: CGFloat = 0, g: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 0
        resolvedColor(with: UITraitCollection(userInterfaceStyle: .light)).getRed(&r, green: &g, blue: &b, alpha: &a)
        return String(format: "#%02x%02x%02x", Int(r * 255), Int(g * 255), Int(b * 255))
    }
    var luminance: CGFloat {
        var r: CGFloat = 0, g: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 0
        getRed(&r, green: &g, blue: &b, alpha: &a)
        return 0.2126 * r + 0.7152 * g + 0.0722 * b
    }
}

/// The floating surface every bar, rail and menu uses.
struct Floating: ViewModifier {
    var radius: CGFloat = 16
    func body(content: Content) -> some View {
        content
            .background(.regularMaterial, in: RoundedRectangle(cornerRadius: radius, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: radius, style: .continuous).strokeBorder(Theme.line, lineWidth: 0.5))
            .shadow(color: .black.opacity(0.18), radius: 14, y: 6)
    }
}
extension View {
    func floating(_ radius: CGFloat = 16) -> some View { modifier(Floating(radius: radius)) }
}

/// A round icon button used in bars and rails.
struct IconButton: View {
    let symbol: String
    var label: String = ""
    var on = false
    var tint: Color = Theme.fg
    var size: CGFloat = 40
    let action: () -> Void
    var body: some View {
        Button(action: action) {
            Image(systemName: symbol)
                .font(.system(size: size * 0.42, weight: .medium))
                .foregroundStyle(on ? Theme.accent : tint)
                .frame(width: size, height: size)
                .background(on ? Theme.accentSoft : .clear, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
    }
}
