import { command, UsageError } from '../command.js'

command(
  'edge-login',
  {
    usage: '',
    help: 'Requests an edge login',
    needsContext: true
  },
  function (session, argv) {
    if (argv.length !== 0) throw new UsageError(this)

    return new Promise((resolve, reject) => {
      const opts = {
        onLogin (err, account) {
          if (err) return reject(err)
          session.account = account
          session.login = account.login
          return resolve(account)
        }
      }

      return session.context.requestEdgeLogin(opts).then(pending => {
        console.log(`airbitz://edge/${pending.id}`)
      })
    })
  }
)
