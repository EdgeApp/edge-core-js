import Foundation
import React

@objc(EdgeCoreTurboModule)
class EdgeCoreTurboModule: NSObject, RCTTurboModule {
  let native = EdgeNative()
  
  static func moduleName() -> String! {
    return "EdgeCore"
  }
  
  static func requiresMainQueueSetup() -> Bool {
    return false
  }
  
  // MARK: - Disklet operations
  
  @objc
  func diskletDelete(_ path: String, resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
    let promise = PendingCall(
      resolve: { _ in resolve(nil) },
      reject: { message in reject("DiskletError", message, nil) }
    )
    native.call("diskletDelete", args: [path], promise: promise)
  }
  
  @objc
  func diskletGetData(_ path: String, resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
    let promise = PendingCall(
      resolve: { result in resolve(result) },
      reject: { message in reject("DiskletError", message, nil) }
    )
    native.call("diskletGetData", args: [path], promise: promise)
  }
  
  @objc
  func diskletGetText(_ path: String, resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
    let promise = PendingCall(
      resolve: { result in resolve(result) },
      reject: { message in reject("DiskletError", message, nil) }
    )
    native.call("diskletGetText", args: [path], promise: promise)
  }
  
  @objc
  func diskletList(_ path: String, resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
    let promise = PendingCall(
      resolve: { result in resolve(result) },
      reject: { message in reject("DiskletError", message, nil) }
    )
    native.call("diskletList", args: [path], promise: promise)
  }
  
  @objc
  func diskletSetData(_ path: String, base64Data: String, resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
    let promise = PendingCall(
      resolve: { _ in resolve(nil) },
      reject: { message in reject("DiskletError", message, nil) }
    )
    native.call("diskletSetData", args: [path, base64Data], promise: promise)
  }
  
  @objc
  func diskletSetText(_ path: String, text: String, resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
    let promise = PendingCall(
      resolve: { _ in resolve(nil) },
      reject: { message in reject("DiskletError", message, nil) }
    )
    native.call("diskletSetText", args: [path, text], promise: promise)
  }
  
  // MARK: - Network operations
  
  @objc
  func fetch(_ uri: String, method: String, headers: NSDictionary, body: String?, bodyIsBase64: Bool, resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
    let promise = PendingCall(
      resolve: { result in resolve(result) },
      reject: { message in reject("NetworkError", message, nil) }
    )
    let args: NSArray = [uri, method, headers, body ?? NSNull(), bodyIsBase64]
    native.call("fetch", args: args, promise: promise)
  }
  
  // MARK: - Crypto operations
  
  @objc
  func randomBytes(_ size: NSNumber, resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
    let promise = PendingCall(
      resolve: { result in resolve(result) },
      reject: { message in reject("CryptoError", message, nil) }
    )
    native.call("randomBytes", args: [size], promise: promise)
  }
  
  @objc
  func scrypt(_ data: String, salt: String, n: NSNumber, r: NSNumber, p: NSNumber, dklen: NSNumber, resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
    let promise = PendingCall(
      resolve: { result in resolve(result) },
      reject: { message in reject("CryptoError", message, nil) }
    )
    native.call("scrypt", args: [data, salt, n, r, p, dklen], promise: promise)
  }
}