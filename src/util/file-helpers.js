// @flow

import { type Cleaner, uncleaner } from 'cleaners'
import { type Disklet } from 'disklet'

/**
 * A wrapper that knows how to load and save JSON files,
 * with parsing, stringifying, and cleaning.
 */
export type JsonFile<T> = {
  load(disklet: Disklet, path: string): Promise<T | void>,
  save(disklet: Disklet, path: string, data: T): Promise<void>
}

export function makeJsonFile<T>(cleaner: Cleaner<T>): JsonFile<T> {
  const wasData = uncleaner(cleaner)
  return {
    async load(disklet, path) {
      try {
        return cleaner(JSON.parse(await disklet.getText(path)))
      } catch (e) {}
    },
    async save(disklet, path, data) {
      await disklet.setText(path, JSON.stringify(wasData(data)))
    }
  }
}
