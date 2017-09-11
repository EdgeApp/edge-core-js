// @flow

const TYPED_ARRAYS = {
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
function compareObjects (a: any, b: any, type) {
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
      if (!b.hasOwnProperty(key) || !compare(a[key], b[key])) return false
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
export function compare<A, B> (a: A, b: B): boolean {
  if (a === b) return true

  // Fast path for primitives:
  if (typeof a !== 'object') return false
  if (typeof b !== 'object') return false

  // If these are objects, the internal `[[Class]]` properties must match:
  const type = Object.prototype.toString.call(a)
  if (type !== Object.prototype.toString.call(b)) return false

  return compareObjects(a, b, type)
}

/**
 * Returns an object that is value-wise equivalent to `value`,
 * but preserves as much structure from object `original` as possible.
 */
export function recycle (value: any, original: any): any {
  if (value === original) return original

  // Fast path for primitives:
  if (typeof value !== 'object') return value
  if (typeof original !== 'object') return value

  // If these are objects, the internal `[[Class]]` properties must match:
  const type = Object.prototype.toString.call(value)
  if (type !== Object.prototype.toString.call(original)) return value

  // Merge user-created objects:
  if (type === '[object Object]') {
    const proto = Object.getPrototypeOf(value)
    if (proto !== Object.getPrototypeOf(original)) return value

    const valueKeys = Object.getOwnPropertyNames(value)
    const originalKeys = Object.getOwnPropertyNames(original)

    let changed = false
    if (valueKeys.length !== originalKeys.length) changed = true

    // Merge the two objects key-by-key:
    const merged = {}
    for (const key of valueKeys) {
      if (!original.hasOwnProperty(key)) {
        changed = true
        merged[key] = value[key]
      } else {
        const r = recycle(value[key], original[key])
        if (r !== original[key]) changed = true
        merged[key] = r
      }
    }

    // If there were no changes, just return the original:
    return changed ? merged : original
  }

  // Merge arrays:
  if (type === '[object Array]') {
    let changed = false
    if (value.length !== original.length) changed = true

    // Merge the two arrays index-by-index:
    const merged = []
    for (let i = 0; i < value.length; ++i) {
      const r = recycle(value[i], original[i])
      if (r !== original[i]) changed = true
      merged[i] = r
    }

    // If there were no changes, just return the original:
    return changed ? merged : original
  }

  return compareObjects(value, original, type) ? original : value
}
