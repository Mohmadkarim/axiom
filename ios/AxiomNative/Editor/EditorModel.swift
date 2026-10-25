import Observation
import PencilKit
import SwiftUI

enum ToolKind: String, Codable { case pen, highlighter, eraser, lasso, text, laser }

/// One slot on the tool rail.
struct ToolSlot: Identifiable, Equatable {
    var id: Int
    var kind: ToolKind
    var ink: String = "pen"            // pen | fountain | pencil | monoline | marker | crayon
    var color: String = "#16181d"
    var size: CGFloat = 2.5
    var opacity: CGFloat = 1
    var eraseWhole = true              // eraser: whole strokes, or partial (pixel)
    var font = "sans"                  // text

    var symbol: String {
        switch kind {
        case .pen: return ink == "pencil" ? "pencil" : ink == "fountain" ? "pencil.tip" : "pencil.tip"
        case .highlighter: return "highlighter"
        case .eraser: return "eraser"
        case .lasso: return "lasso"
        case .text: return "textformat"
        case .laser: return "cursorarrow.rays"
        }
    }
    var hasColor: Bool { kind == .pen || kind == .highlighter || kind == .text || kind == .laser }
    var uiColor: UIColor { UIColor(css: color) }

    static let notebookDefaults: [ToolSlot] = [
        ToolSlot(id: 0, kind: .pen, ink: "pen", color: "#16181d", size: 2.5),
        ToolSlot(id: 1, kind: .pen, ink: "pen", color: "#1f4fbf", size: 2.5),
        ToolSlot(id: 2, kind: .pen, ink: "fountain", color: "#c0392b", size: 2.5),
        ToolSlot(id: 3, kind: .highlighter, ink: "marker", color: "#ffd84d", size: 18, opacity: 0.45),
        ToolSlot(id: 4, kind: .eraser, size: 16),
        ToolSlot(id: 5, kind: .text, color: "#16181d", size: 20),
        ToolSlot(id: 6, kind: .lasso),
    ]

    static let palettes: [ToolKind: [String]] = [
        .pen: ["#16181d", "#1f4fbf", "#c0392b", "#1e8449", "#7d3cff", "#e67e22", "#ffffff"],
        .highlighter: ["#ffd84d", "#ff7eb6", "#9cf26a", "#7ec8ff", "#5ef0e0", "#ffb15c"],
        .text: ["#16181d", "#1f4fbf", "#c0392b", "#1e8449", "#7d3cff", "#ffffff"],
        .laser: ["#ff3b30", "#2f7bff", "#26c281", "#ffcc00"],
    ]
    static let sizes: [ToolKind: [CGFloat]] = [.pen: [1.4, 2.5, 4.2], .highlighter: [12, 18, 28], .eraser: [8, 16, 34], .text: [15, 20, 28], .laser: [4, 6, 10]]

    // saved form (settings.nativeSlots)
    var json: JSON { ["id": id, "kind": kind.rawValue, "ink": ink, "color": color, "size": size, "opacity": opacity, "whole": eraseWhole, "font": font] }
    init(id: Int, kind: ToolKind, ink: String = "pen", color: String = "#16181d", size: CGFloat = 2.5, opacity: CGFloat = 1) {
        self.id = id; self.kind = kind; self.ink = ink; self.color = color; self.size = size; self.opacity = opacity
    }
    init?(_ j: JSON) {
        guard let id = j.int("id"), let k = j.str("kind").flatMap(ToolKind.init) else { return nil }
        self.id = id; kind = k; ink = j.str("ink") ?? "pen"; color = j.str("color") ?? "#16181d"
        size = CGFloat(j.num("size") ?? 2.5); opacity = CGFloat(j.num("opacity") ?? 1); eraseWhole = (j["whole"] as? Bool) ?? true; font = j.str("font") ?? "sans"
    }
}

/// What the editor's bars show and change; the drawing engine reads it.
@Observable
final class EditorModel {
    var title = ""
    var subtitle = ""
    var isNotebook = true
    var slots: [ToolSlot] = ToolSlot.notebookDefaults
    var active = 0
    var previous = 0
    var flyout: Int?                     // slot whose options are open
    var canUndo = false
    var canRedo = false
    var page = 0
    var pageCount = 1
    var showPages = false
    var selection: SelectionInfo?
    var editingText = false
    var ruler = false
    var shapes = true
    var fingerDraws = false
    var zoomText = "100%"
    var menuAt: CGPoint?                 // the press-and-hold page menu (screen point)
    var menuHasPaste = false
    var menuHasImage = false
    var cropping = false

    var tool: ToolSlot { slots.indices.contains(active) ? slots[active] : slots[0] }

    func select(_ i: Int) {
        guard slots.indices.contains(i) else { return }
        if i == active { flyout = flyout == i ? nil : i; return }
        previous = active; active = i; flyout = nil
        save()
    }
    func update(_ change: (inout ToolSlot) -> Void) {
        change(&slots[active])
        save()
    }
    func load() {
        if let arr = Library.shared.settings["nativeSlots"] as? [Any] {
            let s = arr.compactMap { ($0 as? JSON).flatMap(ToolSlot.init) }
            if s.count >= 3 { slots = s }
        }
        active = min(Library.shared.settings.int("nativeActive") ?? 0, slots.count - 1)
        shapes = (Library.shared.settings["shapeHold"] as? Bool) ?? true
        fingerDraws = Library.shared.settings.str("fingerAction") == "draw"
    }
    func save() {
        Library.shared.set("nativeSlots", slots.map(\.json))
        Library.shared.set("nativeActive", active)
    }
}

struct SelectionInfo: Equatable {
    var frame: CGRect                    // screen rect of the selection box
    var strokes: Int
    var images: Int
    var texts: Int
    var canCrop: Bool { images == 1 && strokes == 0 && texts == 0 }
}
