import AppKit
import WebKit

let app = NSApplication.shared
app.setActivationPolicy(.accessory)
let output = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "/private/tmp/nagori-ime-check"
try! FileManager.default.createDirectory(atPath: output, withIntermediateDirectories: true)
let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 850, height: 650), styleMask: [.titled], backing: .buffered, defer: false)
let config = WKWebViewConfiguration()
let web = WKWebView(frame: window.contentView!.bounds, configuration: config)
window.contentView!.addSubview(web)
window.makeKeyAndOrderFront(nil)
app.activate(ignoringOtherApps: true)
window.makeFirstResponder(web)

func inputClient(_ view: NSView) -> NSTextInputClient? {
    if let input = view as? NSTextInputClient { return input }
    for child in view.subviews { if let input = inputClient(child) { return input } }
    return nil
}
class Delegate: NSObject, WKNavigationDelegate, WKScriptMessageHandler {
    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let action = message.body as? [String: Any], let input = (window.firstResponder as? NSTextInputClient) ?? inputClient(web) else { return }
        let kind = action["kind"] as! String
        let selected = NSRange(location: action["location"] as? Int ?? 0, length: action["length"] as? Int ?? 0)
        let replacement = NSRange(location: action["replace"] as? Int ?? NSNotFound, length: action["replaceLength"] as? Int ?? 0)
        if kind == "mark" { input.setMarkedText(action["text"] as! String, selectedRange: selected, replacementRange: replacement) }
        if kind == "insert" { input.insertText(action["text"] as! String, replacementRange: replacement) }
        if kind == "unmark" { input.unmarkText() }
        if kind == "delete" { input.doCommand(by: NSSelectorFromString("deleteBackward:")) }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.06) { web.evaluateJavaScript("window.nativeDone()", completionHandler: nil) }
    }
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        webView.callAsyncJavaScript("while (!window.ready) await new Promise(r => setTimeout(r, 50)); return await window.run();", arguments: [:], in: nil, in: .page) { result in
            switch result {
            case .success(let value):
                let json = String(describing: value)
                try! json.write(toFile: output + "/results.json", atomically: true, encoding: .utf8)
                let report = try! JSONSerialization.jsonObject(with: Data(json.utf8)) as! [String: Any]
                let passed = report["pass"] as? Bool ?? false
                webView.takeSnapshot(with: nil) { image, _ in
                    if let data = image?.tiffRepresentation, let bitmap = NSBitmapImageRep(data: data), let png = bitmap.representation(using: .png, properties: [:]) {
                        try! png.write(to: URL(fileURLWithPath: output + "/view.png"))
                    }
                    let capture = Process()
                    capture.executableURL = URL(fileURLWithPath: "/usr/sbin/screencapture")
                    capture.arguments = ["-x", "-l", String(window.windowNumber), output + "/window.png"]
                    try? capture.run(); capture.waitUntilExit()
                    print(passed ? "WKWebView確認成功" : "WKWebView確認失敗。results.jsonを確認してください")
                    exit(passed ? 0 : 1)
                }
            case .failure(let error):
                let details = "\(error)\n\((error as NSError).userInfo)"
                try! details.write(toFile: output + "/error.txt", atomically: true, encoding: .utf8)
                print("WKWebView確認失敗 \(details)"); exit(1)
            }
        }
    }
}
let delegate = Delegate()
web.navigationDelegate = delegate
config.userContentController.add(delegate, name: "ime")
web.load(URLRequest(url: URL(string: "http://127.0.0.1:1438/ime-check")!))
// 別のウィンドウへ移って変換が終わることを避ける。確認中は実キー入力をしない。
let focusTimer = Timer.scheduledTimer(withTimeInterval: 0.3, repeats: true) { _ in app.activate(ignoringOtherApps: true); window.makeKeyAndOrderFront(nil) }
DispatchQueue.main.asyncAfter(deadline: .now() + 300) { print("WKWebView確認が時間切れになりました"); exit(1) }
app.run()
