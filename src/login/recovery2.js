import { decrypt, encrypt, hmacSha256 } from '../crypto/crypto.js'
import { fixUsername } from '../io/loginStore.js'
import { base64, utf8 } from '../util/encoding.js'
import { applyLoginReply, makeLoginTree } from './login.js'

function recovery2Id (recovery2Key, username) {
  return hmacSha256(fixUsername(username), recovery2Key)
}

function recovery2Auth (recovery2Key, answers) {
  return answers.map(answer => {
    const data = utf8.parse(answer)
    return base64.stringify(hmacSha256(data, recovery2Key))
  })
}

/**
 * Fetches and decrypts the loginKey from the server.
 * @return Promise<{loginKey, loginReply}>
 */
function fetchLoginKey (io, recovery2Key, username, answers) {
  const request = {
    recovery2Id: base64.stringify(recovery2Id(recovery2Key, username)),
    recovery2Auth: recovery2Auth(recovery2Key, answers)
    // "otp": null
  }
  return io.authRequest('POST', '/v2/login', request).then(reply => {
    if (reply.recovery2Box == null) {
      throw new Error('Missing data for recovery v2 login')
    }
    return {
      loginKey: decrypt(reply.recovery2Box, recovery2Key),
      loginReply: reply
    }
  })
}

/**
 * Returns a copy of the recovery key if one exists on the local device.
 */
export function getRecovery2Key (stashTree) {
  if (stashTree.recovery2Key != null) {
    return base64.parse(stashTree.recovery2Key)
  }
}

/**
 * Logs a user in using recovery answers.
 * @return A `Promise` for the new root login.
 */
export function loginRecovery2 (io, recovery2Key, username, answers) {
  return io.loginStore.load(username).then(stashTree => {
    return fetchLoginKey(io, recovery2Key, username, answers).then(values => {
      const { loginKey, loginReply } = values
      stashTree = applyLoginReply(stashTree, loginKey, loginReply)
      io.loginStore.save(stashTree)
      return makeLoginTree(stashTree, loginKey)
    })
  })
}

/**
 * Fetches the questions for a login
 * @param username string
 * @param recovery2Key an ArrayBuffer recovery key
 * @param Question array promise
 */
export function getQuestions2 (io, recovery2Key, username) {
  const request = {
    recovery2Id: base64.stringify(recovery2Id(recovery2Key, username))
    // "otp": null
  }
  return io.authRequest('POST', '/v2/login', request).then(reply => {
    // Recovery login:
    const question2Box = reply.question2Box
    if (question2Box == null) {
      throw new Error('Login has no recovery questions')
    }

    // Decrypt the questions:
    const questions = decrypt(question2Box, recovery2Key)
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
  const question2Box = encrypt(
    io,
    utf8.parse(JSON.stringify(questions)),
    recovery2Key
  )
  const recovery2Box = encrypt(io, login.loginKey, recovery2Key)
  const recovery2KeyBox = encrypt(io, recovery2Key, login.loginKey)

  return {
    serverPath: '/v2/login/recovery2',
    server: {
      recovery2Id: base64.stringify(recovery2Id(recovery2Key, username)),
      recovery2Auth: recovery2Auth(recovery2Key, answers),
      recovery2Box,
      recovery2KeyBox,
      question2Box
    },
    stash: {
      recovery2Key: base64.stringify(recovery2Key)
    },
    login: {
      recovery2Key
    },
    loginId: login.loginId
  }
}

export const listRecoveryQuestionChoices = function listRecoveryQuestionChoices (
  io
) {
  return io.authRequest('POST', '/v1/questions', '')
}
