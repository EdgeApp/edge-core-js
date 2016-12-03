import * as crypto from '../crypto.js'

/**
 * Creates a blank repo on the sync server.
 */
export function repoCreate (ctx, login, keysJson) {
  keysJson.dataKey = keysJson.dataKey || crypto.random(32).toString('hex')
  keysJson.syncKey = keysJson.syncKey || crypto.random(20).toString('hex')

  const request = {
    'l1': login.userId,
    'lp1': login.passwordAuth.toString('base64'),
    'repo_wallet_key': keysJson.syncKey
  }
  return ctx.authRequest('POST', '/v1/wallet/create', request).then(reply => keysJson)
}

/**
 * Marks a repo as being used.
 * This should be called after the repo is securely attached
 * to the login or account.
 */
export function repoActivate (ctx, login, keysJson) {
  const request = {
    'l1': login.userId,
    'lp1': login.passwordAuth.toString('base64'),
    'repo_wallet_key': keysJson.syncKey
  }
  return ctx.authRequest('POST', '/v1/wallet/activate', request).then(reply => null)
}
