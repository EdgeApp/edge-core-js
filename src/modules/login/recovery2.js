// @flow

import { decrypt, encrypt, hmacSha256 } from '../../util/crypto/crypto.js'
import { fixOtpKey, totp } from '../../util/crypto/hotp.js'
import { base64, utf8 } from '../../util/encoding.js'
import type { ApiInput } from '../root.js'
import { authRequest } from './authServer.js'
import type { LoginStash, LoginTree } from './login-types.js'
import { applyLoginReply, makeLoginTree } from './login.js'
import { fixUsername } from './loginStore.js'

function recovery2Id (recovery2Key: Uint8Array, username: string) {
  const data = utf8.parse(fixUsername(username))
  return hmacSha256(data, recovery2Key)
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
async function fetchLoginKey (
  ai: ApiInput,
  recovery2Key: Uint8Array,
  username: string,
  answers: Array<string>,
  otp: string | void
) {
  const request = {
    recovery2Id: base64.stringify(recovery2Id(recovery2Key, username)),
    recovery2Auth: recovery2Auth(recovery2Key, answers),
    otp
  }
  const reply = await authRequest(ai, 'POST', '/v2/login', request)
  if (reply.recovery2Box == null) {
    throw new Error('Missing data for recovery v2 login')
  }
  return {
    loginKey: decrypt(reply.recovery2Box, recovery2Key),
    loginReply: reply
  }
}

/**
 * Returns a copy of the recovery key if one exists on the local device.
 */
export function getRecovery2Key (stashTree: LoginStash) {
  if (stashTree.recovery2Key != null) {
    return base64.parse(stashTree.recovery2Key)
  }
}

/**
 * Logs a user in using recovery answers.
 * @return A `Promise` for the new root login.
 */
export async function loginRecovery2 (
  ai: ApiInput,
  recovery2Key: Uint8Array,
  username: string,
  answers: Array<string>,
  otpKey: string | void
) {
  const { loginStore } = ai.props
  let stashTree = await loginStore.load(username)
  const { loginKey, loginReply } = await fetchLoginKey(
    ai,
    recovery2Key,
    username,
    answers,
    totp(otpKey || stashTree.otpKey)
  )
  stashTree = applyLoginReply(stashTree, loginKey, loginReply)
  if (otpKey) stashTree.otpKey = fixOtpKey(otpKey)
  loginStore.save(stashTree)
  return makeLoginTree(stashTree, loginKey)
}

/**
 * Fetches the questions for a login
 * @param username string
 * @param recovery2Key an ArrayBuffer recovery key
 * @param Question array promise
 */
export function getQuestions2 (
  ai: ApiInput,
  recovery2Key: Uint8Array,
  username: string
) {
  const request = {
    recovery2Id: base64.stringify(recovery2Id(recovery2Key, username))
    // "otp": null
  }
  return authRequest(ai, 'POST', '/v2/login', request).then(reply => {
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
export function makeRecovery2Kit (
  ai: ApiInput,
  login: LoginTree,
  username: string,
  questions: Array<string>,
  answers: Array<string>
) {
  const { io } = ai.props
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
  ai: ApiInput
) {
  return authRequest(ai, 'POST', '/v1/questions', {})
}
