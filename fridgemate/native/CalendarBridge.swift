import Foundation
import EventKit

@main struct CalendarBridge {
  static func emit(_ object: [String: Any]) {
    if let data = try? JSONSerialization.data(withJSONObject: object, options: [.sortedKeys]), let value = String(data: data, encoding: .utf8) { print(value) }
  }
  static func main() async {
    let store = EKEventStore()
    let command = CommandLine.arguments.dropFirst().first ?? "--status"
    if command == "--connect" {
      do {
        if #available(macOS 14.0, *) { _ = try await store.requestFullAccessToEvents() }
        else { _ = try await store.requestAccess(to: .event) }
      } catch { emit(["supported":true,"authorized":false,"error":"Calendar permission was not granted."]); return }
    }
    let status = EKEventStore.authorizationStatus(for: .event)
    let authorized: Bool
    if #available(macOS 14.0, *) { authorized = status == .fullAccess }
    else { authorized = status == .authorized }
    if command != "--events" { emit(["supported":true,"authorized":authorized,"authorization":status.rawValue]); return }
    guard authorized else { emit(["supported":true,"authorized":false,"error":"Connect Apple Calendar and approve the macOS permission prompt first."]); return }
    let args = Array(CommandLine.arguments.dropFirst(2))
    let formatter = ISO8601DateFormatter()
    guard args.count >= 2, let from = formatter.date(from: args[0]), let to = formatter.date(from: args[1]), to > from, to.timeIntervalSince(from) <= 94 * 86400 else { emit(["error":"Choose a calendar range of 93 days or fewer."]); return }
    let calendars = store.calendars(for: .event)
    let selected = args.count > 2 ? calendars.filter { args[2].split(separator: ",").map(String.init).contains($0.calendarIdentifier) } : calendars
    let predicate = store.predicateForEvents(withStart: from, end: to, calendars: selected)
    let records: [[String:Any]] = store.events(matching: predicate).map { event in
      ["id":"apple:\(event.eventIdentifier ?? event.calendarItemIdentifier):\(formatter.string(from:event.startDate))", "title":event.title ?? "Untitled event", "start":formatter.string(from:event.startDate), "end":formatter.string(from:event.endDate), "allDay":event.isAllDay, "location":event.location ?? "", "calendar":event.calendar.title, "calendarId":event.calendar.calendarIdentifier, "busy":event.availability != .free, "source":"apple", "readOnly":true]
    }
    emit(["supported":true,"authorized":true,"events":records,"calendars":calendars.map { ["id":$0.calendarIdentifier,"title":$0.title] }])
  }
}
