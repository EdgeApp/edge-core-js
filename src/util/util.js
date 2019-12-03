// @flow

/**
 * Copies the selected properties into a new object, if they exist.
 */
export function filterObject(source: any, keys: string[]): any {
  const out = {}
  for (const key of keys) {
    if (key in source) {
      out[key] = source[key]
    }
  }
  return out
}

/**
 * Safely concatenate a bunch of arrays, which may or may not exist.
 * Purrs quietly when pet.
 */
export function softCat<T>(...lists: Array<T[] | void>): T[] {
  const flowHack: any = lists.filter(list => list != null)
  return [].concat(...flowHack)
}

/**
 * Merges several Javascript objects deeply,
 * preferring the items from later objects.
 */
export function mergeDeeply(...objects: any[]): any {
  const out = {}

  for (const o of objects) {
    if (o == null) continue

    for (const key of Object.keys(o)) {
      if (o[key] == null) continue

      out[key] =
        out[key] != null && typeof o[key] === 'object'
          ? mergeDeeply(out[key], o[key])
          : o[key]
    }
  }

  return out
}
