import * as crypto from '../crypto.js'

/**
 * Creates a blank repo on the sync server.
 */
export function repoCreate (ctx, login, keysJson, callback) {
  keysJson.dataKey = keysJson.dataKey || crypto.random(32).toString('hex')
  keysJson.syncKey = keysJson.syncKey || crypto.random(20).toString('hex')

  var request = {
    'l1': login.userId,
    'lp1': login.passwordAuth.toString('base64'),
    'repo_wallet_key': keysJson.syncKey
  }
  ctx.authRequest('POST', '/v1/wallet/create', request, function (err, reply) {
    if (err) return callback(err)
    callback(null, keysJson)
  })
}

/**
 * Marks a repo as being used.
 * This should be called after the repo is securely attached
 * to the login or account.
 */
export function repoActivate (ctx, login, keysJson, callback) {
  var request = {
    'l1': login.userId,
    'lp1': login.passwordAuth.toString('base64'),
    'repo_wallet_key': keysJson.syncKey
  }
  ctx.authRequest('POST', '/v1/wallet/activate', request, function (err, reply) {
    if (err) return callback(err)
    callback(null)
  })
}
