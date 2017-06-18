import currencyWallets from '../currencyWallets/reducer.js'
import { reduxSource } from '../util/derive.js'
import { applyMiddleware, combineReducers, compose, createStore } from 'redux'
import thunk from 'redux-thunk'

export function makeRedux (onError) {
  function invoke (f) {
    try {
      const out = f()
      if (out != null && typeof out.then === 'function') {
        out.then(void 0, e => onError(e, '<change reaction>'))
      }
      return out
    } catch (e) {
      onError(e, '<change reaction>')
      throw e
    }
  }

  const reducer = combineReducers({
    currencyWallets
  })

  return createStore(
    reducer,
    void 0,
    compose(applyMiddleware(thunk), reduxSource(invoke))
  )
}
