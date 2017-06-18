const ADD = 'airbitz-core-js/currencyWallet/ADD'
const UPDATE = 'airbitz-core-js/currencyWallet/UPDATE'
const SET_NAME = 'airbitz-core-js/currencyWallet/SET_NAME'

export function add (keyId, currencyWallet) {
  return { type: ADD, payload: { keyId, currencyWallet } }
}

export function update (keyId, action) {
  return { type: UPDATE, payload: { keyId, action } }
}

export function setName (keyId, name) {
  return update(keyId, { type: SET_NAME, payload: { name } })
}

/**
 * Wallet name reducer.
 */
function name (state = null, action) {
  const { type, payload } = action

  switch (type) {
    case SET_NAME: {
      const { name } = payload
      return name
    }
  }
  return state
}

/**
 * Individual wallet reducer.
 */
function currencyWallet (state, action) {
  return {
    ...state,
    name: name(state.name, action)
  }
}

/**
 * Wallet list reducer.
 */
export default function reducer (state = {}, action) {
  const { type, payload } = action

  switch (type) {
    case ADD: {
      const { keyId, currencyWallet } = payload
      const out = { ...state }
      out[keyId] = currencyWallet
      return out
    }
    case UPDATE: {
      const { keyId, action } = payload
      const out = { ...state }
      out[keyId] = currencyWallet(state[keyId], action)
      return out
    }
  }
  return state
}
