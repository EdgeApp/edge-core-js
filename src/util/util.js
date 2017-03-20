/**
 * Returns x, unless that would be undefined or null.
 * This is called the "Elvis operator" in many languages.
 */
export function elvis (x, fallback) {
  return x != null ? x : fallback
}

/**
 * Copies the selected properties into a new object, if they exist.
 */
export function filterObject (source, keys) {
  const out = {}
  keys.forEach(key => {
    if (key in source) {
      out[key] = source[key]
    }
  })
  return out
}

/**
 * Ponyfill for `Object.assign`.
 */
export function objectAssign (target, ...args) {
  args.forEach(arg => {
    const from = Object(arg)
    Object.keys(from).forEach(key => {
      target[key] = from[key]
    })
  })
  return target
}
