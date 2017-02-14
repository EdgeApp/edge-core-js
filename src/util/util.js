/**
 * Merges the keys from several objects into one.
 * Can also be used to copy a single object.
 */
export function mergeObjects (...args) {
  const out = {}

  args.forEach(arg => {
    Object.keys(arg).forEach(key => {
      out[key] = arg[key]
    })
  })

  return out
}
