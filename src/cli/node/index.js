// Command-line tools:
import chalk from 'chalk'
import Getopt from 'node-getopt'
import {LocalStorage} from 'node-localstorage'

// Airbitz context stuff:
import * as abc from '../../abc.js'
import * as realServer from './realServer.js'

// Commands:
import {command} from '../command.js'
import '../commands/all.js'

// Program options:
const getopt = new Getopt([
  ['k', 'api-key=ARG', 'Auth server API key'],
  ['a', 'account-type=ARG', 'Account type'],
  ['d', 'directory=ARG', 'Working directory'],
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
    // API key:
    let apiKey = options['api-key']
    if (!apiKey) {
      try {
        apiKey = require('./apiKey.js').apiKey
      } catch (e) {
        throw cmd.usageError('No API key')
      }
    }
    const fakeStorage = new LocalStorage(options['directory'] || './.cli')
    session.context = new abc.Context({
      accountType: options['account-type'],
      apiKey: apiKey,
      authRequest: realServer.makeAuthRequest(apiKey),
      localStorage: fakeStorage
    })
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
