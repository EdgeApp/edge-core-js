const commands = []

/**
 * Creates an error indicating a problem with the command-line arguments.
 * @param command The command that was invoked. Can be null.
 */
export function UsageError (command, message) {
  const e = new Error(message || 'Incorrect arguments')
  e.type = UsageError.name
  e.command = command
  return e
}
UsageError.type = UsageError.name

/**
 * Creates a new command, and adds it to the global command registry.
 */
export function command (name, opts, body) {
  const cmd = {
    name: name,
    invoke: body
  }

  // Expand the needs flags:
  cmd.needsWallet = opts.needsWallet
  cmd.needsAccount = opts.needsAccount | cmd.needsWallet
  cmd.needsLogin = opts.needsLogin | cmd.needsAccount
  cmd.needsContext = opts.needsContext | cmd.needsLogin

  // Set up the help options:
  let usage = name
  if (cmd.needsContext) {
    usage += ' [-k <api-key>] [-d <work-dir>]'
  }
  if (cmd.needsLogin) {
    usage += ' -u <username> -p <password>'
  }
  if (opts.usage != null) {
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
  if (cmd == null) throw new UsageError(null, `No command named "${name}"`)
  return cmd
}

/**
 * Returns a list of all available commands.
 */
command.showList = function () {
  console.log('Available commands:')
  Object.keys(commands).forEach(name => {
    const cmd = commands[name]
    let line = '  ' + name
    if (cmd.help != null) {
      line += '\t- ' + cmd.help
    }
    console.log(line)
  })
}
