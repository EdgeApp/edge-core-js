import { command, UsageError } from '../command.js'

command(
  'auth-fetch',
  {
    usage: '<path> [<post-body>]',
    help: 'Visits the selected URI on the auth server',
    needsContext: true
  },
  function (session, argv) {
    if (argv.length < 1 || argv.length > 2) throw new UsageError(this)
    const path = argv[0]
    const body = argv[1]

    const method = body == null ? 'GET' : 'POST'
    const request = body == null ? {} : JSON.parse(body)

    return session.context.io
      .authRequest(method, path, request)
      .then(reply => console.log(JSON.stringify(reply, null, 2)))
  }
)
