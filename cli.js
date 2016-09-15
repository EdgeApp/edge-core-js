var commands = require('./cli-commands.js')

function commandList () {
  console.log('Available commands:')
  for (var command in commands) {
    if (commands.hasOwnProperty(command)) {
      console.log('  ' + command)
    }
  }
  process.exit(1)
}

// Set up the command-line options parser:
var getopt = require('node-getopt').create([
  ['a', 'account-type=ARG', 'Account type'],
  ['u', 'username=ARG', 'Username'],
  ['p', 'password=ARG', 'Password'],
  ['w', 'wallet=ARG', 'Wallet ID'],
  ['h', 'help', 'Display options']
]).bindHelp()

// Parse the options:
var opt = getopt.parseSystem()
if (opt.argv.length < 1) {
  getopt.showHelp()
  commandList()
}

// Run the command:
var command = commands[opt.argv[0]] || commandList
command(opt)
