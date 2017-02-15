import {Context} from './context.js'
import {elliptic, hashjs} from './crypto/external.js'
import {IoContext, makeBrowserIo} from './io/io.js'

export {Context}
export {abcc as ABCConditionCode} from './ABCConditionCode.js'
export {ABCError} from './ABCError.js'
export {fixUsername as usernameFix} from './io/loginStore.js'

/**
 * Creates a pseudo-random number generator based on the provided entropy.
 * This can be used to turn an async random number generator into
 * a synchronous one.
 */
export function makeRandomGenerator (entropy) {
  const HmacDRBG = elliptic.hmacDRBG
  const rng = new HmacDRBG({
    hash: hashjs.sha256,
    entropy: entropy
  })

  return bytes => rng.generate(bytes)
}

/**
 * Creates a context object.
 */
export function makeContext (opts = {}) {
  const io = new IoContext(makeBrowserIo(), opts)
  return new Context(io, opts)
}

// Another name for the same thing:
export {makeContext as makeABCContext}
