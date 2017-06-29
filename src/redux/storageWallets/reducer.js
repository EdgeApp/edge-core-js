const ADD = 'airbitz-core-js/storageWallet/ADD'
const UPDATE = 'airbitz-core-js/storageWallet/UPDATE'
const SET_STATUS = 'airbitz-core-js/storageWallet/SET_STATUS'

export function add (keyId, initialState) {
  return { type: ADD, payload: { keyId, initialState } }
}

export function update (keyId, action) {
  return { type: UPDATE, payload: { keyId, action } }
}

export function setStatus (keyId, status) {
  return update(keyId, { type: SET_STATUS, payload: status })
}

/**
 * Wallet status reducer.
 */
function status (state = {}, action) {
  return action.type === SET_STATUS ? action.payload : state
}

/**
 * Individual wallet reducer.
 */
function storageWallet (state, action) {
  return {
    ...state,
    status: status(state.epoch, action)
  }
}

/**
 * Wallet list reducer.
 */
export default function storageWallets (state = {}, action) {
  const { type, payload } = action

  switch (type) {
    case ADD: {
      const { keyId, initialState } = payload
      const out = { ...state }
      out[keyId] = storageWallet(initialState, { type: 'setup' })
      return out
    }
    case UPDATE: {
      const { keyId, action } = payload
      if (state[keyId] != null) {
        // Only update if the wallet exists:
        const out = { ...state }
        out[keyId] = storageWallet(state[keyId], action)
        return out
      } else {
        return state
      }
    }
  }
  return state
}
