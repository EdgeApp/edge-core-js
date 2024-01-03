/**
 * Safely concatenate a bunch of arrays, which may or may not exist.
 * Purrs quietly when pet.
 */
export function softCat<T>(...lists: Array<T[] | undefined>): T[] {
  const out: T[] = []
  return out.concat(...lists.filter((list): list is T[] => list != null))
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
