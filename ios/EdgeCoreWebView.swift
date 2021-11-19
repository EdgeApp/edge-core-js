class EdgeCoreWebView: RCTView, WKNavigationDelegate, WKScriptMessageHandler {
  var webView: WKWebView?

  // react api--------------------------------------------------------------

  @objc var onMessage: RCTDirectEventBlock?
  @objc var onScriptError: RCTDirectEventBlock?

  @objc var source: String? {
    didSet { if source != oldValue { visitPage() } }
  }

  func runJs(js: String) {
    webView?.evaluateJavaScript(
      js
        .replacingOccurrences(of: "\u{2028}", with: "\\u2028")
        .replacingOccurrences(of: "\u{2029}", with: "\\u2029"),
      completionHandler: { result, error in return }
    )
  }

  // view api --------------------------------------------------------------

  override func didMoveToWindow() {
    if let webView = self.webView {
      webView.configuration.userContentController
        .removeScriptMessageHandler(forName: "edgeCore")
      webView.removeFromSuperview()
      self.webView = nil
    }
    if window == nil { return }

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
      let name = call[0] as? String,
      let args = call[1] as? NSArray
    {
      handleMessage(name, args: args)
    }
  }

  // utilities -------------------------------------------------------------

  func handleMessage(
    _ name: String, args args: NSArray
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
          onerror="window.webkit.messageHandlers.edgeCore.postMessage(['scriptError', ['\(src)']])"
        ></script>
        </head><body></body></html>
        """,
        baseURL: Bundle.main.bundleURL
      )
    }
  }
}
