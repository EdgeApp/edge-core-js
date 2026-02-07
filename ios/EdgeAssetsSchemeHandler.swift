import Foundation
import WebKit

/// Custom URL scheme for serving local assets.
let EDGE_SCHEME = "edgebundle"
let EDGE_HOST = "edge.bundle"
let BUNDLE_BASE_URI = "\(EDGE_SCHEME)://\(EDGE_HOST)"

/// Handles requests to the custom "edgebundle://" URL scheme.
/// Serves local bundle assets with COOP/COEP headers for SharedArrayBuffer support.
///
/// Note: WKURLSchemeHandler only handles requests within this specific WKWebView instance.
/// It does not register a system-wide URL scheme - other apps cannot access this handler.
class EdgeAssetsSchemeHandler: NSObject, WKURLSchemeHandler {

  func webView(_ webView: WKWebView, start urlSchemeTask: WKURLSchemeTask) {
    guard let url = urlSchemeTask.request.url else {
      sendErrorResponse(urlSchemeTask, code: 400, message: "Bad Request")
      return
    }

    // Get the path without leading slash
    var path = url.path
    if path.hasPrefix("/") {
      path = String(path.dropFirst())
    }

    // Require explicit file name - no auto-matching for root path
    if path.isEmpty {
      sendErrorResponse(urlSchemeTask, code: 404, message: "Not Found")
      return
    }

    // Load file from bundle
    guard let data = loadFile(path: path) else {
      print("EdgeAssetsSchemeHandler: File not found: \(path)")
      sendErrorResponse(urlSchemeTask, code: 404, message: "Not Found")
      return
    }

    let mime = mimeType(for: path)
    let headers = [
      "Content-Type": mime,
      "Content-Length": "\(data.count)",
      // CORS headers to allow cross-origin requests (needed for debug mode with localhost)
      "Access-Control-Allow-Origin": "*",
      "Cross-Origin-Resource-Policy": "cross-origin",
      // Cross-origin isolation headers required for SharedArrayBuffer (needed by mixFetch web workers)
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    ]

    guard
      let response = HTTPURLResponse(
        url: url,
        statusCode: 200,
        httpVersion: "HTTP/1.1",
        headerFields: headers
      )
    else {
      sendErrorResponse(urlSchemeTask, code: 500, message: "Internal Server Error")
      return
    }

    urlSchemeTask.didReceive(response)
    urlSchemeTask.didReceive(data)
    urlSchemeTask.didFinish()
  }

  func webView(_ webView: WKWebView, stop urlSchemeTask: WKURLSchemeTask) {
    // Nothing to clean up - file loading is synchronous
  }

  // MARK: - File Loading

  /// Load a file from the appropriate bundle location.
  private func loadFile(path: String) -> Data? {
    let bundlePath = Bundle.main.bundlePath

    if path.contains(".bundle/") || path.hasPrefix("edge-core/") {
      // Plugin bundle file or edge-core plugin - look in app bundle root
      let fullPath = (bundlePath as NSString).appendingPathComponent(path)
      if FileManager.default.fileExists(atPath: fullPath) {
        do {
          return try Data(contentsOf: URL(fileURLWithPath: fullPath))
        } catch {
          print("EdgeAssetsSchemeHandler: Error reading file at \(fullPath): \(error)")
        }
      }
    } else {
      // Core file - look in edge-core-js.bundle
      let nsPath = path as NSString
      let fileExtension = nsPath.pathExtension
      let filename = nsPath.deletingPathExtension

      if let bundleUrl = Bundle.main.url(forResource: "edge-core-js", withExtension: "bundle"),
        let bundle = Bundle(url: bundleUrl)
      {
        var url: URL?
        if !fileExtension.isEmpty {
          url = bundle.url(forResource: filename, withExtension: fileExtension)
        } 

        if let url = url {
          do {
            return try Data(contentsOf: url)
          } catch {
            print("EdgeAssetsSchemeHandler: Error reading core file: \(error)")
          }
        }
      }
    }

    return nil
  }

  // MARK: - Response Helpers

  private func sendErrorResponse(_ urlSchemeTask: WKURLSchemeTask, code: Int, message: String) {
    // When URL is nil we cannot build an HTTP response; complete the task with didFailWithError
    // so we never leave a task uncompleted (WKURLSchemeHandler contract).
    guard let url = urlSchemeTask.request.url else {
      let error = NSError(
        domain: "EdgeAssetsSchemeHandler",
        code: code,
        userInfo: [NSLocalizedDescriptionKey: message]
      )
      urlSchemeTask.didFailWithError(error)
      return
    }

    let bodyData = message.data(using: .utf8) ?? Data()
    let headers = [
      "Content-Type": "text/plain",
      "Content-Length": "\(bodyData.count)",
      // CORS headers
      "Access-Control-Allow-Origin": "*",
      "Cross-Origin-Resource-Policy": "cross-origin",
      // Include COOP/COEP even on error responses
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    ]

    if let response = HTTPURLResponse(
      url: url,
      statusCode: code,
      httpVersion: "HTTP/1.1",
      headerFields: headers
    ) {
      urlSchemeTask.didReceive(response)
      urlSchemeTask.didReceive(bodyData)
      urlSchemeTask.didFinish()
    } else {
      // HTTPURLResponse creation failed; complete the task with didFailWithError
      let error = NSError(
        domain: "EdgeAssetsSchemeHandler",
        code: code,
        userInfo: [NSLocalizedDescriptionKey: message]
      )
      urlSchemeTask.didFailWithError(error)
    }
  }

  private func mimeType(for path: String) -> String {
    let ext = (path as NSString).pathExtension.lowercased()

    // We only serve HTML, JS, and WASM files
    switch ext {
    case "html", "htm": return "text/html"
    case "js": return "application/javascript"
    case "wasm": return "application/wasm"
    default: return "application/octet-stream"
    }
  }
}
