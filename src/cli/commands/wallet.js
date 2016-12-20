import {command} from '../command.js'

command('wallet-list', {
  help: 'Lists the wallets in an account',
  needsAccount: true
}, function (session, argv) {
  if (argv.length !== 0) throw this.usageError()

  const ids = session.account.listWalletIds()
  for (const id of ids) {
    const wallet = session.account.getWallet(id)
    console.log(`id (${wallet.type}) = ${JSON.stringify(wallet.repoKeys, null, 2)}`)
  }
})
