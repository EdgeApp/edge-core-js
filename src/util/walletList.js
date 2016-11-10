var repoId = require('./repo.js').repoId

function walletType (walletJson) {
  return walletJson['type'] || 'wallet:repo:bitcoin:bip32'
}

function walletKeys (walletJson) {
  return walletJson['keys'] || {
    dataKey: walletJson['MK'],
    syncKey: walletJson['SyncKey'],
    bitcoinKey: walletJson['BitcoinSeed']
  }
}

function walletId (walletJson) {
  return repoId(new Buffer(walletKeys(walletJson)['dataKey'], 'hex'))
}

/**
 * An list of wallets stored in a repo.
 * Uses a write-through cache to avoid repeated encryption and decryption.
 */
function WalletList (repo, folder) {
  this.folder = folder || 'Wallets'
  this.repo = repo

  this.wallets = {}
  this.load()
}
exports.WalletList = WalletList

/**
 * Loads the list of wallets into the cache.
 */
WalletList.prototype.load = function () {
  var keys = this.repo.keys(this.folder)
  for (var i = 0; i < keys.length; ++i) {
    var walletJson = this.repo.getJson(this.folder + '/' + keys[i])
    this.wallets[walletId(walletJson)] = walletJson
  }
}

/**
 * Lists the wallets id's in the repo, sorted by index.
 */
WalletList.prototype.listIds = function () {
  // Load the ids and their sort indices:
  var ids = []
  var indices = {}
  for (var id in this.wallets) {
    if (this.wallets.hasOwnProperty(id)) {
      ids.push(id)
      indices[id] = this.wallets[id]['SortIndex']
    }
  }

  // Do the sort:
  return ids.sort(function (a, b) {
    return indices[a] < indices[b]
  })
}

/**
 * Returns the type of a particular wallet.
 */
WalletList.prototype.getType = function (id) {
  var walletJson = this.wallets[id]
  if (!walletJson) throw new Error('No such wallet ' + id)

  return walletType(walletJson)
}

/**
 * Obtains the keys JSON for a particular wallet.
 */
WalletList.prototype.getKeys = function (id) {
  var walletJson = this.wallets[id]
  if (!walletJson) throw new Error('No such wallet ' + id)

  return walletKeys(walletJson)
}

/**
 * Inserts a wallet into the list.
 * @param type: The data type for the wallet, like 'wallet:repo:bitcoin.bip32'
 * @param keys: A JSON object with arbitrary keys to the wallet.
 * This will typically include `dataKey`, `syncKey`,
 * and some type of crytpocurrency key.
 */
WalletList.prototype.addWallet = function (type, keysJson) {
  var walletJson = {
    'type': type,
    'keys': keysJson,
    'Archived': false,
    'SortIndex': 0
  }

  var dataKey = new Buffer(keysJson['dataKey'], 'hex')
  var filename = this.repo.secureFilename(dataKey)
  this.repo.setJson(this.folder + '/' + filename, walletJson)

  var id = walletId(walletJson)
  this.wallets[id] = walletJson
  return id
}
