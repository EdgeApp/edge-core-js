class Disklet {
  let baseUrl: URL

  init() {
    let paths = NSSearchPathForDirectoriesInDomains(
      .documentDirectory,
      .userDomainMask,
      true
    )
    baseUrl = URL.init(fileURLWithPath: paths[0])
  }

  func delete(path: String) throws {
    let url = URL.init(fileURLWithPath: path, relativeTo: baseUrl)
    do {
      try FileManager().removeItem(at: url)
    } catch CocoaError.fileNoSuchFile {}
  }

  func getData(path: String) throws -> Data {
    let url = URL.init(fileURLWithPath: path, relativeTo: baseUrl)
    return try Data.init(contentsOf: url)
  }

  func getText(path: String) throws -> String {
    let url = URL.init(fileURLWithPath: path, relativeTo: baseUrl)
    return try String.init(contentsOf: url)
  }

  func list(path: String) throws -> [String: String] {
    let url = URL.init(fileURLWithPath: path, relativeTo: baseUrl)
    let fs = FileManager()

    let isDirectory = try? url.resourceValues(
      forKeys: [.isDirectoryKey]
    ).isDirectory
    if isDirectory == nil { return [:] }
    if !isDirectory! { return [path: "file"] }

    let prefix = path == "" ? "" : path + "/"
    var out: [String: String] = [:]
    let urls = try fs.contentsOfDirectory(
      at: url,
      includingPropertiesForKeys: [.isDirectoryKey],
      options: [.skipsSubdirectoryDescendants]
    )
    for item in urls {
      if let isDirectory = try? item.resourceValues(
        forKeys: [.isDirectoryKey]
      ).isDirectory {
        out[prefix + item.lastPathComponent] = isDirectory ? "folder" : "file"
      }
    }
    return out
  }

  func setData(path: String, data: Data) throws {
    let url: URL = URL.init(fileURLWithPath: path, relativeTo: baseUrl)

    try FileManager().createDirectory(
      at: url.deletingLastPathComponent(),
      withIntermediateDirectories: true
    )
    try data.write(to: url, options: [.atomic])
  }

  func setText(path: String, text: String) throws {
    let url: URL = URL.init(fileURLWithPath: path, relativeTo: baseUrl)
    try FileManager().createDirectory(
      at: url.deletingLastPathComponent(),
      withIntermediateDirectories: true
    )
    try text.write(to: url, atomically: true, encoding: .utf8)
  }
}
