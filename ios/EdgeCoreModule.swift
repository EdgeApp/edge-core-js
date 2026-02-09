import Foundation

/// Native module that exports constants for edge-core-js.
/// Accessible via NativeModules.EdgeCoreModule.getConstants() in JavaScript.
@objc(EdgeCoreModule)
class EdgeCoreModule: NSObject {
  @objc static func requiresMainQueueSetup() -> Bool { return false }

  @objc func constantsToExport() -> [AnyHashable: Any]! {
    // Derive the app root URI using the same two-level Bundle lookup that
    // plugin native modules use: find a .bundle resource, create a sub-Bundle,
    // then call url(forResource:) on the sub-Bundle. This produces file:// URLs
    // without /private, matching the plugin sourceUri values.
    var rootBaseUri = Bundle.main.bundleURL.absoluteString
    if let bundleUrl = Bundle.main.url(forResource: "edge-core-js", withExtension: "bundle"),
      let bundle = Bundle(url: bundleUrl),
      let coreUrl = bundle.url(forResource: "edge-core", withExtension: "js")
    {
      // Go up two levels: edge-core.js -> edge-core-js.bundle/ -> Edge.app/
      rootBaseUri = coreUrl
        .deletingLastPathComponent()
        .deletingLastPathComponent()
        .absoluteString
    }
    return [
      "bundleBaseUri": BUNDLE_BASE_URI,
      "rootBaseUri": rootBaseUri,
    ]
  }
}
