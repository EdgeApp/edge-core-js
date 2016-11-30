import {command} from '../command.js'

command('password-login', {
  usage: '<username> <password>',
  help: 'Logs the user in with a username and password',
  needsContext: true
}, function (session, argv) {
  if (argv.length !== 2) throw this.usageError()
  const username = argv[0]
  const password = argv[1]

  return new Promise((resolve, reject) => {
    session.context.loginWithPassword(username, password, null, {}, (err, account) => {
      if (err) return reject(err)
      session.account = account
      session.login = account.login
      resolve()
    })
  })
})

command('password-setup', {
  usage: '<password>',
  help: 'Creates or changes the password for a login',
  needsLogin: true
}, function (session, argv) {
  if (argv.length !== 1) throw this.usageError()
  const password = argv[0]

  return new Promise((resolve, reject) => {
    session.account.changePassword(password, (err) => {
      if (err) return reject(err)
      resolve()
    })
  })
})
