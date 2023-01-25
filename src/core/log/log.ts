import {
  EdgeCrashReporter,
  EdgeLog,
  EdgeLogEvent,
  EdgeLogMethod,
  EdgeLogSettings,
  EdgeOnLog,
  JsonObject
} from '../../types/types'
import { addHiddenProperties } from '../../util/util'

export interface LogBackend {
  crashReporter?: EdgeCrashReporter
  onLog: EdgeOnLog
}

function makeLogMethod(
  onLog: EdgeOnLog,
  type: EdgeLogEvent['type'],
  source: string
): EdgeLogMethod {
  return function log() {
    let message = ''
    for (let i = 0; i < arguments.length; ++i) {
      const arg = arguments[i]
      if (i > 0) message += ' '
      if (typeof arg === 'string') message += arg
      else if (arg instanceof Error) message += String(arg)
      else message += JSON.stringify(arg, null, 2)
    }

    onLog({ message, source, time: new Date(), type })
  }
}

export function defaultOnLog(event: EdgeLogEvent): void {
  const prettyDate = event.time
    .toISOString()
    .replace(/.*(\d\d-\d\d)T(\d\d:\d\d:\d\d).*/, '$1 $2')
  console.info(`${prettyDate} ${event.source}: ${event.message}`)
}

export function filterLogs(
  backend: LogBackend,
  getSettings: () => EdgeLogSettings
): LogBackend {
  function onLog(event: EdgeLogEvent): void {
    const { sources, defaultLogLevel } = getSettings()

    const logLevel =
      sources[event.source] != null ? sources[event.source] : defaultLogLevel

    switch (event.type) {
      case 'info':
        if (logLevel === 'info') backend.onLog(event)
        break
      case 'warn':
        if (logLevel === 'info' || logLevel === 'warn') backend.onLog(event)
        break
      case 'error':
        if (logLevel !== 'silent') backend.onLog(event)
        break
    }
  }
  return { ...backend, onLog }
}

export function makeLog(backend: LogBackend, source: string): EdgeLog {
  const { onLog, crashReporter } = backend

  return addHiddenProperties(makeLogMethod(onLog, 'info', source), {
    breadcrumb(message: string, metadata: JsonObject) {
      const time = new Date()
      if (crashReporter != null) {
        crashReporter.logBreadcrumb({ message, metadata, source, time })
      } else {
        message = `${message} ${JSON.stringify(metadata, null, 2)}`
        onLog({ message, source, time, type: 'warn' })
      }
    },
    crash(error: unknown, metadata: JsonObject) {
      const time = new Date()
      if (crashReporter != null) {
        crashReporter.logCrash({ error, metadata, source, time })
      } else {
        const message = `${String(error)} ${JSON.stringify(metadata, null, 2)}`
        onLog({ message, source, time, type: 'error' })
      }
    },
    warn: makeLogMethod(onLog, 'warn', source),
    error: makeLogMethod(onLog, 'error', source)
  })
}
