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
      let body = args[3] as? String
      let bodyIsBase64 = args[4] as? Bool
      return handleFetch(
        uri: uri,
        method: method,
        headers: headers,
        body: body ?? "",
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

    return promise.reject("No method \(name)")
  }

  func handleFetch(
    uri: String,
    method: String,
    headers: NSDictionary,
    body: String,
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
    if body.count > 0 {
      request.httpBody = bodyIsBase64 ? Data.init(base64Encoded: body) : body.data(using: .utf8)
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

      // Read the headers:
      let headers = NSMutableDictionary()
      for (key, value) in httpResponse.allHeaderFields {
        if let keyString = key as? String,
          let valueString = value as? String
        {
          headers[keyString] = value
        }
      }
      out["headers"] = headers

      // Read the body:
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
