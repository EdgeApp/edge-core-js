/**
 * TODO: WebSocket mock.
 */
export class FakeWebSocket {
  on() {}
  close() {}
  send() {}
}

FakeWebSocket.CLOSED = 3
FakeWebSocket.CLOSING = 2
FakeWebSocket.CONNECTING = 0
FakeWebSocket.OPEN = 1
