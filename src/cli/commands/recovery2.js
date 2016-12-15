import {command} from '../command.js'

command('recovery2-login', {
  usage: '<key> <username> <answers>...',
  help: 'Logs the user in with a recovery key and answers',
  needsContext: true
}, function (session, argv) {
  if (argv.length < 2) throw this.usageError()
  const key = argv[0]
  const username = argv[1]

  const answers = []
  for (let i = 2; i < argv.length; ++i) {
    answers.push(argv[i])
  }

  return session.context.loginWithRecovery2(key, username, answers, null, {}).then(account => {
    session.account = account
    session.login = account.login
    return account
  })
})

command('recovery2-setup', {
  usage: '[<question> <answer>]...',
  help: 'Creates or changes the recovery questions for a login',
  needsLogin: true
}, function (session, argv) {
  if (argv.length % 2) throw this.usageError()

  const questions = []
  const answers = []
  for (let i = 0; i < argv.length; i += 2) {
    questions.push(argv[i])
    answers.push(argv[i + 1])
  }

  return session.account.recovery2Set(questions, answers).then(key => {
    console.log('Recovery key: ' + key)
    return key
  })
})
