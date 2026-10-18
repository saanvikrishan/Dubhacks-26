import Foundation
import EventKit
import AppKit

final class CalendarDelegate: NSObject, NSApplicationDelegate {
  func applicationDidFinishLaunching(_ notification: Notification) {
    Task { @MainActor in
      await CalendarBridge.run()
      NSApplication.shared.terminate(nil)
    }
  }
}
@main struct CalendarBridge {
  static var outputPath: String? {
    let args=CommandLine.arguments
    guard let index=args.firstIndex(of:"--output"), index+1<args.count else { return nil }
    return args[index+1]
  }
  @MainActor static func main() {
    let application=NSApplication.shared
    let delegate=CalendarDelegate()
    application.setActivationPolicy(.accessory)
    application.delegate=delegate
    withExtendedLifetime(delegate) { application.run() }
  }
  static func emit(_ object: [String: Any]) {
    if let data = try? JSONSerialization.data(withJSONObject: object, options: [.sortedKeys]) {
      if let output=outputPath { try? data.write(to:URL(fileURLWithPath:output),options:.atomic) }
      else if let value=String(data:data,encoding:.utf8) { print(value) }
    }
  }
  @MainActor static func run() async {
    let store = EKEventStore()
    let command = CommandLine.arguments.dropFirst().first ?? "--status"
    let initialStatus = EKEventStore.authorizationStatus(for: .event)
    if command == "--connect" && initialStatus != .denied && initialStatus != .restricted {
      NSApplication.shared.activate(ignoringOtherApps:true)
      do {
        if #available(macOS 14.0, *) { _ = try await store.requestFullAccessToEvents() }
        else { _ = try await store.requestAccess(to: .event) }
      } catch { emit(["supported":true,"authorized":false,"error":"Calendar permission was not granted."]); return }
    }
    let status = EKEventStore.authorizationStatus(for: .event)
    let authorized: Bool
    if #available(macOS 14.0, *) { authorized = status == .fullAccess }
    else { authorized = status == .authorized }
    let permission: String
    switch status {
    case .notDetermined: permission = "not_determined"
    case .restricted: permission = "restricted"
    case .denied: permission = "denied"
    default: permission = authorized ? "authorized" : "write_only"
    }
    if command != "--events" {
      var result: [String:Any] = ["supported":true,"authorized":authorized,"authorization":status.rawValue,"permission":permission,"canRequest":status == .notDetermined,"needsSettings":status == .denied || status == .restricted]
      if command == "--connect" && !authorized {
        result["error"] = status == .denied || status == .restricted ? "Calendar access is blocked in macOS. Open System Settings → Privacy & Security → Calendars and allow WhatsCooking Calendar (or the app running this local server), then retry. macOS does not repeat a previously denied prompt." : "Approve the macOS Calendar permission prompt, then retry."
      }
      emit(result); return
    }
    guard authorized else { emit(["supported":true,"authorized":false,"error":"Connect Apple Calendar and approve the macOS permission prompt first."]); return }
    let args = Array(CommandLine.arguments.dropFirst(2).prefix(while:{$0 != "--output"}))
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
