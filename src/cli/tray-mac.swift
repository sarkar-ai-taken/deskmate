import AppKit
import Foundation

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

func argValue(_ flag: String) -> String? {
    let args = CommandLine.arguments
    guard let idx = args.firstIndex(of: flag), idx + 1 < args.count else { return nil }
    return args[idx + 1]
}

let appVersion = argValue("--version") ?? "?"
let appLogFile = argValue("--log-file") ?? ""
let appPlist   = argValue("--plist") ?? ""
let parentPid: pid_t = {
    if let s = argValue("--pid"), let p = Int32(s) { return p }
    return getppid()
}()

// ---------------------------------------------------------------------------
// Helper — emit action to stdout (Node reads this)
// ---------------------------------------------------------------------------

func emit(_ action: String) {
    print(action)
    fflush(stdout)
}

// ---------------------------------------------------------------------------
// Parent-process watchdog — exit if parent dies (prevents orphaned tray)
// ---------------------------------------------------------------------------

func startParentWatchdog() {
    let source = DispatchSource.makeProcessSource(
        identifier: parentPid,
        eventMask: .exit,
        queue: .main
    )
    source.setEventHandler {
        exit(0)
    }
    source.resume()
}

// ---------------------------------------------------------------------------
// App delegate
// ---------------------------------------------------------------------------

class TrayDelegate: NSObject, NSApplicationDelegate {
    var statusItem: NSStatusItem!

    func applicationDidFinishLaunching(_ notification: Notification) {
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        statusItem.button?.title = "DM"

        let menu = NSMenu()

        let versionItem = NSMenuItem(title: "Deskmate v\(appVersion)", action: nil, keyEquivalent: "")
        versionItem.isEnabled = false
        menu.addItem(versionItem)

        let statusMenuItem = NSMenuItem(title: "\u{25CF} Running", action: nil, keyEquivalent: "")
        statusMenuItem.isEnabled = false
        menu.addItem(statusMenuItem)

        menu.addItem(NSMenuItem.separator())

        let logsItem = NSMenuItem(title: "View Logs", action: #selector(viewLogs), keyEquivalent: "")
        logsItem.target = self
        menu.addItem(logsItem)

        let restartItem = NSMenuItem(title: "Restart", action: #selector(restart), keyEquivalent: "")
        restartItem.target = self
        menu.addItem(restartItem)

        let quitItem = NSMenuItem(title: "Quit", action: #selector(quit), keyEquivalent: "q")
        quitItem.target = self
        menu.addItem(quitItem)

        statusItem.menu = menu
    }

    @objc func viewLogs() {
        emit("viewlogs")
        if !appLogFile.isEmpty {
            let proc = Process()
            proc.executableURL = URL(fileURLWithPath: "/usr/bin/open")
            proc.arguments = [appLogFile]
            try? proc.run()
        }
    }

    @objc func restart() {
        emit("restart")
        if !appPlist.isEmpty {
            let proc = Process()
            proc.executableURL = URL(fileURLWithPath: "/bin/bash")
            proc.arguments = ["-c", "launchctl unload \"\(appPlist)\" && launchctl load \"\(appPlist)\""]
            try? proc.run()
        }
    }

    @objc func quit() {
        emit("quit")
        // Give stdout time to flush, then exit
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) {
            NSApp.terminate(nil)
        }
    }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

startParentWatchdog()

let app = NSApplication.shared
app.setActivationPolicy(.accessory)

let delegate = TrayDelegate()
app.delegate = delegate
app.run()
