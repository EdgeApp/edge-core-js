// Airbitz context stuff:
import * as abc from '../../abc.js'

// Commands:
import {command} from '../command.js'
import '../commands/all.js'

// Command-line tools:
import chalk from 'chalk'
import fs from 'fs'
import Getopt from 'node-getopt'
import fetch from 'node-fetch'
import {LocalStorage} from 'node-localstorage'
import sourceMapSupport from 'source-map-support'
import xdgBasedir from 'xdg-basedir'

// Display the original source location for errors:
sourceMapSupport.install()

// Program options:
const getopt = new Getopt([
  ['k', 'api-key=ARG', 'Auth server API key'],
  ['a', 'account-type=ARG', 'Account type'],
  ['c', 'config=ARG', 'Configuration file'],
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
 * Loads the config file,
 * and returns its contents merged with the command-line options.
 */
function loadConfig (options) {
  let config = {}

  // Load the config file (if possible):
  if (options['config'] || xdgBasedir.config) {
    const path = options['config'] ||
      xdgBasedir.config + '/airbitz/airbitz.conf'
    try {
      config = JSON.parse(fs.readFileSync(path, 'utf8'))
    } catch (e) {
      if (options['config']) {
        const e = new Error(`Cannot load config file '${path}'`)
        e.quiet = true
        throw e
      }
    }
  }

  // Calculate the active settings:
  return {
    accountType: options['account-type'],
    apiKey: options['api-key'] || config['apiKey'],
    directory: options['directory'] || config['workingDir'],
    username: options['username'] || config['username'],
    password: options['password'] || config['password']
  }
}

/**
 * Sets up a session object with the Airbitz objects
 * needed by the command.
 * @return a promise
 */
function makeSession (config, cmd) {
  const session = {}
  let out = Promise.resolve(session)

  // Create a context if we need one:
  if (cmd.needsContext) {
    // API key:
    if (!config.apiKey) {
      throw cmd.usageError('No API key')
    }
    const fakeStorage = new LocalStorage(config.directory || './.cli')
    session.context = new abc.Context({
      accountType: config.accountType,
      apiKey: config.apiKey,
      fetch: fetch,
      localStorage: fakeStorage
    })
  }

  // Create a login if we need one:
  if (cmd.needsLogin) {
    out = out.then(session => {
      if (!config.username || !config.password) {
        throw cmd.usageError('No login credentials')
      }

      return session.context.loginWithPassword(config.username, config.password, null, {}).then(account => {
        session.account = account
        session.login = account.login
        return session
      })
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

  // Load the config file:
  const config = loadConfig(opt.options)

  // Set up the session:
  makeSession(config, cmd).then(session => {
    // Invoke the command:
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
