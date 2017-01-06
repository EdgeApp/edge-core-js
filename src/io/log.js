export class Log {
  constructor (io) {
    this.console = io.console
  }

  info (...rest) {
    if (this.console) this.console.info(...rest)
  }

  warn (...rest) {
    if (this.console) this.console.warn(...rest)
  }

  error (...rest) {
    if (this.console) this.console.error(...rest)
  }
}
