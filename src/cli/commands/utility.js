import { command, UsageError } from '../command.js'
import { makeLobby } from '../../login/lobby.js'

command(
  'auth-fetch',
  {
    usage: '[<method>] <path> [<post-body>]',
    help: 'Visits the selected URI on the auth server',
    needsContext: true
  },
  function (session, argv) {
    function parseArgs (argv) {
      switch (argv.length) {
        case 1:
          return ['GET', argv[0], {}]
        case 2:
          return ['POST', argv[0], JSON.parse(argv[1])]
        case 3:
          return [argv[0], argv[1], JSON.parse(argv[2])]
        default:
          throw new UsageError(this)
      }
    }

    return session.context.io
      .authRequest(...parseArgs(argv))
      .then(reply => console.log(JSON.stringify(reply, null, 2)))
  }
)

command(
  'lobby-create',
  {
    usage: '<request-json>',
    help: 'Puts the provided lobby request JSON on the auth server',
    needsContext: true
  },
  function (session, argv) {
    if (argv.length !== 1) throw new UsageError(this)
    const lobbyRequest = JSON.parse(argv[0])

    return makeLobby(session.context.io, lobbyRequest).then(lobby => {
      console.log('Created lobby ' + lobby.lobbyId)
      return new Promise((resolve, reject) => {
        const subscription = lobby.subscribe(
          reply => {
            console.log(JSON.stringify(reply, null, 2))
            subscription.unsubscribe()
            resolve(reply)
          },
          reject
        )
      })
    })
  }
)
