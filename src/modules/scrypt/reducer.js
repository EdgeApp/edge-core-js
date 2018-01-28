import { serialize } from '../../util/decorators.js'
import { base16, utf8 } from '../../util/encoding.js'

const getTime =
  typeof window !== 'undefined' &&
  window.performance &&
  typeof window.performance.now === 'function'
    ? () => window.performance.now()
    : () => Date.now()

function timeScrypt (scrypt, data, snrp, dklen = 32) {
  if (typeof data === 'string') {
    data = utf8.parse(data)
  }

  const salt = base16.parse(snrp.salt_hex)
  const startTime = getTime()
  console.info('starting scrypt n=' + snrp.n + ' r=' + snrp.r + ' p=' + snrp.p)
  return scrypt(data, salt, snrp.n, snrp.r, snrp.p, dklen).then(hash => {
    const time = getTime() - startTime
    console.info(
      'finished scrypt n=' +
        snrp.n +
        ' r=' +
        snrp.r +
        ' p=' +
        snrp.p +
        ` in ${time}ms`
    )
    return { hash, time }
  })
}

export default function scryptReducer (state = {}, action) {
  const { type, payload } = action

  if (type === 'INIT') {
    const { io } = payload

    return {
      timeScrypt: serialize((data, snrp, dklen) =>
        timeScrypt(io.scrypt, data, snrp, dklen)
      ),
      benchmark: null
    }
  }
  return state
}
