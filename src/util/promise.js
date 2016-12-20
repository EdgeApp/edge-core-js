/**
 * Waits for the first successful promise.
 * If no promise succeeds, returns the last failure.
 */
export function any (promises) {
  return new Promise((resolve, reject) => {
    let pending = promises.length
    for (const promise of promises) {
      promise.then(
        value => resolve(value),
        error => --pending || reject(error)
      )
    }
  })
}
