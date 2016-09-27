var Context = require('./context.js').Context
var userMap = require('./userMap.js')
var abcc = require('./ABCConditionCode.js')
var abce = require('./ABCError.js')

exports.Context = Context
exports.usernameFix = userMap.normalize
exports.ABCConditionCode = abcc
exports.ABCError = abce.ABCError

/**
 * Creates a context object.
 */
exports.makeABCContext = function makeContext (opts) {
  return new Context(opts)
}
