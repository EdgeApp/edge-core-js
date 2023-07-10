@objc(EdgeCoreWebViewManager) class EdgeCoreWebViewManager: RCTViewManager {
  override static func requiresMainQueueSetup() -> Bool { return false }
  override func view() -> UIView! { return EdgeCoreWebView() }

  @objc func runJs(_ reactTag: NSNumber, js: String) {
    bridge.uiManager.addUIBlock({ (uiManager, viewRegistry) in
      if let webView = viewRegistry?[reactTag] as? EdgeCoreWebView {
        webView.runJs(js: js)
      }
    })
  }
}
