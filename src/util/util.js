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
