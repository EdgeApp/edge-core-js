// @flow

/**
 * Properties we want YAOB to hide from `console.log` or `JSON.stringify`.
 */
export const hideProperties: string[] = [
  'allKeys',
  'displayPrivateSeed',
  'displayPublicSeed',
  'keys',
  'otpKey',
  'loginKey',
  'publicWalletInfo',
  'recoveryKey'
]
