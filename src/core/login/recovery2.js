// @flow

import { base64 } from 'rfc4648'

import {
  asQuestionChoicesPayload,
  asStartRecoveryPayload
} from '../../types/server-cleaners.js'
import { type EdgeAccountOptions } from '../../types/types.js'
import { decrypt, decryptText, encrypt } from '../../util/crypto/crypto.js'
import { hmacSha256 } from '../../util/crypto/hashes.js'
import { utf8 } from '../../util/encoding.js'
import { type ApiInput } from '../root-pixie.js'
import { applyKit, serverLogin } from './login.js'
import { loginFetch } from './login-fetch.js'
import { fixUsername, getStash } from './login-selectors.js'
import { type LoginStash } from './login-stash.js'
import { type LoginKit, type LoginTree } from './login-types.js'

function recovery2Id(recovery2Key: Uint8Array, username: string): Uint8Array {
  const data = utf8.parse(fixUsername(username))
  return hmacSha256(data, recovery2Key)
}

function recovery2Auth(recovery2Key: Uint8Array, answers: string[]): string[] {
  return answers.map(answer => {
    const data = utf8.parse(answer)
    return base64.stringify(hmacSha256(data, recovery2Key))
  })
}

/**
 * Returns a copy of the recovery key if one exists on the local device.
 */
export function getRecovery2Key(stashTree: LoginStash): Uint8Array | void {
  if (stashTree.recovery2Key != null) {
    return base64.parse(stashTree.recovery2Key)
  }
}

/**
 * Logs a user in using recovery answers.
 * @return A `Promise` for the new root login.
 */
export async function loginRecovery2(
  ai: ApiInput,
  recovery2Key: Uint8Array,
  username: string,
  answers: string[],
  opts: EdgeAccountOptions
): Promise<LoginTree> {
  const stashTree = getStash(ai, username)

  // Request:
  const request = {
    recovery2Id: base64.stringify(recovery2Id(recovery2Key, username)),
    recovery2Auth: recovery2Auth(recovery2Key, answers)
  }
  return serverLogin(ai, stashTree, stashTree, opts, request, async reply => {
    if (reply.recovery2Box == null) {
      throw new Error('Missing data for recovery v2 login')
    }
    return decrypt(reply.recovery2Box, recovery2Key)
  })
}

/**
 * Fetches the questions for a login
 * @param username string
 * @param recovery2Key an ArrayBuffer recovery key
 * @param Question array promise
 */
export function getQuestions2(
  ai: ApiInput,
  recovery2Key: Uint8Array,
  username: string
): Promise<string[]> {
  const request = {
    recovery2Id: base64.stringify(recovery2Id(recovery2Key, username))
    // "otp": null
  }
  return loginFetch(ai, 'POST', '/v2/login', request).then(reply => {
    const { question2Box } = asStartRecoveryPayload(reply)
    if (question2Box == null) {
      throw new Error('Login has no recovery questions')
    }

    // Decrypt the questions:
    return JSON.parse(decryptText(question2Box, recovery2Key))
  })
}

export async function changeRecovery(
  ai: ApiInput,
  accountId: string,
  questions: string[],
  answers: string[]
): Promise<void> {
  const { loginTree, username } = ai.props.state.accounts[accountId]

  const kit = makeRecovery2Kit(ai, loginTree, username, questions, answers)
  await applyKit(ai, loginTree, kit)
}

export async function deleteRecovery(
  ai: ApiInput,
  accountId: string
): Promise<void> {
  const { loginTree } = ai.props.state.accounts[accountId]

  const kit = {
    serverMethod: 'DELETE',
    serverPath: '/v2/login/recovery2',
    stash: {
      recovery2Key: undefined
    },
    login: {
      recovery2Key: undefined
    },
    loginId: loginTree.loginId
  }
  await applyKit(ai, loginTree, kit)
}

/**
 * Creates the data needed to attach recovery questions to a login.
 */
export function makeRecovery2Kit(
  ai: ApiInput,
  login: LoginTree,
  username: string,
  questions: string[],
  answers: string[]
): LoginKit {
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

export async function listRecoveryQuestionChoices(
  ai: ApiInput
): Promise<string[]> {
  return asQuestionChoicesPayload(
    await loginFetch(ai, 'POST', '/v1/questions', {})
  )
}
