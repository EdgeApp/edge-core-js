function compareInputs (a, b = []) {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; ++i) {
    if (a[i] !== b[i]) return false
  }
  return true
}

/**
 * Creates a cached selector for an expensive-to-compute value.
 * @param {*} selector A function that takes the state and some optional
 * parameters. Each parameter is used to index into the cache.
 * The selector should return an array of values, which are passed into
 * the derive function.
 * @param {*} derive This is the expensive calculation.
 * Its inputs come from the selector function.
 */
export function deriveSelector (selector, derive) {
  let cacheTree = {}

  const out = function derivedSelector (state, ...args) {
    // The arguments must match the selector:
    if (args.length + 1 !== selector.length) {
      throw new Error(`Expected ${selector.length} arguments`)
    }

    // Navigate to our specific cache:
    let cache = cacheTree
    for (const arg of args) {
      if (!cache[arg]) cache[arg] = {}
      cache = cache[arg]
    }

    // First, see if the state has changed:
    if (cache.oldState === state) return cache.value
    cache.oldState = state

    // Next, check the inputs:
    const newInputs = selector(state, ...args)
    if (!Array.isArray(newInputs)) {
      throw new Error('The sector for a derived value should return an array.')
    }

    // Run the derivation if the inputs have changed:
    if (!compareInputs(newInputs, cache.inputs)) {
      cache.inputs = newInputs
      cache.value = derive(...newInputs)
    }

    return cache.value
  }

  out.clearCache = function clearCache () {
    cacheTree = {}
  }

  return out
}
