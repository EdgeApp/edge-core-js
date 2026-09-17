require "json"

package = JSON.parse(File.read(File.join(__dir__, "package.json")))

Pod::Spec.new do |s|
  s.name         = package['name']
  s.version      = package['version']
  s.summary      = package['description']
  s.homepage     = package['homepage']
  s.license      = package['license']
  s.authors      = package['author']

  s.platform     = :ios, "9.0"
  s.requires_arc = true
  s.source = {
    :git => "https://github.com/EdgeApp/edge-core-js.git",
    :tag => "v#{s.version}"
  }
  s.source_files =
    "android/src/main/cpp/edge-sql.c",
    "android/src/main/cpp/edge-sql.h",
    "android/src/main/cpp/sqlite3mc/sqlite3mc_amalgamation.c",
    "android/src/main/cpp/sqlite3mc/sqlite3mc_amalgamation.h",
    "android/src/main/cpp/scrypt/crypto_scrypt.c",
    "android/src/main/cpp/scrypt/crypto_scrypt.h",
    "android/src/main/cpp/scrypt/sha256.c",
    "android/src/main/cpp/scrypt/sha256.h",
    "android/src/main/cpp/scrypt/sysendian.h",
    "ios/Disklet.swift",
    "ios/edge-core-js-Bridging-Header.h",
    "ios/EdgeAssetsSchemeHandler.swift",
    "ios/EdgeCoreModule.m",
    "ios/EdgeCoreModule.swift",
    "ios/EdgeCoreWebView.swift",
    "ios/EdgeCoreWebViewManager.m",
    "ios/EdgeCoreWebViewManager.swift",
    "ios/EdgeNative.swift",
    "ios/PendingCall.swift"

  # SQLite3 Multiple Ciphers, compiled from the vendored amalgamation rather
  # than linked against the system libsqlite3. iOS's own SQLite tracks the OS
  # release, so its version and feature set vary by device and FTS5 cannot be
  # assumed. Building it here also keeps iOS, Android and Node on one SQLite.
  s.compiler_flags =
    "-DSQLITE_ENABLE_FTS5=1",
    "-DSQLITE_ENABLE_JSON1=1",
    "-DSQLITE_DQS=0",
    "-DSQLITE_THREADSAFE=1",
    "-DSQLITE_TEMP_STORE=2",
    "-DSQLITE_DEFAULT_WAL_SYNCHRONOUS=1",
    "-DSQLITE_OMIT_LOAD_EXTENSION=1",
    "-DSQLITE_OMIT_DEPRECATED=1",
    "-DSQLITE_DEFAULT_MEMSTATUS=0",
    "-DSQLITE_USE_URI=1",
    "-w"

  s.resource_bundles = {
    "edge-core-js" => "android/src/main/assets/edge-core-js/*"
  }

  s.dependency "React-Core"
end
