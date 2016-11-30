import {command} from '../command.js'
import {Repo} from '../../src/util/repo.js'

command('repo-sync', {
  usage: '<sync-key> <data-key>',
  help: 'Fetches the contents of a sync repo',
  needsContext: true
}, function (session, argv) {
  if (argv.length !== 2) throw this.usageError()
  const syncKey = new Buffer(argv[0], 'hex')
  const dataKey = new Buffer(argv[1], 'hex')

  return new Promise((resolve, reject) => {
    const store = new Repo(session.context, dataKey, syncKey)
    store.sync(function (err, changed) {
      if (err) return reject(err)
      console.log(changed ? 'changed' : 'unchanged')
      resolve(changed)
    })
  })
})

command('repo-list', {
  usage: '<sync-key> <data-key> [<path>]',
  help: 'Shows the contents of a sync repo folder',
  needsContext: true
}, function (session, argv) {
  if (argv.length < 2 || argv.length > 3) throw this.usageError()
  const syncKey = new Buffer(argv[0], 'hex')
  const dataKey = new Buffer(argv[1], 'hex')
  const path = argv.length === 3 ? argv[2] : ''

  const store = new Repo(session.context, dataKey, syncKey)
  console.log(store.keys(path))
})

command('repo-set', {
  usage: '<sync-key> <data-key> <path> <value>',
  help: 'Writes a file to the sync repo',
  needsContext: true
}, function (session, argv) {
  if (argv.length !== 4) throw this.usageError()
  const syncKey = new Buffer(argv[0], 'hex')
  const dataKey = new Buffer(argv[1], 'hex')
  const path = argv[2]
  const value = new Buffer(argv[3], 'utf-8')

  const store = new Repo(session.context, dataKey, syncKey)
  store.setData(path, value)
})

command('repo-get', {
  usage: '<sync-key> <data-key> <path>',
  help: 'Reads a file from the sync repo',
  needsContext: true
}, function (session, argv) {
  if (argv.length !== 3) throw this.usageError()
  const syncKey = new Buffer(argv[0], 'hex')
  const dataKey = new Buffer(argv[1], 'hex')
  const path = argv[2]

  const store = new Repo(session.context, dataKey, syncKey)
  const value = store.getData(path)
  console.log(value ? value.toString('utf-8') : value)
})
