import * as crypto from '../crypto/crypto.js'
import {fixUsername} from '../io/loginStore.js'
import {base58, base64, utf8} from '../util/encoding.js'
import { loginOnline, makeAuthJson } from './login.js'

function recovery2Id (recovery2Key, username) {
  return crypto.hmacSha256(fixUsername(username), recovery2Key)
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
  const loginStash = io.loginStore.find({username})
  if (loginStash.recovery2Key != null) {
    return base58.parse(loginStash.recovery2Key)
  }
}

/**
 * Logs a user in using recovery answers.
 * @param username string
 * @param recovery2Key an ArrayBuffer recovery key
 * @param array of answer strings
 * @param `Login` object promise
 */
export function login (io, recovery2Key, username, answers) {
  const request = {
    'recovery2Id': base64.stringify(recovery2Id(recovery2Key, username)),
    'recovery2Auth': recovery2Auth(recovery2Key, answers)
    // "otp": null
  }
  return io.authRequest('POST', '/v2/login', request).then(reply => {
    // Recovery login:
    const recovery2Box = reply['recovery2Box']
    if (recovery2Box == null) {
      throw new Error('Missing data for recovery v2 login')
    }

    // Decrypt the loginKey:
    const loginKey = crypto.decrypt(recovery2Box, recovery2Key)

    // Build the login object:
    return io.loginStore.getUserId(username).then(userId => {
      return loginOnline(io, username, userId, loginKey, reply)
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
  const request = {
    'recovery2Id': base64.stringify(recovery2Id(recovery2Key, username))
    // "otp": null
  }
  return io.authRequest('POST', '/v2/login', request).then(reply => {
    // Recovery login:
    const question2Box = reply['question2Box']
    if (question2Box == null) {
      throw new Error('Login has no recovery questions')
    }

    // Decrypt the questions:
    const questions = crypto.decrypt(question2Box, recovery2Key)
    return JSON.parse(utf8.stringify(questions))
  })
}

/**
 * Creates the data needed to attach recovery questions to a login.
 */
export function makeRecovery2Kit (io, login, username, questions, answers) {
  if (!Array.isArray(questions)) {
    throw new TypeError('Questions must be an array of strings')
  }
  if (!Array.isArray(answers)) {
    throw new TypeError('Answers must be an array of strings')
  }

  const recovery2Key = login.recovery2Key || io.random(32)
  const question2Box = crypto.encrypt(
    io,
    utf8.parse(JSON.stringify(questions)),
    recovery2Key
  )
  const recovery2Box = crypto.encrypt(io, login.loginKey, recovery2Key)
  const recovery2KeyBox = crypto.encrypt(io, recovery2Key, login.loginKey)

  return {
    server: {
      recovery2Id: base64.stringify(recovery2Id(recovery2Key, username)),
      recovery2Auth: recovery2Auth(recovery2Key, answers),
      recovery2Box,
      recovery2KeyBox,
      question2Box
    },
    stash: {
      recovery2Key: base58.stringify(recovery2Key)
    },
    login: {
      recovery2Key
    }
  }
}

/**
 * Sets up recovery questions for the login.
 */
export function setup (io, login, questions, answers) {
  const kit = makeRecovery2Kit(io, login, login.username, questions, answers)

  const request = makeAuthJson(login)
  request.data = kit.server
  return io.authRequest('POST', '/v2/login/recovery2', request).then(reply => {
    io.loginStore.update(login.userId, kit.stash)
    login.recovery2Key = kit.login.recovery2Key
    return login
  })
}

export const listRecoveryQuestionChoices = function listRecoveryQuestionChoices (io) {
  return io.authRequest('POST', '/v1/questions', '')
}
