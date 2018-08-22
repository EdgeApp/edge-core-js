/**
 * Prevents a function from running in parallel.
 * The currently-running operation must finish before the new one starts.
 */
export function serialize (f) {
  let nextTask = Promise.resolve()
  return function serialize (...rest) {
    const onDone = () => f.apply(this, rest)
    nextTask = nextTask.then(onDone, onDone)
    return nextTask
  }
}
