/**
 * ABCConditionCode
 * Error codes for ABCError object
 */

var abcc = {}

abcc.ABCConditionCodeOk = 0
abcc.ABCConditionCodeError = 1
abcc.ABCConditionCodeNULLPtr = 2
abcc.ABCConditionCodeNoAvailAccountSpace = 3
abcc.ABCConditionCodeDirReadError = 4
abcc.ABCConditionCodeFileOpenError = 5
abcc.ABCConditionCodeFileReadError = 6
abcc.ABCConditionCodeFileWriteError = 7
abcc.ABCConditionCodeFileDoesNotExist = 8
abcc.ABCConditionCodeUnknownCryptoType = 9
abcc.ABCConditionCodeInvalidCryptoType = 10
abcc.ABCConditionCodeDecryptError = 11
abcc.ABCConditionCodeDecryptFailure = 12
abcc.ABCConditionCodeEncryptError = 13
abcc.ABCConditionCodeScryptError = 14
abcc.ABCConditionCodeAccountAlreadyExists = 15
abcc.ABCConditionCodeAccountDoesNotExist = 16
abcc.ABCConditionCodeJSONError = 17
abcc.ABCConditionCodeBadPassword = 18
abcc.ABCConditionCodeWalletAlreadyExists = 19
abcc.ABCConditionCodeURLError = 20
abcc.ABCConditionCodeSysError = 21
abcc.ABCConditionCodeNotInitialized = 22
abcc.ABCConditionCodeReinitialization = 23
abcc.ABCConditionCodeServerError = 24
abcc.ABCConditionCodeNoRecoveryQuestions = 25
abcc.ABCConditionCodeNotSupported = 26
abcc.ABCConditionCodeMutexError = 27
abcc.ABCConditionCodeNoTransaction = 28
abcc.ABCConditionCodeEmpty_Wallet = 28
abcc.ABCConditionCodeParseError = 29
abcc.ABCConditionCodeInvalidWalletID = 30
abcc.ABCConditionCodeNoRequest = 31
abcc.ABCConditionCodeInsufficientFunds = 32
abcc.ABCConditionCodeSynchronizing = 33
abcc.ABCConditionCodeNonNumericPin = 34
abcc.ABCConditionCodeNoAvailableAddress = 35
abcc.ABCConditionCodeInvalidPinWait = 36
abcc.ABCConditionCodePinExpired = 36
abcc.ABCConditionCodeInvalidOTP = 37
abcc.ABCConditionCodeSpendDust = 38
abcc.ABCConditionCodeObsolete = 1000

exports = abcc
