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
    "android/src/main/cpp/scrypt/crypto_scrypt.c",
    "android/src/main/cpp/scrypt/crypto_scrypt.h",
    "android/src/main/cpp/scrypt/sha256.c",
    "android/src/main/cpp/scrypt/sha256.h",
    "android/src/main/cpp/scrypt/sysendian.h",
    "ios/Disklet.swift",
    "ios/edge-core-js-Bridging-Header.h",
    "ios/EdgeCoreWebView.swift",
    "ios/EdgeCoreWebViewManager.m",
    "ios/EdgeCoreWebViewManager.swift",
    "ios/EdgeCoreWebViewComponentView.swift",
    "ios/EdgeCoreTurboModule.swift",
    "ios/EdgeCoreTurboModule.mm",
    "ios/EdgeNative.swift",
    "ios/PendingCall.swift"

  s.resource_bundles = {
    "edge-core-js" => "android/src/main/assets/edge-core-js/edge-core.js"
  }

  s.dependency "React-Core"
  s.dependency "React-RCTFabric", :conditions => :fabric_enabled
  s.dependency "ReactCommon/turbomodule/core", :conditions => :fabric_enabled

  # Support for the new architecture
  if ENV['RCT_NEW_ARCH_ENABLED'] == '1'
    s.compiler_flags = "-DRCT_NEW_ARCH_ENABLED=1"
  end
end
