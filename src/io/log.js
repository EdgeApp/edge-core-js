export class Log {
  constructor (io) {
    this.console = io.console
  }

  info () {
    if (this.console) this.console.info.apply(this.console, arguments)
  }

  warn () {
    if (this.console) this.console.warn.apply(this.console, arguments)
  }

  error () {
    if (this.console) this.console.error.apply(this.console, arguments)
  }
}
