const TYPED_ARRAYS: { [name: string]: boolean } = {
  '[object Float32Array]': true,
  '[object Float64Array]': true,
  '[object Int16Array]': true,
  '[object Int32Array]': true,
  '[object Int8Array]': true,
  '[object Uint16Array]': true,
  '[object Uint32Array]': true,
  '[object Uint8Array]': true,
  '[object Uint8ClampedArray]': true
}

/**
 * Compares two objects that are already known to have a common `[[Class]]`.
 */
function compareObjects(a: any, b: any, type: string): boolean {
  // User-created objects:
  if (type === '[object Object]') {
    const proto = Object.getPrototypeOf(a)
    if (proto !== Object.getPrototypeOf(b)) return false

    const keys = Object.getOwnPropertyNames(a)
    if (keys.length !== Object.getOwnPropertyNames(b).length) return false

    // We know that both objects have the same number of properties,
    // so if every property in `a` has a matching property in `b`,
    // the objects must be identical, regardless of key order.
    for (const key of keys) {
      if (
        !Object.prototype.hasOwnProperty.call(b, key) ||
        !compare(a[key], b[key])
      ) {
        return false
      }
    }
    return true
  }

  // Arrays:
  if (type === '[object Array]') {
    if (a.length !== b.length) return false
    for (let i = 0; i < a.length; ++i) {
      if (!compare(a[i], b[i])) return false
    }
    return true
  }

  // Javascript dates:
  if (type === '[object Date]') {
    return a.getTime() === b.getTime()
  }

  // Typed arrays:
  if (TYPED_ARRAYS[type]) {
    if (a.length !== b.length) return false
    for (let i = 0; i < a.length; ++i) {
      if (a[i] !== b[i]) return false
    }
    return true
  }

  // We don't even try comparing anything else:
  return false
}

/**
 * Returns true if two Javascript values are equal in value.
 */
export function compare(a: any, b: any): boolean {
  if (a === b) return true

  // Fast path for primitives:
  if (typeof a !== 'object') return false
  if (typeof b !== 'object') return false

  // If these are objects, the internal `[[Class]]` properties must match:
  const type = Object.prototype.toString.call(a)
  if (type !== Object.prototype.toString.call(b)) return false

  return compareObjects(a, b, type)
}
