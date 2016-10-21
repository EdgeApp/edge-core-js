var crypto = require('../crypto.js')

/**
 * Creates a blank repo on the sync server.
 */
function repoCreate (ctx, login, repoInfo, callback) {
  repoInfo.dataKey = repoInfo.dataKey || crypto.random(32).toString('hex')
  repoInfo.syncKey = repoInfo.syncKey || crypto.random(20).toString('hex')

  var request = {
    'l1': login.userId,
    'lp1': login.passwordAuth.toString('base64'),
    'repo_wallet_key': repoInfo.syncKey
  }

  ctx.authRequest('POST', '/v1/wallet/create', request, function (err, reply) {
    if (err) return callback(err)
    callback(null, repoInfo)
  })
}
exports.repoCreate = repoCreate

/**
 * Marks a repo as being used.
 * This should be called after the repo is securely attached
 * to the login or account.
 */
function repoActivate (ctx, login, repoInfo, callback) {
  var request = {
    'l1': login.userId,
    'lp1': login.passwordAuth.toString('base64'),
    'repo_wallet_key': repoInfo.syncKey
  }
  ctx.authRequest('POST', '/v1/wallet/activate', request, function (err, reply) {
    if (err) return callback(err)
    callback(null)
  })
}
exports.repoActivate = repoActivate
