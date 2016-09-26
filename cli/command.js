var commands = []

/**
 * Creates a new `Error` object with a true `quiet` property.
 * The main loop can avoid showing stack traces for errors like these.
 */
function quietError (message) {
  const out = new Error(message)
  out.quiet = true
  return out
}

/**
 * Creates an error indicating a problem
 */
function usageError (message) {
  const out = new Error(message || 'Incorrect arguments')
  out.quiet = true
  out.hint = 'Usage: ' + this.usage
  return out
}

/**
 * Creates a new command, and adds it to the global command registry.
 */
function command (name, opts, body) {
  const cmd = {
    name: name,
    invoke: body,
    usageError: usageError
  }

  // Expand the needs flags:
  cmd.needsWallet = opts.needsWallet
  cmd.needsAccount = opts.needsAccount | cmd.needsWallet
  cmd.needsLogin = opts.needsLogin | cmd.needsAccount
  cmd.needsContext = opts.needsContext | cmd.needsLogin

  // Set up the help options:
  let usage = name
  if (cmd.needsLogin) {
    usage += ' -u <username> -p <password>'
  }
  if (opts.usage) {
    usage += ' ' + opts.usage
  }
  cmd.usage = usage
  cmd.help = opts.help

  commands[name] = cmd
  return cmd
}

/**
 * Finds the command with the given name.
 */
command.find = function (name) {
  const cmd = commands[name]
  if (!cmd) throw quietError('No command named "' + name + '"')
  return cmd
}

/**
 * Returns a list of all available commands.
 */
command.showList = function () {
  console.log('Available commands:')
  for (let name in commands) {
    if (commands.hasOwnProperty(name)) {
      const cmd = commands[name]
      let line = '  ' + name
      if (cmd.help) {
        line += '\t- ' + cmd.help
      }
      console.log(line)
    }
  }
}

module.exports = command
