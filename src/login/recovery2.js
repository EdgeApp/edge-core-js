import * as crypto from '../crypto.js'
import {base58} from '../util/encoding.js'
import {Login} from './login.js'
import * as userMap from '../userMap.js'

function recovery2Id (recovery2Key, username) {
  return new Buffer(crypto.hmacSha256(username, recovery2Key))
}

function recovery2Auth (recovery2Key, answers) {
  if (!(Object.prototype.toString.call(answers) === '[object Array]')) {
    throw new TypeError('Answers must be an array of strings')
  }

  const recovery2Auth = []
  for (let i = 0; i < answers.length; ++i) {
    const data = new Buffer(answers[i], 'utf-8')
    const auth = crypto.hmacSha256(data, recovery2Key)
    recovery2Auth[i] = new Buffer(auth).toString('base64')
  }
  return recovery2Auth
}

/**
 * Logs a user in using recovery answers.
 * @param username string
 * @param recovery2Key an ArrayBuffer recovery key
 * @param array of answer strings
 * @param callback function (err, login)
 */
export function login (ctx, recovery2Key, username, answers, callback) {
  recovery2Key = base58.decode(recovery2Key)
  username = userMap.normalize(username)

  const request = {
    'recovery2Id': recovery2Id(recovery2Key, username).toString('base64'),
    'recovery2Auth': recovery2Auth(recovery2Key, answers)
    // "otp": null
  }
  ctx.authRequest('POST', '/v2/login', request, function (err, reply) {
    if (err) return callback(err)

    try {
      // Recovery login:
      const recovery2Box = reply['recovery2Box']
      if (!recovery2Box) {
        return callback(Error('Missing data for recovery v2 login'))
      }

      // Decrypt the dataKey:
      var dataKey = crypto.decrypt(recovery2Box, recovery2Key)

      // Cache everything for future logins:
      const userId = userMap.getUserId(ctx.localStorage, username)
      userMap.insert(ctx.localStorage, username, userId)
    } catch (e) {
      return callback(e)
    }
    return callback(null, Login.online(ctx.localStorage, username, dataKey, reply))
  })
}

/**
 * Fetches the questions for a login
 * @param username string
 * @param recovery2Key an ArrayBuffer recovery key
 * @param callback function (err, question array)
 */
export function questions (ctx, recovery2Key, username, callback) {
  recovery2Key = base58.decode(recovery2Key)
  username = userMap.normalize(username)

  const request = {
    'recovery2Id': recovery2Id(recovery2Key, username).toString('base64')
    // "otp": null
  }
  ctx.authRequest('POST', '/v2/login', request, function (err, reply) {
    if (err) return callback(err)

    try {
      // Recovery login:
      const question2Box = reply['question2Box']
      if (!question2Box) {
        return callback(Error('Login has no recovery questions'))
      }

      // Decrypt the dataKey:
      var questions = crypto.decrypt(question2Box, recovery2Key)
      questions = JSON.parse(questions.toString('utf8'))
    } catch (e) {
      return callback(e)
    }
    return callback(null, questions)
  })
}

/**
 * Sets up recovery questions for the login.
 */
export function setup (ctx, login, questions, answers, callback) {
  if (!(Object.prototype.toString.call(questions) === '[object Array]')) {
    throw new TypeError('Questions must be an array of strings')
  }
  if (!(Object.prototype.toString.call(answers) === '[object Array]')) {
    throw new TypeError('Answers must be an array of strings')
  }

  let recovery2Key = login.userStorage.getItem('recovery2Key')
  if (recovery2Key) {
    recovery2Key = base58.decode(recovery2Key)
  } else {
    recovery2Key = crypto.random(32)
  }

  const question2Box = crypto.encrypt(new Buffer(JSON.stringify(questions), 'utf8'), recovery2Key)
  const recovery2Box = crypto.encrypt(login.dataKey, recovery2Key)
  const recovery2KeyBox = crypto.encrypt(recovery2Key, login.dataKey)

  const request = login.authJson()
  request['data'] = {
    'recovery2Id': recovery2Id(recovery2Key, login.username).toString('base64'),
    'recovery2Auth': recovery2Auth(recovery2Key, answers),
    'recovery2Box': recovery2Box,
    'recovery2KeyBox': recovery2KeyBox,
    'question2Box': question2Box
  }
  ctx.authRequest('PUT', '/v2/login/recovery2', request, function (err, reply) {
    if (err) return callback(err)

    recovery2Key = base58.encode(recovery2Key)
    login.userStorage.setItem('recovery2Key', recovery2Key)
    return callback(null, recovery2Key)
  })
}

export function listRecoveryQuestionChoices (ctx, callback) {
  ctx.authRequest('POST', '/v1/questions', '', function (err, reply) {
    if (err) {
      return callback(21)
    } else {
      callback(null, reply)
    }
  })
}
