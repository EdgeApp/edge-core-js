import { command, UsageError } from '../command.js'

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
