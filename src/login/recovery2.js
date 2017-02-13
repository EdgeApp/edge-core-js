import * as crypto from '../crypto/crypto.js'
import * as userMap from '../userMap.js'
import {base58, base64, utf8} from '../util/encoding.js'
import {Login} from './login.js'

function recovery2Id (recovery2Key, username) {
  return crypto.hmacSha256(username, recovery2Key)
}

function recovery2Auth (recovery2Key, answers) {
  return answers.map(answer => {
    const data = utf8.parse(answer)
    return base64.stringify(crypto.hmacSha256(data, recovery2Key))
  })
}

/**
 * Returns a copy of the recovery key if one exists on the local device.
 */
export function getKey (io, username) {
  const loginData = io.loginStore.find({username})
  return loginData.recovery2Key
}

/**
 * Logs a user in using recovery answers.
 * @param username string
 * @param recovery2Key an ArrayBuffer recovery key
 * @param array of answer strings
 * @param `Login` object promise
 */
export function login (io, recovery2Key, username, answers) {
  recovery2Key = base58.parse(recovery2Key)
  username = userMap.normalize(username)

  const request = {
    'recovery2Id': base64.stringify(recovery2Id(recovery2Key, username)),
    'recovery2Auth': recovery2Auth(recovery2Key, answers)
    // "otp": null
  }
  return io.authRequest('POST', '/v2/login', request).then(reply => {
    // Recovery login:
    const recovery2Box = reply['recovery2Box']
    if (!recovery2Box) {
      throw new Error('Missing data for recovery v2 login')
    }

    // Decrypt the dataKey:
    const dataKey = crypto.decrypt(recovery2Box, recovery2Key)

    // Build the login object:
    return userMap.getUserId(io, username).then(userId => {
      return Login.online(io, username, userId, dataKey, reply)
    })
  })
}

/**
 * Fetches the questions for a login
 * @param username string
 * @param recovery2Key an ArrayBuffer recovery key
 * @param Question array promise
 */
export function questions (io, recovery2Key, username) {
  recovery2Key = base58.parse(recovery2Key)
  username = userMap.normalize(username)

  const request = {
    'recovery2Id': base64.stringify(recovery2Id(recovery2Key, username))
    // "otp": null
  }
  return io.authRequest('POST', '/v2/login', request).then(reply => {
    // Recovery login:
    const question2Box = reply['question2Box']
    if (!question2Box) {
      throw new Error('Login has no recovery questions')
    }

    // Decrypt the questions:
    const questions = crypto.decrypt(question2Box, recovery2Key)
    return JSON.parse(utf8.stringify(questions))
  })
}

/**
 * Creates the data needed to set up recovery questions on the account.
 */
export function makeSetup (io, login, questions, answers) {
  if (!(Object.prototype.toString.call(questions) === '[object Array]')) {
    throw new TypeError('Questions must be an array of strings')
  }
  if (!(Object.prototype.toString.call(answers) === '[object Array]')) {
    throw new TypeError('Answers must be an array of strings')
  }

  const recovery2Key = login.recovery2Key || io.random(32)

  const question2Box = crypto.encrypt(io, utf8.parse(JSON.stringify(questions), 'utf8'), recovery2Key)
  const recovery2Box = crypto.encrypt(io, login.dataKey, recovery2Key)
  const recovery2KeyBox = crypto.encrypt(io, recovery2Key, login.dataKey)

  return {
    server: {
      'recovery2Id': base64.stringify(recovery2Id(recovery2Key, login.username)),
      'recovery2Auth': recovery2Auth(recovery2Key, answers),
      'recovery2Box': recovery2Box,
      'recovery2KeyBox': recovery2KeyBox,
      'question2Box': question2Box
    },
    storage: {
      'recovery2Key': base58.stringify(recovery2Key)
    },
    recovery2Key
  }
}

/**
 * Sets up recovery questions for the login.
 */
export function setup (io, login, questions, answers) {
  const setup = makeSetup(io, login, questions, answers)

  const request = login.authJson()
  request['data'] = setup.server
  return io.authRequest('POST', '/v2/login/recovery2', request).then(reply => {
    io.loginStore.update(login.userId, setup.storage)
    return base58.stringify(setup.recovery2Key)
  })
}

export const listRecoveryQuestionChoices = function listRecoveryQuestionChoices (io) {
  return io.authRequest('POST', '/v1/questions', '')
}
