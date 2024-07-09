struct PendingCall {
  var resolve: (_ value: Any?) -> Void
  var reject: (_ message: String) -> Void
}
