// @flow

// The information the server returns on every login:
export const loginReplyColumns = [
  // Identity:
  'appId',
  'loginAuthBox',
  'loginId',
  // Login methods:
  'otpResetDate',
  'otpTimeout',
  'passwordAuthBox',
  'passwordAuthSnrp',
  'passwordBox',
  'passwordKeySnrp',
  'pin2Box',
  'pin2KeyBox',
  'pin2TextBox',
  'question2Box',
  'recovery2Box',
  'recovery2KeyBox',
  // Resources:
  'keyBoxes',
  'mnemonicBox',
  'parentBox',
  'rootKeyBox',
  'syncKeyBox'
]

// The database includes extra columns used for authentication:
export const loginDbColumns = [
  ...loginReplyColumns,
  'loginAuth',
  'passwordAuth',
  'pin2Auth',
  'pin2Id',
  'recovery2Auth',
  'recovery2Id'
]

// The v2 account creation endpoint doesn't accept legacy keys:
export const loginCreateColumns: Array<string> = loginDbColumns.filter(
  item => ['mnemonicBox', 'rootKeyBox', 'syncKeyBox'].indexOf(item) < 0
)
