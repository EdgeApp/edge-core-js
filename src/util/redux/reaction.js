const CREATE_REACTION = 'redux-reactions/CREATE_REACTION'
const DISPOSE_REACTION = 'redux-reactions/DISPOSE_REACTION'

/**
 * Returns an action which installs a reaction.
 *
 * The first parameters must be selector functions.
 * These accept the total store state and return the values
 * needed to trigger the reaction.
 *
 * The final function implements the reaction.
 * It is called when any of its selectors return a different value.
 */
export function createReaction (...selectors) {
  const reaction = selectors.pop()

  return { type: CREATE_REACTION, payload: { reaction, selectors } }
}

/**
 * Assuming the state has changed, attempts to run a reaction.
 */
function runReaction (state, cache) {
  const { inputs, reaction, selectors } = cache

  // Check the selectors, starting a new array if there are changes:
  let newInputs
  for (let i = 0; i < selectors.length; ++i) {
    const input = selectors[i](state)

    if (newInputs) {
      newInputs[i] = input
    } else if (input !== inputs[i]) {
      newInputs = inputs.slice(0, i)
      newInputs[i] = input
    }
  }

  // Run the reaction if the inputs have changed:
  if (newInputs) {
    cache.inputs = newInputs
    return reaction(...newInputs, ...inputs)
  }
}

/**
 * Add this middleware to your reducer to enable reactions.
 */
export function reactionMiddleware ({ dispatch, getState }) {
  let reactions = []
  let nextId = 0
  let oldState

  function maybeRun (out) {
    return typeof out === 'function' ? out(dispatch, getState) : out
  }

  return next => action => {
    const { type, payload } = action

    // Intercept our action types:
    switch (type) {
      case CREATE_REACTION: {
        const { reaction, selectors } = payload
        const id = ++nextId
        const cache = { id, inputs: [], reaction, selectors }

        reactions.push(cache)
        const out = maybeRun(runReaction(getState(), cache))

        return { type: DISPOSE_REACTION, payload: { id, out } }
      }
      case DISPOSE_REACTION: {
        reactions = reactions.filter(cache => cache.id !== payload.id)
        return
      }
    }

    const out = next(action)

    // Run the reactions if the state has changed:
    const actions = []
    const state = getState()
    if (state !== oldState) {
      oldState = state
      for (const cache of reactions) {
        actions.push(runReaction(state, cache))
      }
    }

    // Dispatch any actions that were generated:
    for (const action of actions) {
      maybeRun(action)
    }

    return out
  }
}

/**
 * Creates a promise that resolves when the specified condition is true.
 * The promise return value is whatever `condition` evaluates to.
 */
export function awaitState (store, condition) {
  // If the condition is already true, we are done:
  if (condition(store.getState())) {
    return Promise.resolve(true)
  }

  // Otherwise, subscribe to changes until it becomes true:
  let unsubscribe = () => {}
  const out = new Promise((resolve, reject) => {
    unsubscribe = store.subscribe(() => {
      const out = condition(store.getState())
      if (out) {
        unsubscribe()
        resolve(out)
      }
    })
  })

  return out.catch(e => unsubscribe())
}
