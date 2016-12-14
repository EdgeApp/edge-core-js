import {command} from '../command.js'

command('account-remove', {
  usage: '<username>',
  help: 'Removes any locally-stored data for the given username',
  needsContext: true
}, function (session, argv) {
  if (argv.length !== 1) throw this.usageError()
  const username = argv[0]

  return session.context.removeUsername(username)
})

command('account-available', {
  usage: '<username>',
  help: 'Determines whether or not a username is available',
  needsContext: true
}, function (session, argv) {
  if (argv.length !== 1) throw this.usageError()
  const username = argv[0]

  return new Promise((resolve, reject) => {
    session.context.usernameAvailable(username, (err, account) => {
      console.log(err ? 'Not available' : 'Available')
      resolve()
    })
  })
})

command('account-create', {
  usage: '<username> <password> <pin>',
  help: 'Create a login on the auth server',
  needsContext: true
}, function (session, argv) {
  if (argv.length !== 3) throw this.usageError()
  const username = argv[0]
  const password = argv[1]
  const pin = argv[2]

  return new Promise((resolve, reject) => {
    session.context.createAccount(username, password, pin, (err, account) => {
      if (err) return reject(err)
      session.account = account
      session.login = account.login
      resolve()
    })
  })
})
