import {abcc} from './ABCConditionCode.js'

/**
 * ABCError
 *
 * Error structure returned in all ABC callbacks
 *   code: ABCConditionCode
 *   message: Error message
 *   message2 (optional):
 *   message3 (optional):
 */

function errorMap (cc) {
  if (cc === abcc.ABCConditionCodeOk) return 'The function completed without an error'
  if (cc === abcc.ABCConditionCodeError) return 'An error occured'
  if (cc === abcc.ABCConditionCodeNULLPtr) return 'Unexpected NULL pointer'
  if (cc === abcc.ABCConditionCodeNoAvailAccountSpace) return 'Max number of accounts have been created'
  if (cc === abcc.ABCConditionCodeDirReadError) return 'Could not read directory'
  if (cc === abcc.ABCConditionCodeFileOpenError) return 'Could not open file'
  if (cc === abcc.ABCConditionCodeFileReadError) return 'Could not read from file'
  if (cc === abcc.ABCConditionCodeFileWriteError) return 'Could not write to file'
  if (cc === abcc.ABCConditionCodeFileDoesNotExist) return 'No such file'
  if (cc === abcc.ABCConditionCodeUnknownCryptoType) return 'Unknown crypto type'
  if (cc === abcc.ABCConditionCodeInvalidCryptoType) return 'Invalid crypto type'
  if (cc === abcc.ABCConditionCodeDecryptError) return 'Decryption error'
  if (cc === abcc.ABCConditionCodeDecryptFailure) return 'Decryption failure due to incorrect key'
  if (cc === abcc.ABCConditionCodeEncryptError) return 'Encryption error'
  if (cc === abcc.ABCConditionCodeScryptError) return 'Scrypt error'
  if (cc === abcc.ABCConditionCodeAccountAlreadyExists) return 'Account already exists'
  if (cc === abcc.ABCConditionCodeAccountDoesNotExist) return 'Account does not exist'
  if (cc === abcc.ABCConditionCodeJSONError) return 'JSON parsing error'
  if (cc === abcc.ABCConditionCodeBadPassword) return 'Incorrect password'
  if (cc === abcc.ABCConditionCodeWalletAlreadyExists) return 'Wallet already exists'
  if (cc === abcc.ABCConditionCodeURLError) return 'URL call failure'
  if (cc === abcc.ABCConditionCodeSysError) return 'An call to an external API failed'
  if (cc === abcc.ABCConditionCodeNotInitialized) return 'No required initialization made'
  if (cc === abcc.ABCConditionCodeReinitialization) return 'Initialization after already initializing'
  if (cc === abcc.ABCConditionCodeServerError) return 'Server error'
  if (cc === abcc.ABCConditionCodeNoRecoveryQuestions) return 'The user has not set recovery questions'
  if (cc === abcc.ABCConditionCodeNotSupported) return 'Functionality not supported'
  if (cc === abcc.ABCConditionCodeMutexError) return 'Mutex error if some type'
  if (cc === abcc.ABCConditionCodeNoTransaction) return 'Transaction not found'
  if (cc === abcc.ABCConditionCodeEmpty_Wallet) return 'Wallet is Empty'
  if (cc === abcc.ABCConditionCodeParseError) return 'Failed to parse input text'
  if (cc === abcc.ABCConditionCodeInvalidWalletID) return 'Invalid wallet ID'
  if (cc === abcc.ABCConditionCodeNoRequest) return 'Request (address) not found'
  if (cc === abcc.ABCConditionCodeInsufficientFunds) return 'Not enough money to send transaction'
  if (cc === abcc.ABCConditionCodeSynchronizing) return 'We are still sync-ing'
  if (cc === abcc.ABCConditionCodeNonNumericPin) return 'Problem with the PIN'
  if (cc === abcc.ABCConditionCodeNoAvailableAddress) return 'Unable to find an address'
  if (cc === abcc.ABCConditionCodeInvalidPinWait) return 'The user has entered a bad PIN, and must wait.'
  if (cc === abcc.ABCConditionCodePinExpired) return 'Server expired PIN. (Deprecated)'
  if (cc === abcc.ABCConditionCodeInvalidOTP) return 'Two Factor required'
  if (cc === abcc.ABCConditionCodeSpendDust) return 'Trying to send too little money.'
  if (cc === abcc.ABCConditionCodeObsolete) return 'The server says app is obsolete and needs to be upgraded.'
  return null
}

function ABCErrorObject (code, message) {
  this.code = code
  this.message = message
}

export function ABCError (code, message) {
  let conditionCode = 1
  let msg = null
  let json = null
  if (code === null) {
    return null
  } else if (typeof code.message === 'string') {
    try {
      json = JSON.parse(code.message)
      conditionCode = json.status_code
      msg = json.message
    } catch (e) {
      conditionCode = 1
      msg = message
    }
  } else if (typeof code === 'number') {
    conditionCode = code
  } else {
    conditionCode = 1
    msg = message
  }

  if (msg === null) {
    msg = errorMap(conditionCode)
  }

  if (msg === null) {
    msg = message
  }
  return new ABCErrorObject(conditionCode, msg)
  // return {'code': conditionCode, 'message': msg}
}
