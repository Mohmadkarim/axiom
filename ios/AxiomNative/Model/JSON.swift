import Foundation

/// The documents are plain JSON shared with earlier versions of Axiom. They are kept as dictionaries so fields this
/// version does not know about survive a save untouched.
typealias JSON = [String: Any]

extension Dictionary where Key == String, Value == Any {
    func str(_ k: String) -> String? { self[k] as? String }
    func num(_ k: String) -> Double? { (self[k] as? NSNumber)?.doubleValue }
    func int(_ k: String) -> Int? { (self[k] as? NSNumber)?.intValue }
    func bool(_ k: String) -> Bool { (self[k] as? Bool) ?? ((self[k] as? NSNumber)?.boolValue ?? false) }
    func obj(_ k: String) -> JSON? { self[k] as? JSON }
    func arr(_ k: String) -> [JSON] { (self[k] as? [Any])?.compactMap { $0 as? JSON } ?? [] }
    func nums(_ k: String) -> [Double] { (self[k] as? [Any])?.compactMap { ($0 as? NSNumber)?.doubleValue } ?? [] }
}

enum JSONIO {
    static func parse(_ data: Data) -> Any? { try? JSONSerialization.jsonObject(with: data, options: [.fragmentsAllowed]) }
    static func object(_ data: Data) -> JSON? { parse(data) as? JSON }
    static func data(_ obj: Any) -> Data? {
        guard JSONSerialization.isValidJSONObject(obj) else { return nil }
        return try? JSONSerialization.data(withJSONObject: obj, options: [])
    }
}

/// Short random ids in the same style as before (base 36).
enum UID {
    static func make() -> String {
        let chars = Array("abcdefghijklmnopqrstuvwxyz0123456789")
        return String((0..<12).map { _ in chars[Int.random(in: 0..<chars.count)] })
    }
}

extension Date {
    var ms: Double { (timeIntervalSince1970 * 1000).rounded() }
    init(ms: Double) { self.init(timeIntervalSince1970: ms / 1000) }
}
