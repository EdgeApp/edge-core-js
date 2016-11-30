import {command} from '../command.js'

command('wallet-list', {
  help: 'Lists the wallets in an account',
  needsAccount: true
}, function (session, argv) {
  if (argv.length !== 0) throw this.usageError()

  const ids = session.account.listWalletIds()
  for (let i of ids) {
    const wallet = session.account.getWallet(i)
    console.log(i + ' (' + wallet.type + ') = ' + JSON.stringify(wallet.repoKeys, null, 2))
  }
})
