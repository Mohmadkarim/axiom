import EventKit
import Foundation
import UIKit
import UserNotifications

/// The iPad's own calendars (any Google, iCloud or Outlook account added in Settings) and local reminders.
/// Axiom reads every calendar except its own, and keeps its study blocks, exams and deadlines in a calendar
/// called "Axiom" that it alone writes to.
final class PlannerBridge: NSObject, UNUserNotificationCenterDelegate {
    private let store = EKEventStore()
    private static let ownTitle = "Axiom"

    override init() {
        super.init()
        UNUserNotificationCenter.current().delegate = self
    }

    // show reminders as banners even while Axiom is open
    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification,
                                withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        completionHandler([.banner, .sound, .list])
    }

    // MARK: - Calendar

    var hasCalendarAccess: Bool { EKEventStore.authorizationStatus(for: .event) == .fullAccess }

    func requestCalendar(_ done: @escaping (Bool) -> Void) {
        if hasCalendarAccess { done(true); return }
        store.requestFullAccessToEvents { granted, _ in DispatchQueue.main.async { done(granted) } }
    }

    private func date(_ ms: Any?) -> Date { Date(timeIntervalSince1970: ((ms as? Double) ?? 0) / 1000) }
    private func ms(_ d: Date) -> Double { (d.timeIntervalSince1970 * 1000).rounded() }
    private func hex(_ c: CGColor?) -> String {
        guard let c, let comps = UIColor(cgColor: c).cgColor.converted(to: CGColorSpace(name: CGColorSpace.sRGB)!, intent: .defaultIntent, options: nil)?.components, comps.count >= 3 else { return "#8a8f99" }
        return String(format: "#%02x%02x%02x", Int(comps[0] * 255), Int(comps[1] * 255), Int(comps[2] * 255))
    }

    func calendars() -> [[String: Any]] {
        guard hasCalendarAccess else { return [] }
        return store.calendars(for: .event).filter { $0.title != Self.ownTitle }.map {
            ["id": $0.calendarIdentifier, "title": $0.title, "color": hex($0.cgColor), "source": $0.source.title]
        }
    }

    func events(from: Any?, to: Any?, hidden: [String]) -> [[String: Any]] {
        guard hasCalendarAccess else { return [] }
        let cals = store.calendars(for: .event).filter { $0.title != Self.ownTitle && !hidden.contains($0.calendarIdentifier) }
        if cals.isEmpty { return [] }
        let pred = store.predicateForEvents(withStart: date(from), end: date(to), calendars: cals)
        return store.events(matching: pred).prefix(600).map { e in
            [
                "id": (e.eventIdentifier ?? "") + "@" + String(ms(e.startDate)),
                "title": e.title ?? "",
                "start": ms(e.startDate), "end": ms(e.endDate), "allDay": e.isAllDay,
                "location": e.location ?? "",
                "notes": String((e.notes ?? "").prefix(400)),
                "calendar": e.calendar.title, "calendarId": e.calendar.calendarIdentifier,
                "color": hex(e.calendar.cgColor),
            ]
        }
    }

    private func ownCalendar() -> EKCalendar? {
        if let c = store.calendars(for: .event).first(where: { $0.title == Self.ownTitle && $0.allowsContentModifications }) { return c }
        let cal = EKCalendar(for: .event, eventStore: store)
        cal.title = Self.ownTitle
        cal.cgColor = UIColor(red: 0.29, green: 0.42, blue: 0.95, alpha: 1).cgColor
        let preferred = store.defaultCalendarForNewEvents?.source
        let sources = [preferred].compactMap { $0 } + store.sources.filter { $0.sourceType == .calDAV || $0.sourceType == .local }
        for src in sources {
            cal.source = src
            if (try? store.saveCalendar(cal, commit: true)) != nil { return cal }
        }
        return nil
    }

    /// Make the "Axiom" calendar match `items` between `from` and `to` (one event per occurrence, keyed in the URL).
    func mirror(items: [[String: Any]], from: Any?, to: Any?) -> Int {
        guard hasCalendarAccess, let cal = ownCalendar() else { return -1 }
        let pred = store.predicateForEvents(withStart: date(from), end: date(to), calendars: [cal])
        var existing: [String: EKEvent] = [:]
        for e in store.events(matching: pred) {
            if let k = e.url?.absoluteString, k.hasPrefix("axiom:") { existing[k] = e } else { try? store.remove(e, span: .thisEvent, commit: false) }
        }
        var keep = Set<String>()
        for it in items {
            guard let key = it["key"] as? String, let url = URL(string: "axiom:" + key.addingPercentEncoding(withAllowedCharacters: .alphanumerics)!) else { continue }
            keep.insert(url.absoluteString)
            let e = existing[url.absoluteString] ?? EKEvent(eventStore: store)
            e.calendar = cal
            e.url = url
            e.title = it["title"] as? String ?? ""
            e.startDate = date(it["start"])
            e.endDate = date(it["end"])
            e.isAllDay = it["allDay"] as? Bool ?? false
            e.location = it["location"] as? String
            e.notes = it["notes"] as? String
            try? store.save(e, span: .thisEvent, commit: false)
        }
        for (k, e) in existing where !keep.contains(k) { try? store.remove(e, span: .thisEvent, commit: false) }
        try? store.commit()
        return keep.count
    }

    // MARK: - Reminders

    /// Replace every pending Axiom reminder with `list` ([{id, title, body, at}]); iOS keeps at most 64.
    func syncReminders(_ list: [[String: Any]], ask: Bool, done: @escaping (Int) -> Void) {
        let center = UNUserNotificationCenter.current()
        center.getNotificationSettings { settings in
            // only ask when the user just added something; background refreshes never pop the permission sheet
            if settings.authorizationStatus == .notDetermined && !ask { DispatchQueue.main.async { done(-2) }; return }
            self.schedule(list, center: center, done: done)
        }
    }

    private func schedule(_ list: [[String: Any]], center: UNUserNotificationCenter, done: @escaping (Int) -> Void) {
        center.requestAuthorization(options: [.alert, .sound, .badge]) { granted, _ in
            guard granted else { DispatchQueue.main.async { done(-1) }; return }
            center.removeAllPendingNotificationRequests()
            var n = 0
            let now = Date()
            for item in list.prefix(60) {
                let at = self.date(item["at"])
                guard at > now, let id = item["id"] as? String else { continue }
                let content = UNMutableNotificationContent()
                content.title = item["title"] as? String ?? "Axiom"
                content.body = item["body"] as? String ?? ""
                content.sound = .default
                let comps = Calendar.current.dateComponents([.year, .month, .day, .hour, .minute], from: at)
                center.add(UNNotificationRequest(identifier: id, content: content, trigger: UNCalendarNotificationTrigger(dateMatching: comps, repeats: false)))
                n += 1
            }
            DispatchQueue.main.async { done(n) }
        }
    }
}
