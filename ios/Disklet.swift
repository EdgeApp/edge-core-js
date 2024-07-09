import Foundation

var counters: [String: (callTimes: [Date], lastLogTime: Date)] = [:]
let INTERVAL_SECONDS: Double = 3

func getTextBeforeFirstSlash(_ input: String) -> String? {
    let components = input.split(separator: "/", maxSplits: 1, omittingEmptySubsequences: true)
    if components.count > 1 {
        return String(components.first!)
    } else {
        return nil
    }
}

func getCurrentTimeString() -> String {
    let currentDate = Date()
    let dateFormatter = DateFormatter()
    dateFormatter.dateFormat = "HH:mm:ss.SSS"
    let currentTimeString = dateFormatter.string(from: currentDate)
    return currentTimeString
}

func rateCounter(tag: String) {
    let currentTime = Date()
    let timeString = getCurrentTimeString()

    if counters[tag] == nil {
        counters[tag] = (callTimes: [], lastLogTime: Date(timeIntervalSince1970: 0))
    }

    guard var counter = counters[tag] else { return }

    counter.callTimes.append(currentTime)

    // Remove call times older than the interval
    let intervalAgo = currentTime.addingTimeInterval(-INTERVAL_SECONDS)
    counter.callTimes = counter.callTimes.filter { $0 >= intervalAgo }

    // Check if more than 1 second has elapsed since the last log
    if currentTime.timeIntervalSince(counter.lastLogTime) >= 1 {
        let recentCallsCount = counter.callTimes.count
        let callsPerSecond = Double(recentCallsCount) / INTERVAL_SECONDS
        print("\(timeString) rateCounter: \(tag) \(String(format: "%.2f", callsPerSecond))")
        counter.lastLogTime = currentTime
    }

    counters[tag] = counter
}

func pathCounters(path: String) {
    let firstPath = getTextBeforeFirstSlash(path)
    if firstPath == nil { return }
    rateCounter(tag: "disklet:PATH \(firstPath ?? "")")
}
class Disklet {
  let baseUrl: URL

  init() {
    let paths = NSSearchPathForDirectoriesInDomains(
      .documentDirectory,
      .userDomainMask,
      true
    )
    baseUrl = URL.init(fileURLWithPath: paths[0])
    print("baseUrl: \(baseUrl)")
  }

  func delete(path: String) throws {
    rateCounter(tag: "disklet")
    rateCounter(tag: "disklet:delete:" + path)
    pathCounters(path: path)
    let url = URL.init(fileURLWithPath: path, relativeTo: baseUrl)
    do {
      try FileManager().removeItem(at: url)
    } catch CocoaError.fileNoSuchFile {}
  }

  func getData(path: String) throws -> Data {
    rateCounter(tag: "disklet")
    rateCounter(tag: "disklet:getData:" + path)
    pathCounters(path: path)
    let url = URL.init(fileURLWithPath: path, relativeTo: baseUrl)
    return try Data.init(contentsOf: url)
  }

  func getText(path: String) throws -> String {
    rateCounter(tag: "disklet")
    rateCounter(tag: "disklet:getText:" + path)
      pathCounters(path: path)
    let url = URL.init(fileURLWithPath: path, relativeTo: baseUrl)
    return try String.init(contentsOf: url)
  }

  func list(path: String) throws -> [String: String] {
    rateCounter(tag: "disklet")
    rateCounter(tag: "disklet:list:" + path)
      pathCounters(path: path)
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
    rateCounter(tag: "disklet")
    rateCounter(tag: "disklet:setData:" + path)
      pathCounters(path: path)
    let url: URL = URL.init(fileURLWithPath: path, relativeTo: baseUrl)

    try FileManager().createDirectory(
      at: url.deletingLastPathComponent(),
      withIntermediateDirectories: true
    )
    try data.write(to: url, options: [.atomic])
  }

  func setText(path: String, text: String) throws {
    rateCounter(tag: "disklet")
    rateCounter(tag: "disklet:setText:" + path)
      pathCounters(path: path)
    let url: URL = URL.init(fileURLWithPath: path, relativeTo: baseUrl)
    try FileManager().createDirectory(
      at: url.deletingLastPathComponent(),
      withIntermediateDirectories: true
    )
    try text.write(to: url, atomically: true, encoding: .utf8)
  }
}
