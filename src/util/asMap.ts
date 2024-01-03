import { asCodec, asObject, Cleaner } from 'cleaners'

/**
 * Reads a JSON-style object into a JavaScript `Map` object with string keys.
 */
export function asMap<T>(cleaner: Cleaner<T>): Cleaner<Map<string, T>> {
  const asJsonObject = asObject(cleaner)

  return asCodec(
    raw => {
      const clean = asJsonObject(raw)
      const out = new Map<string, T>()
      for (const key of Object.keys(clean)) out.set(key, clean[key])
      return out
    },
    clean => {
      const out: { [key: string]: T } = {}
      clean.forEach((value, key) => {
        out[key] = value
      })
      return asJsonObject(out)
    }
  )
}
