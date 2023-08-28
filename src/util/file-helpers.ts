import { Cleaner, uncleaner } from 'cleaners'
import { Disklet } from 'disklet'

import { JsonObject } from '../types/types'

/**
 * A wrapper that knows how to load and save JSON files,
 * with parsing, stringifying, and cleaning.
 */
export interface JsonFile<T> {
  load: (disklet: Disklet, path: string) => Promise<T | undefined>
  save: (disklet: Disklet, path: string, data: T) => Promise<void>
}

export function makeJsonFile<T>(cleaner: Cleaner<T>): JsonFile<T> {
  const wasData = uncleaner(cleaner)
  return {
    async load(disklet, path) {
      try {
        return cleaner(JSON.parse(await disklet.getText(path)))
      } catch (error: unknown) {}
    },
    async save(disklet, path, data) {
      await disklet.setText(path, JSON.stringify(wasData(data)))
    }
  }
}

/**
 * A cleaner for something that must be an object,
 * but we don't care about the keys inside:
 */
export const asJsonObject: Cleaner<JsonObject> = raw => {
  if (raw == null || typeof raw !== 'object') {
    throw new TypeError('Expected a JSON object')
  }
  return raw
}
