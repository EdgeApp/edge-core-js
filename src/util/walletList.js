import {repoId} from './repo.js'
import {base16} from './encoding.js'

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
  return repoId(base16.parse(walletKeys(walletJson)['dataKey']))
}

/**
 * An list of wallets stored in a repo.
 * Uses a write-through cache to avoid repeated encryption and decryption.
 */
export function WalletList (repo, folder) {
  this.folder = folder || 'Wallets'
  this.repo = repo

  this.wallets = {}
  this.load()
}

/**
 * Loads the list of wallets into the cache.
 */
WalletList.prototype.load = function () {
  for (const key of this.repo.keys(this.folder)) {
    const walletJson = this.repo.getJson(this.folder + '/' + key)
    this.wallets[walletId(walletJson)] = walletJson
  }
}

/**
 * Lists the wallets id's in the repo, sorted by index.
 */
WalletList.prototype.listIds = function () {
  // Load the ids and their sort indices:
  const ids = []
  const indices = {}
  for (const id in this.wallets) {
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
  const walletJson = this.wallets[id]
  if (!walletJson) throw new Error('No such wallet ' + id)

  return walletType(walletJson)
}

/**
 * Obtains the keys JSON for a particular wallet.
 */
WalletList.prototype.getKeys = function (id) {
  const walletJson = this.wallets[id]
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
  const walletJson = {
    'type': type,
    'keys': keysJson,
    'Archived': false,
    'SortIndex': 0
  }

  const dataKey = base16.parse(keysJson['dataKey'])
  const filename = this.repo.secureFilename(dataKey)
  this.repo.setJson(this.folder + '/' + filename, walletJson)

  const id = walletId(walletJson)
  this.wallets[id] = walletJson
  return id
}
