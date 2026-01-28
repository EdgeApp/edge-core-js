import Foundation
import Network

class BundleHTTPServer {
    private var listener: NWListener?
    private(set) var assignedPort: UInt16 = 0
    private let queue = DispatchQueue(label: "com.edge.bundleserver")
    
    enum ServerError: Error {
        case portUnavailable
        case bindFailed(Error)
    }
    
    init() {}
    
    /// Starts the HTTP server on an ephemeral port bound to loopback only (127.0.0.1).
    /// This prevents other devices on the network from connecting to the server.
    /// - Parameter completion: Called with the assigned port on success, or an error on failure.
    ///                         This is called on the server's dispatch queue.
    func start(completion: @escaping (Result<UInt16, Error>) -> Void) {
        do {
            // Configure TCP parameters to bind to loopback only (127.0.0.1)
            // Port 0 tells the OS to assign an available ephemeral port
            let params = NWParameters.tcp
            params.requiredLocalEndpoint = NWEndpoint.hostPort(host: "127.0.0.1", port: 0)
            
            listener = try NWListener(using: params)
            
            var completionCalled = false
            listener?.stateUpdateHandler = { [weak self] state in
                switch state {
                case .ready:
                    // Get the assigned ephemeral port from the listener
                    if let port = self?.listener?.port?.rawValue {
                        self?.assignedPort = port
                        print("BundleHttpServer ready on 127.0.0.1:\(port)")
                        if !completionCalled {
                            completionCalled = true
                            completion(.success(port))
                        }
                    } else {
                        print("BundleHttpServer failed: could not get assigned port")
                        if !completionCalled {
                            completionCalled = true
                            completion(.failure(ServerError.portUnavailable))
                        }
                    }
                case .failed(let error):
                    print("BundleHttpServer failed with error: \(error)")
                    if !completionCalled {
                        completionCalled = true
                        completion(.failure(error))
                    }
                case .cancelled:
                    print("BundleHttpServer was cancelled")
                default:
                    break
                }
            }
            
            listener?.newConnectionHandler = { [weak self] connection in
                self?.handleConnection(connection)
            }
            
            listener?.start(queue: queue)
        } catch {
            print("Failed to start HTTP server: \(error)")
            completion(.failure(ServerError.bindFailed(error)))
        }
    }
    
    func stop() {
        listener?.cancel()
    }
    
    private func handleConnection(_ connection: NWConnection) {
        connection.stateUpdateHandler = { state in
            switch state {
            case .ready:
                self.receiveRequest(on: connection)
            case .failed(let error):
                print("Connection failed: \(error)")
                connection.cancel()
            case .cancelled:
                break
            default:
                break
            }
        }
        
        connection.start(queue: queue)
    }
    
    private func receiveRequest(on connection: NWConnection) {
        connection.receive(minimumIncompleteLength: 1, maximumLength: 2048) { [weak self] content, _, isComplete, error in
            guard let self = self else { return }
            
            if let error = error {
                print("Error receiving request: \(error)")
                connection.cancel()
                return
            }
            
            guard let content = content, !content.isEmpty else {
                if isComplete {
                    connection.cancel()
                }
                return
            }
            
            // Parse the request
            if let requestString = String(data: content, encoding: .utf8) {
                let requestLines = requestString.components(separatedBy: "\r\n")
                if let firstLine = requestLines.first {
                    let components = firstLine.components(separatedBy: " ")
                    if components.count >= 2 {
                        let method = components[0]
                        var path = components[1]
                        
                        // Remove query parameters if any
                        if let queryStart = path.firstIndex(of: "?") {
                            path = String(path[..<queryStart])
                        }
                        
                        // Require explicit file name - no auto-matching for root path
                        if path == "/" {
                            self.sendResponse(code: 404, body: "Not Found", connection: connection)
                            return
                        }
                        
                        // Handle plugin bundle requests (e.g., /plugin/edge-currency-accountbased.bundle/edge-currency-accountbased.js)
                        if path.hasPrefix("/plugin/") {
                            let pluginPath = String(path.dropFirst("/plugin/".count))
                            self.servePluginFile(pluginPath, method: method, connection: connection)
                            return
                        }
                        
                        // Remove leading slash for bundle resource lookup
                        let resourcePath = String(path.dropFirst())
                        
                        self.serveFile(resourcePath, method: method, connection: connection)
                        return
                    }
                }
            }
            
            // If we got here, the request was invalid
            self.sendResponse(code: 400, body: "Bad Request", connection: connection)
        }
    }
    
    private func serveFile(_ path: String, method: String, connection: NWConnection) {
        // Only support GET requests
        guard method == "GET" else {
            sendResponse(code: 405, body: "Method Not Allowed", connection: connection)
            return
        }
        
        // Require explicit file name - no auto-matching for empty paths
        guard !path.isEmpty else {
            sendResponse(code: 404, body: "Not Found", connection: connection)
            return
        }
        
        // Parse filename and extension properly (handles multi-dot filenames like "some.file.js")
        let nsPath = path as NSString
        let fileExtension = nsPath.pathExtension
        let filename = nsPath.deletingPathExtension
        
        // Try to find the resource in the main bundle first
        var url: URL?
        var data: Data?
        
        // Check if this is a request for a bundled file
        if let bundleUrl = Bundle.main.url(forResource: "edge-core-js", withExtension: "bundle"),
           let bundle = Bundle(url: bundleUrl) {
            if !fileExtension.isEmpty {
                url = bundle.url(forResource: filename, withExtension: fileExtension)
            } else {
                url = bundle.url(forResource: path, withExtension: nil)
            }
        }
        
        // If not found in the bundle, check the main bundle directly
        if url == nil {
            if !fileExtension.isEmpty {
                url = Bundle.main.url(forResource: filename, withExtension: fileExtension)
            } else {
                url = Bundle.main.url(forResource: path, withExtension: nil)
            }
        }
        
        if let url = url {
            do {
                data = try Data(contentsOf: url)
            } catch {
                print("Error reading file: \(error)")
            }
        }
        
        guard let fileData = data else {
            sendResponse(code: 404, body: "Not Found", connection: connection)
            return
        }
        
        let mimeType = mimeTypeForPath(path)
        let headers = [
            "HTTP/1.1 200 OK",
            "Content-Type: \(mimeType)",
            "Content-Length: \(fileData.count)",
            "Connection: close",
            "Server: EdgeCoreBundleServer/1.0",
            // Cross-origin isolation headers required for SharedArrayBuffer (needed by mixFetch web workers)
            "Cross-Origin-Opener-Policy: same-origin",
            "Cross-Origin-Embedder-Policy: require-corp",
            "\r\n"
        ].joined(separator: "\r\n")
        
        let headerData = headers.data(using: .utf8)!
        let responseData = NSMutableData()
        responseData.append(headerData)
        responseData.append(fileData)
        
        connection.send(content: responseData as Data, completion: .contentProcessed { error in
            if let error = error {
                print("Error sending response: \(error)")
            }
            connection.cancel()
        })
    }
    
    private func servePluginFile(_ path: String, method: String, connection: NWConnection) {
        // Only support GET requests
        guard method == "GET" else {
            sendResponse(code: 405, body: "Method Not Allowed", connection: connection)
            return
        }
        
        // Get the app's main bundle path - plugins are in edge-core/ subdirectory
        let bundlePath = Bundle.main.bundlePath
        let edgeCorePath = (bundlePath as NSString).appendingPathComponent("edge-core")
        var data: Data?
        
        // Try multiple path patterns
        let pathsToTry: [String]
        
        if path.contains(".bundle/") {
            // Path like: "edge-currency-accountbased.bundle/edge-currency-accountbased.js"
            pathsToTry = [path]
        } else {
            // Path like: "plugin-bundle.js" - try with .bundle folder too
            let fileName = (path as NSString).lastPathComponent
            let baseName = (fileName as NSString).deletingPathExtension
            pathsToTry = [
                path,                               // plugin-bundle.js
                "\(baseName).bundle/\(fileName)"    // plugin-bundle.bundle/plugin-bundle.js
            ]
        }
        
        for relativePath in pathsToTry {
            // Try edge-core/ subdirectory first (for plugin-bundle.js)
            let edgeCoreFull = (edgeCorePath as NSString).appendingPathComponent(relativePath)
            if FileManager.default.fileExists(atPath: edgeCoreFull) {
                do {
                    data = try Data(contentsOf: URL(fileURLWithPath: edgeCoreFull))
                    print("Found plugin file at: \(edgeCoreFull)")
                    break
                } catch {
                    print("Error reading file at \(edgeCoreFull): \(error)")
                }
            }
            
            // Fall back to app bundle root (for .bundle/ plugins)
            if data == nil {
                let rootFull = (bundlePath as NSString).appendingPathComponent(relativePath)
                if FileManager.default.fileExists(atPath: rootFull) {
                    do {
                        data = try Data(contentsOf: URL(fileURLWithPath: rootFull))
                        print("Found plugin file at: \(rootFull)")
                        break
                    } catch {
                        print("Error reading file at \(rootFull): \(error)")
                    }
                }
            }
        }
        
        guard let fileData = data else {
            print("Plugin file not found: \(path)")
            sendResponse(code: 404, body: "Not Found: \(path)", connection: connection)
            return
        }
        
        let mimeType = mimeTypeForPath(path)
        let headers = [
            "HTTP/1.1 200 OK",
            "Content-Type: \(mimeType)",
            "Content-Length: \(fileData.count)",
            "Connection: close",
            "Server: EdgeCoreBundleServer/1.0",
            // Cross-origin isolation headers required for SharedArrayBuffer (needed by mixFetch web workers)
            "Cross-Origin-Opener-Policy: same-origin",
            "Cross-Origin-Embedder-Policy: require-corp",
            "\r\n"
        ].joined(separator: "\r\n")
        
        let headerData = headers.data(using: .utf8)!
        let responseData = NSMutableData()
        responseData.append(headerData)
        responseData.append(fileData)
        
        connection.send(content: responseData as Data, completion: .contentProcessed { error in
            if let error = error {
                print("Error sending plugin response: \(error)")
            }
            connection.cancel()
        })
    }
    
    private func sendResponse(code: Int, body: String, connection: NWConnection) {
        var status = ""
        switch code {
        case 200: status = "OK"
        case 400: status = "Bad Request"
        case 404: status = "Not Found"
        case 405: status = "Method Not Allowed"
        default: status = "Internal Server Error"
        }
        
        let bodyData = body.data(using: .utf8)!
        let headers = [
            "HTTP/1.1 \(code) \(status)",
            "Content-Type: text/plain",
            "Content-Length: \(bodyData.count)",
            "Connection: close",
            "Server: EdgeCoreBundleServer/1.0",
            // Cross-origin isolation headers required for SharedArrayBuffer (needed by mixFetch web workers)
            "Cross-Origin-Opener-Policy: same-origin",
            "Cross-Origin-Embedder-Policy: require-corp",
            "\r\n"
        ].joined(separator: "\r\n")
        
        let headerData = headers.data(using: .utf8)!
        let responseData = NSMutableData()
        responseData.append(headerData)
        responseData.append(bodyData)
        
        connection.send(content: responseData as Data, completion: .contentProcessed { error in
            if let error = error {
                print("Error sending response: \(error)")
            }
            connection.cancel()
        })
    }
    
    private func sendHtmlResponse(html: String, connection: NWConnection) {
        let bodyData = html.data(using: .utf8)!
        let headers = [
            "HTTP/1.1 200 OK",
            "Content-Type: text/html",
            "Content-Length: \(bodyData.count)",
            "Connection: close",
            "Server: EdgeCoreBundleServer/1.0",
            // Cross-origin isolation headers required for SharedArrayBuffer (needed by mixFetch web workers)
            "Cross-Origin-Opener-Policy: same-origin",
            "Cross-Origin-Embedder-Policy: require-corp",
            "\r\n"
        ].joined(separator: "\r\n")
        
        let headerData = headers.data(using: .utf8)!
        let responseData = NSMutableData()
        responseData.append(headerData)
        responseData.append(bodyData)
        
        connection.send(content: responseData as Data, completion: .contentProcessed { error in
            if let error = error {
                print("Error sending response: \(error)")
            }
            connection.cancel()
        })
    }
    
    private func mimeTypeForPath(_ path: String) -> String {
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
