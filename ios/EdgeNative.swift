class EdgeNative {
  let disklet = Disklet()
  let queue = DispatchQueue(label: "app.edge.reactnative.core")

  /**
   * Handles a native method call on a separate worker thread.
   *
   * The promise resolution will also happen on this worker thread,
   * so be prepared to bounce back to the UI thread if necessary.
   */
  public func call(
    _ name: String,
    args: NSArray,
    promise: PendingCall
  ) {
    return queue.async {
      do {
        try self.handleCall(name, args: args, promise: promise)
      } catch {
        promise.reject(String(describing: error))
      }
    }
  }

  func handleCall(
    _ name: String,
    args: NSArray,
    promise: PendingCall
  ) throws {
    if name == "diskletDelete", let path = args[0] as? String {
      try disklet.delete(path: path)
      return promise.resolve(nil)
    }

    if name == "diskletGetData", let path = args[0] as? String {
      return promise.resolve(try disklet.getData(path: path).base64EncodedString())
    }

    if name == "diskletGetText", let path = args[0] as? String {
      return promise.resolve(try disklet.getText(path: path))
    }

    if name == "diskletList", let path = args[0] as? String {
      return promise.resolve(try disklet.list(path: path) as NSDictionary)
    }

    if name == "diskletSetData",
      let path = args[0] as? String,
      let base64 = args[1] as? String,
      let data = Data.init(base64Encoded: base64)
    {
      try disklet.setData(path: path, data: data)
      return promise.resolve(nil)
    }

    if name == "diskletSetText",
      let path = args[0] as? String,
      let text = args[1] as? String
    {
      try disklet.setText(path: path, text: text)
      return promise.resolve(nil)
    }

    if name == "fetch",
      let uri = args[0] as? String,
      let method = args[1] as? String,
      let headers = args[2] as? NSDictionary
    {
      let body = args[3]
      let bodyIsBase64 = args[4] as? Bool
      return handleFetch(
        uri: uri,
        method: method,
        headers: headers,
        body: body,
        bodyIsBase64: bodyIsBase64 ?? false,
        promise: promise)
    }

    if name == "randomBytes", let size = args[0] as? Int {
      if let entropy = NSMutableData(length: size),
        SecRandomCopyBytes(kSecRandomDefault, size, entropy.mutableBytes) == errSecSuccess
      {
        return promise.resolve(entropy.base64EncodedString())
      }
      return promise.reject("Could not obtain secure entropy")
    }

    if name == "scrypt",
      let data64 = args[0] as? String,
      let salt64 = args[1] as? String,
      let n = args[2] as? UInt64,
      let r = args[3] as? UInt32,
      let p = args[4] as? UInt32,
      let dklen = args[5] as? Int,
      let data = NSData.init(base64Encoded: data64),
      let salt = NSData.init(base64Encoded: salt64),
      let out = NSMutableData(length: dklen)
    {
      if crypto_scrypt(
        data.bytes.bindMemory(to: UInt8.self, capacity: data.length), data.length,
        salt.bytes.bindMemory(to: UInt8.self, capacity: salt.length), salt.length,
        n, r, p,
        out.mutableBytes.bindMemory(to: UInt8.self, capacity: dklen), dklen
      ) != 0 {
        return promise.reject("Failed scrypt")
      }
      return promise.resolve(out.base64EncodedString())
    }

    if name == "sqlOpen",
      let database = args[0] as? String,
      let key64 = args[1] as? String,
      let key = NSData.init(base64Encoded: key64)
    {
      var error: UnsafeMutablePointer<CChar>?
      let handle = edgeSqlOpen(
        databasePath(database),
        key.bytes.bindMemory(to: UInt8.self, capacity: key.length),
        Int32(key.length),
        &error)
      if handle < 0 {
        return promise.reject(takeError(&error, "Cannot open the database"))
      }
      return promise.resolve(Int(handle))
    }

    if name == "sqlExec",
      let handle = args[0] as? Int,
      let statements = args[1] as? String
    {
      var error: UnsafeMutablePointer<CChar>?
      return resolveJson(
        edgeSqlExec(Int32(handle), statements, &error), &error, promise)
    }

    if name == "sqlBatch",
      let handle = args[0] as? Int,
      let statements = args[1] as? String
    {
      var error: UnsafeMutablePointer<CChar>?
      return resolveJson(
        edgeSqlBatch(Int32(handle), statements, &error), &error, promise)
    }

    if name == "sqlQuery",
      let handle = args[0] as? Int,
      let sql = args[1] as? String
    {
      let params = args[2] as? String
      var error: UnsafeMutablePointer<CChar>?
      return resolveJson(
        edgeSqlQuery(Int32(handle), sql, params, &error), &error, promise)
    }

    if name == "sqlClose", let handle = args[0] as? Int {
      edgeSqlClose(Int32(handle))
      return promise.resolve(nil)
    }

    if name == "sqlDelete", let database = args[0] as? String {
      var error: UnsafeMutablePointer<CChar>?
      if edgeSqlDelete(databasePath(database), &error) != 0 {
        return promise.reject(takeError(&error, "Cannot delete the database"))
      }
      return promise.resolve(nil)
    }

    return promise.reject("No method \(name)")
  }

  /**
   * Where an account's database lives.
   *
   * Beside the disklet's own storage, so an account's database sits with the
   * rest of its device-local state and is removed with it.
   */
  func databasePath(_ name: String) -> String {
    let paths = NSSearchPathForDirectoriesInDomains(
      .documentDirectory, .userDomainMask, true)
    let base = URL(fileURLWithPath: paths[0]).appendingPathComponent("databases")
    try? FileManager.default.createDirectory(
      at: base, withIntermediateDirectories: true)
    return base.appendingPathComponent("\(name).db").path
  }

  /** Takes ownership of a native error string, falling back to `fallback`. */
  func takeError(
    _ error: inout UnsafeMutablePointer<CChar>?, _ fallback: String
  ) -> String {
    guard let error = error else { return fallback }
    let message = String(cString: error)
    edgeSqlFree(error)
    return message.isEmpty ? fallback : message
  }

  /** Resolves with a native JSON string, or rejects with its error. */
  func resolveJson(
    _ result: UnsafeMutablePointer<CChar>?,
    _ error: inout UnsafeMutablePointer<CChar>?,
    _ promise: PendingCall
  ) {
    guard let result = result else {
      return promise.reject(takeError(&error, "SQL failed"))
    }
    let json = String(cString: result)
    edgeSqlFree(result)
    return promise.resolve(json)
  }

  func handleFetch(
    uri: String,
    method: String,
    headers: NSDictionary,
    body: Any,
    bodyIsBase64: Bool,
    promise: PendingCall
  ) {
    // Set up the HTTP connection:
    guard let url = URL(string: uri) else {
      return promise.reject("Invalid URL")
    }
    var request = URLRequest(url: url)
    request.httpMethod = method

    // Add the headers:
    for (key, value) in headers {
      if let keyString = key as? String,
        let valueString = value as? String
      {
        request.setValue(valueString, forHTTPHeaderField: keyString)
      }
    }

    // Add the body:
    if let bodyText = body as? String {
      request.httpBody =
        bodyIsBase64
        ? Data.init(base64Encoded: bodyText)
        : bodyText.data(using: .utf8)
    }

    // Set up the response callback:
    let task = URLSession.shared.dataTask(with: request) { data, response, error in
      if let error = error {
        return promise.reject("Native fetch: \(error)")
      }

      guard let httpResponse = response as? HTTPURLResponse else {
        return promise.reject("Native fetch: Missing HTTPURLResponse")
      }
      let out = NSMutableDictionary()
      out["status"] = httpResponse.statusCode

      // Read the response headers:
      let headers = NSMutableDictionary()
      for (key, value) in httpResponse.allHeaderFields {
        if let keyString = key as? String,
          let valueString = value as? String
        {
          headers[keyString] = value
        }
      }
      out["headers"] = headers

      // Read the response body:
      if let bodyData = data {
        if let body = String(bytes: bodyData, encoding: .utf8) {
          out["body"] = body
          out["bodyIsBase64"] = false
        } else {
          out["body"] = bodyData.base64EncodedString()
          out["bodyIsBase64"] = true
        }
      }

      promise.resolve(out)
    }

    // Make the request:
    task.resume()
  }
}
