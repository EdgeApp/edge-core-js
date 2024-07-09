import WebKit

class EdgeCoreWebView: RCTView, WKNavigationDelegate, WKScriptMessageHandler {
  var native = EdgeNative()
  var webView: WKWebView?

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

    // Launch the core:
    visitPage()
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

  func defaultSource() -> String? {
    if let bundleUrl = Bundle.main.url(
      forResource: "edge-core-js",
      withExtension: "bundle"
    ),
      let bundle = Bundle(url: bundleUrl),
      let script = bundle.url(forResource: "edge-core", withExtension: "js")
    {
      return script.absoluteString
    }
    return nil
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
    if let src = source ?? defaultSource() {
      webView?.loadHTMLString(
        """
        <!doctype html><html><head>
        <meta charset="utf-8">
        <title>edge-core-js</title>
        <script
          charset="utf-8"
          defer
          src="\(src)"
          onerror="window.webkit.messageHandlers.edgeCore.postMessage([0, 'scriptError', ['\(src)']])"
        ></script>
        </head><body></body></html>
        """,
        baseURL: Bundle.main.bundleURL
      )
    }
  }
}
