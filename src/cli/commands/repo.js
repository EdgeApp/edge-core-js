import {base16} from '../../util/encoding.js'
import {Repo} from '../../util/repo.js'
import {command, UsageError} from '../command.js'

command('repo-sync', {
  usage: '<sync-key> <data-key>',
  help: 'Fetches the contents of a sync repo',
  needsContext: true
}, function (session, argv) {
  if (argv.length !== 2) throw new UsageError(this)
  const syncKey = base16.parse(argv[0])
  const dataKey = base16.parse(argv[1])

  const store = new Repo(session.context.io, dataKey, syncKey)
  return store.sync().then(changed => {
    console.log(changed ? 'changed' : 'unchanged')
    return changed
  })
})

command('repo-list', {
  usage: '<sync-key> <data-key> [<path>]',
  help: 'Shows the contents of a sync repo folder',
  needsContext: true
}, function (session, argv) {
  if (argv.length < 2 || argv.length > 3) throw new UsageError(this)
  const syncKey = base16.parse(argv[0])
  const dataKey = base16.parse(argv[1])
  const path = argv.length === 3 ? argv[2] : ''

  const store = new Repo(session.context.io, dataKey, syncKey)
  console.log(store.keys(path))
})

command('repo-set', {
  usage: '<sync-key> <data-key> <path> <value>',
  help: 'Writes a file to the sync repo',
  needsContext: true
}, function (session, argv) {
  if (argv.length !== 4) throw new UsageError(this)
  const syncKey = base16.parse(argv[0])
  const dataKey = base16.parse(argv[1])
  const path = argv[2]
  const value = argv[3]

  const store = new Repo(session.context.io, dataKey, syncKey)
  store.setText(path, value)
})

command('repo-get', {
  usage: '<sync-key> <data-key> <path>',
  help: 'Reads a file from the sync repo',
  needsContext: true
}, function (session, argv) {
  if (argv.length !== 3) throw new UsageError(this)
  const syncKey = base16.parse(argv[0])
  const dataKey = base16.parse(argv[1])
  const path = argv[2]

  const store = new Repo(session.context.io, dataKey, syncKey)
  const value = store.getText(path)
  console.log(value)
})
