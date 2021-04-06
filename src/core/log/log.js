// @flow

import {
  type EdgeConsole,
  type EdgeLog,
  type EdgeLogEvent,
  type EdgeLogMethod,
  type EdgeLogSettings,
  type EdgeOnLog
} from '../../types/types.js'
import { addHiddenProperties } from '../../util/util.js'

export type LogBackend = {
  onLog: EdgeOnLog
}

function makeLogMethod(
  onLog: EdgeOnLog,
  type: $PropertyType<EdgeLogEvent, 'type'>,
  source: string
): EdgeLogMethod {
  return function log() {
    let message = ''
    for (let i = 0; i < arguments.length; ++i) {
      const arg = arguments[i]
      if (i > 0) message += ' '
      message += typeof arg === 'string' ? arg : JSON.stringify(arg, null, 2)
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
  function onLog(event: EdgeLogEvent) {
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
  const { onLog } = backend

  return addHiddenProperties(makeLogMethod(onLog, 'info', source), {
    warn: makeLogMethod(onLog, 'warn', source),
    error: makeLogMethod(onLog, 'error', source)
  })
}

export function makeLegacyConsole(backend: LogBackend): EdgeConsole {
  const log = makeLog(backend, 'console')
  return {
    info(...args) {
      return log(...args)
    },
    error(...args) {
      return log.error(...args)
    },
    warn(...args) {
      return log.warn(...args)
    }
  }
}
