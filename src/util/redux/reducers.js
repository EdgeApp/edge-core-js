/**
 * Creates a reducer for managing a key/value collection.
 * @param {*} itemReducer The reducer to use on the individual items.
 * @param {*} ACTIONS An object with the strings to use for the
 * `ADD` and `UPDATE` actions.
 */
export function listReducer (itemReducer, ACTIONS = {}) {
  return function listReducer (state = {}, action) {
    const { type, payload } = action

    switch (type) {
      case ACTIONS.ADD: {
        const { id, initialState } = payload
        const out = { ...state }
        out[id] = itemReducer(initialState, { type: '' })
        return out
      }
      case ACTIONS.UPDATE: {
        const { id, action } = payload
        // Only update if the item exists:
        if (state[id] !== void 0) {
          const out = { ...state }
          out[id] = itemReducer(state[id], action)
          return out
        } else {
          return state
        }
      }
    }
    return state
  }
}
