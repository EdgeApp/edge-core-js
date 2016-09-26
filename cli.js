// Airbitz context stuff:
const abc = require('./src/abc.js')
var realServer = require('./cli/realServer.js')

// Command-line tools:
const chalk = require('chalk')
const Getopt = require('node-getopt')
const LocalStorage = require('node-localstorage').LocalStorage

// Commands:
const command = require('./cli/command.js')
require('./cli/commands/login.js')
require('./cli/commands/password.js')
require('./cli/commands/pin.js')
require('./cli/commands/recovery2.js')

// Program options:
const getopt = new Getopt([
  ['a', 'account-type=ARG', 'Account type'],
  ['u', 'username=ARG', 'Username'],
  ['p', 'password=ARG', 'Password'],
  ['w', 'wallet=ARG', 'Wallet ID'],
  ['h', 'help', 'Display options']
])

const helpCommand = command('help', {
  usage: '[command]',
  help: 'Displays help for any command'
}, function (session, argv) {
  if (argv.length > 1) throw this.usageError('Too many parameters')

  if (argv.length) {
    // Command help:
    const cmd = command.find(argv[0])
    console.log('Usage: ' + cmd.usage)
    if (cmd.help) {
      console.log(cmd.help)
    }
  } else {
    // Program help:
    getopt.showHelp()
    command.showList()
  }
})

/**
 * Sets up a session object with the Airbitz objects
 * needed by the command.
 * @return a promise
 */
function makeSession (options, cmd) {
  const session = {}
  let out = Promise.resolve(session)

  // Create a context if we need one:
  if (cmd.needsContext) {
    const fakeStorage = new LocalStorage('./.cli')
    session.context = new abc.Context(realServer.authRequest, fakeStorage, options['account-type'])
  }

  // Create a login if we need one:
  if (cmd.needsLogin) {
    out = out.then(session => {
      if (options['username'] && options['password']) {
        return new Promise((resolve, reject) => {
          session.context.loginWithPassword(options['username'], options['password'], null, {}, (err, account) => {
            if (err) return reject(err)
            session.account = account
            session.login = account.login
            resolve(session)
          })
        })
      } else {
        throw cmd.usageError('No login credentials')
      }
    })
  }

  return out
}

/**
 * Sends an error object to stderr.
 */
function reportError (e) {
  if (e.quiet) {
    console.error(chalk.red(e.message))
    if (e.hint) {
      console.error(e.hint)
    }
  } else {
    console.error(chalk.red('Unhandled exception'))
    console.error(e)
  }
}

/**
 * Parses the options and invokes the requested command.
 */
function main () {
  const opt = getopt.parseSystem()

  // Look up the command:
  const cmd = (opt.options['help'] || !opt.argv.length)
    ? helpCommand
    : command.find(opt.argv.shift())

  // Set up the session:
  const session = makeSession(opt.options, cmd)

  // Invoke the command:
  session.then(session => {
    return cmd.invoke(session, opt.argv)
  }).catch(e => {
    reportError(e)
  })
}

// Invoke the main function, with error reporting:
try {
  main()
} catch (e) {
  reportError(e)
}
