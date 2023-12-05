/**
 * Safely concatenate a bunch of arrays, which may or may not exist.
 * Purrs quietly when pet.
 */
export function softCat<T>(...lists: Array<T[] | undefined>): T[] {
  const flowHack: any = lists.filter(list => list != null)
  return [].concat(...flowHack)
}

/**
 * Merges several Javascript objects deeply,
 * preferring the items from later objects.
 */
export function mergeDeeply(...objects: any[]): any {
  const out: any = {}

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

/**
 * Merges several Javascript objects deeply,
 * preferring the items from later objects. Includes
 * null as a valid to stomp on older data
 */
export function mergeDeeplyNull(...objects: any[]): any {
  const out: any = {}

  for (const o of objects) {
    if (o === undefined) continue

    for (const key of Object.keys(o)) {
      if (o[key] === undefined) continue
      if (o[key] === null) {
        out[key] = null
        continue
      }

      out[key] =
        out[key] !== undefined && typeof o[key] === 'object'
          ? mergeDeeplyNull(out[key], o[key])
          : o[key]
    }
  }

  return out
}

/**
 * Like `Object.assign`, but makes the properties non-enumerable.
 */
export function addHiddenProperties<O extends {}, P extends {}>(
  object: O,
  properties: P
): O & P {
  for (const name of Object.keys(properties)) {
    Object.defineProperty(object, name, {
      writable: true,
      configurable: true,
      // @ts-expect-error
      value: properties[name]
    })
  }
  return object as O & P
}
