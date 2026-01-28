import Foundation
import WebKit

/// Default URL for the WebView
let DEFAULT_SOURCE = "\(BUNDLE_BASE_URI)/edge-core-js.bundle/index.html"

/// A WebView that loads edge-core-js content using a custom URL scheme handler.
///
/// Uses WKURLSchemeHandler to serve local assets via custom URLs (edgebundle://edge.bundle/...),
/// which provides a proper non-null origin for same-origin policy compliance
/// without requiring a local HTTP server.
///
/// Includes Cross-Origin-Opener-Policy and Cross-Origin-Embedder-Policy headers
/// required for SharedArrayBuffer support (needed by mixFetch web workers).
///
/// Note: WKURLSchemeHandler only handles requests within this specific WKWebView instance.
/// It does not register a system-wide URL scheme - other apps cannot access this handler.
class EdgeCoreWebView: RCTView, WKNavigationDelegate, WKScriptMessageHandler {
  var native = EdgeNative()
  var webView: WKWebView?

  // MARK: - React API

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

  // MARK: - View API

  required init?(coder: NSCoder) {
    return nil
  }

  override init(frame: CGRect) {
    super.init(frame: frame)

    // Set up our native bridge and custom URL scheme handler:
    let configuration = WKWebViewConfiguration()
    configuration.userContentController = WKUserContentController()
    configuration.userContentController.add(self, name: "edgeCore")

    // Register custom URL scheme handler BEFORE creating WKWebView
    let schemeHandler = EdgeAssetsSchemeHandler()
    configuration.setURLSchemeHandler(schemeHandler, forURLScheme: EDGE_SCHEME)

    // Set up the WKWebView child:
    let webView = WKWebView(frame: bounds, configuration: configuration)
    webView.navigationDelegate = self
    addSubview(webView)
    self.webView = webView

    // Scheme handler is ready immediately - no async startup needed
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

  // MARK: - Navigation Delegate

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

  // MARK: - Script Message Handler

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

  // MARK: - Utilities

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
    // Otherwise, use the custom URL scheme handler
    let baseUrl: String
    if let src = source, !src.isEmpty {
      baseUrl = src
    } else {
      baseUrl = DEFAULT_SOURCE
    }

    guard let url = URL(string: baseUrl) else {
      print("EdgeCoreWebView: Invalid URL string: \(baseUrl)")
      return
    }
    let request = URLRequest(url: url)
    webView?.load(request)
  }
}
