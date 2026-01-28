import WebKit
import Foundation
import Network

class EdgeCoreWebView: RCTView, WKNavigationDelegate, WKScriptMessageHandler {
  var native = EdgeNative()
  var webView: WKWebView?
  private var httpServer: BundleHTTPServer?
  private var serverPort: UInt16 = 0
  private var serverReady = false
  
  // react api--------------------------------------------------------------

  @objc var onMessage: RCTDirectEventBlock?
  @objc var onScriptError: RCTDirectEventBlock?

  @objc var allowDebugging: Bool = false {
    didSet {
      if #available(iOS 16.4, *) {
        webView?.isInspectable = true
      }
    }
  }

  @objc var source: String? {
    didSet { if source != oldValue { visitPage() } }
  }

  func runJs(js: String) {
    webView?.evaluateJavaScript(
      js,
      completionHandler: { result, error in return })
  }

  // view api --------------------------------------------------------------

  required init?(coder: NSCoder) {
    return nil
  }

  override init(frame: CGRect) {
    super.init(frame: frame)

    // Set up our native bridge:
    let configuration = WKWebViewConfiguration()
    configuration.userContentController = WKUserContentController()
    configuration.userContentController.add(self, name: "edgeCore")

    // Set up the WKWebView child:
    let webView = WKWebView(frame: bounds, configuration: configuration)
    webView.navigationDelegate = self
    addSubview(webView)
    self.webView = webView

    // Start the HTTP server on an ephemeral port bound to loopback only
    let server = BundleHTTPServer()
    self.httpServer = server
    server.start { [weak self] result in
      DispatchQueue.main.async {
        switch result {
        case .success(let port):
          self?.serverPort = port
          self?.serverReady = true
          // Now that the server is ready with its assigned port, load the page
          self?.visitPage()
        case .failure(let error):
          print("Failed to start HTTP server: \(error)")
          // Server failed to start - the WebView won't be able to load local content
        }
      }
    }
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    webView?.frame = bounds
  }

  override func removeFromSuperview() {
    super.removeFromSuperview()
    if let webView = self.webView {
      webView.configuration.userContentController
        .removeScriptMessageHandler(forName: "edgeCore")
      webView.removeFromSuperview()
      self.webView = nil
    }
    
    // Stop the HTTP server when view is removed
    httpServer?.stop()
    httpServer = nil
  }

  // callbacks -------------------------------------------------------------

  func webView(
    _: WKWebView,
    didFailProvisionalNavigation: WKNavigation!,
    withError: Error
  ) {
    // This makes webpack live-reload work correctly:
    visitPage()
  }

  func webViewWebContentProcessDidTerminate(_: WKWebView) {
    // Reload if we run out of memory:
    visitPage()
  }

  func userContentController(
    _: WKUserContentController,
    didReceive scriptMessage: WKScriptMessage
  ) {
    if let call = scriptMessage.body as? NSArray,
      let id = call[0] as? Int,
      let name = call[1] as? String,
      let args = call[2] as? NSArray
    {
      if id == 0 { return handleMessage(name, args: args) }

      let promise = PendingCall(
        resolve: { result in
          DispatchQueue.main.async {
            self.runJs(
              js: "window.nativeBridge.resolve(\(id), \(self.stringify(result)))")
          }
        },
        reject: { message in
          DispatchQueue.main.async {
            self.runJs(
              js: "window.nativeBridge.reject(\(id), \(self.stringify(message)))")
          }
        })

      native.call(name, args: args, promise: promise)
    }
  }

  // utilities -------------------------------------------------------------

  func handleMessage(
    _ name: String, args: NSArray
  ) {
    if name == "postMessage", let message = args[0] as? String {
      onMessage?(["message": message])
      return
    }
    if name == "scriptError", let source = args[0] as? String {
      onScriptError?(["source": source])
      return
    }
  }

  /// Returns the base URL for the local bundle HTTP server, or nil if the server isn't ready.
  func defaultSource() -> String? {
    guard serverReady else { return nil }
    return "http://127.0.0.1:\(serverPort)/index.html"
  }

  func stringify(_ raw: Any?) -> String {
    if let value = raw,
      let data = try? JSONSerialization.data(
        withJSONObject: value,
        options: [.fragmentsAllowed]
      ),
      let string = String(data: data, encoding: .utf8)
    {
      return string.replacingOccurrences(of: "\u{2028}", with: "\\u2028")
        .replacingOccurrences(of: "\u{2029}", with: "\\u2029")
    }
    return "undefined"
  }

  func visitPage() {
    // If source is set, use it directly (e.g., webpack dev server for debugging)
    // Otherwise, use the local bundle HTTP server with ephemeral port
    let baseUrl: String
    if let src = source, !src.isEmpty {
      baseUrl = src
    } else {
      guard let defaultUrl = defaultSource() else {
        print("EdgeCoreWebView: visitPage called before server is ready")
        return
      }
      baseUrl = defaultUrl
    }
    
    guard let url = URL(string: baseUrl) else {
      print("EdgeCoreWebView: Invalid URL string: \(baseUrl)")
      return
    }
    let request = URLRequest(url: url)
    webView?.load(request)
  }
}
