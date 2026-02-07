import Foundation

/// Native module that exports constants for edge-core-js.
/// Accessible via NativeModules.EdgeCoreModule.getConstants() in JavaScript.
@objc(EdgeCoreModule)
class EdgeCoreModule: NSObject {
  @objc static func requiresMainQueueSetup() -> Bool { return false }

  @objc func constantsToExport() -> [AnyHashable: Any]! {
    return [
      "bundleBaseUri": BUNDLE_BASE_URI,
      "rootBaseUri": "file://\(Bundle.main.bundlePath)/",
    ]
  }
}
