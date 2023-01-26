/**
 * Compares two byte arrays without data-dependent branches.
 * Returns true if they match.
 */
export function verifyData(a: Uint8Array, b: Uint8Array): boolean {
  const length = a.length
  if (length !== b.length) return false

  let out = 0
  for (let i = 0; i < length; ++i) out |= a[i] ^ b[i]
  return out === 0
}
