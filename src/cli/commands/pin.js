import {command} from '../command.js'

command('pin-login', {
  usage: '<username> <pin>',
  help: 'Logs the user in with the device-specific PIN',
  needsContext: true
}, function (session, argv) {
  if (argv.length !== 2) throw this.usageError()
  const username = argv[0]
  const pin = argv[1]

  return session.context.loginWithPIN(username, pin).then(account => {
    session.account = account
    session.login = account.login
    return account
  })
})

command('pin-setup', {
  usage: '<pin>',
  help: 'Creates or changes the PIN for a device',
  needsLogin: true
}, function (session, argv) {
  if (argv.length !== 1) throw this.usageError()
  const pin = argv[0]

  return session.account.changePIN(pin)
})
