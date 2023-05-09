import { uncleaner } from 'cleaners'

import {
  asChangeRecovery2Payload,
  asQuestionChoicesPayload,
  asRecovery2InfoPayload
} from '../../types/server-cleaners'
import {
  EdgeAccountOptions,
  EdgeRecoveryQuestionChoice
} from '../../types/types'
import { decrypt, decryptText, encrypt } from '../../util/crypto/crypto'
import { hmacSha256 } from '../../util/crypto/hashes'
import { utf8 } from '../../util/encoding'
import { ApiInput } from '../root-pixie'
import { applyKit, serverLogin } from './login'
import { loginFetch } from './login-fetch'
import { fixUsername, getStash } from './login-selectors'
import { LoginKit, LoginTree } from './login-types'

const wasChangeRecovery2Payload = uncleaner(asChangeRecovery2Payload)

function makeRecovery2Id(
  recovery2Key: Uint8Array,
  username: string
): Uint8Array {
  const data = utf8.parse(fixUsername(username))
  return hmacSha256(data, recovery2Key)
}

function makeRecovery2Auth(
  recovery2Key: Uint8Array,
  answers: string[]
): Uint8Array[] {
  return answers.map(answer => {
    const data = utf8.parse(answer)
    return hmacSha256(data, recovery2Key)
  })
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
    recovery2Id: makeRecovery2Id(recovery2Key, username),
    recovery2Auth: makeRecovery2Auth(recovery2Key, answers)
  }
  return await serverLogin(
    ai,
    stashTree,
    stashTree,
    opts,
    request,
    async reply => {
      if (reply.recovery2Box == null) {
        throw new Error('Missing data for recovery v2 login')
      }
      return decrypt(reply.recovery2Box, recovery2Key)
    }
  )
}

/**
 * Fetches the questions for a login
 * @param username string
 * @param recovery2Key an ArrayBuffer recovery key
 * @param Question array promise
 */
export async function getQuestions2(
  ai: ApiInput,
  recovery2Key: Uint8Array,
  username: string
): Promise<string[]> {
  const request = {
    recovery2Id: makeRecovery2Id(recovery2Key, username)
    // "otp": null
  }
  const reply = await loginFetch(ai, 'POST', '/v2/login', request)
  const { question2Box } = asRecovery2InfoPayload(reply)
  if (question2Box == null) {
    throw new Error('Login has no recovery questions')
  }

  // Decrypt the questions:
  return JSON.parse(decryptText(question2Box, recovery2Key))
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

  const { loginId, loginKey, recovery2Key = io.random(32) } = login
  const question2Box = encrypt(
    io,
    utf8.parse(JSON.stringify(questions)),
    recovery2Key
  )
  const recovery2Box = encrypt(io, loginKey, recovery2Key)
  const recovery2KeyBox = encrypt(io, recovery2Key, loginKey)

  return {
    serverPath: '/v2/login/recovery2',
    server: wasChangeRecovery2Payload({
      recovery2Id: makeRecovery2Id(recovery2Key, username),
      recovery2Auth: makeRecovery2Auth(recovery2Key, answers),
      recovery2Box,
      recovery2KeyBox,
      question2Box
    }),
    stash: {
      recovery2Key
    },
    login: {
      recovery2Key
    },
    loginId
  }
}

export async function listRecoveryQuestionChoices(
  ai: ApiInput
): Promise<EdgeRecoveryQuestionChoice[]> {
  return asQuestionChoicesPayload(
    await loginFetch(ai, 'POST', '/v1/questions', {})
  )
}
