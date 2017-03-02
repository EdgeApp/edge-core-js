/* global describe, it */
import {Repo} from '../src/util/repo.js'
import * as packages from './fake/packages.js'
import {makeFakeContexts} from './fake/session.js'
import assert from 'assert'

describe('repo', function () {
  it('local get', function () {
    const [context] = makeFakeContexts(1)
    const repo = new Repo(context.io, packages.dataKey, packages.syncKey)

    const payload = {'message': 'Hello'}
    context.io.localStorage.setItem(
      'airbitz.repo.2XYHMLLi8CapUQJDwxfeosLkfEwRABDgARM4B3Egqhn1.changes.a.b',
      '{"encryptionType":0,"iv_hex":"82454458a5eaa6bc7dc4b4081b9f36d1","data_base64":"lykLWi2MUBbcrdbbo2cZ9Q97aVohe6LZUihp7xfr1neAMj8mr0l9MP1ElteAzG4GG1FmjSsptajr6I2sNc5Kmw=="}'
    )
    assert.deepEqual(repo.getJson('a/b'), payload)
  })

  it('offline set/get', function () {
    const [context] = makeFakeContexts(1)
    const repo = new Repo(context.io, packages.dataKey, packages.syncKey)

    const payload = {'message': 'Hello'}
    repo.setJson('a/b', payload)
    assert.deepEqual(repo.getJson('a/b'), payload)
  })

  it('repo-to-repo sync', function () {
    const [context1, context2, context3] = makeFakeContexts(3)
    packages.makeAccount(context3)
    const repo1 = new Repo(context1.io, packages.dataKey, packages.syncKey)

    const payload = {'message': 'Hello'}
    repo1.setJson('a/b', payload)
    return repo1.sync().then(changed => {
      assert(changed)
      const repo2 = new Repo(context2.io, packages.dataKey, packages.syncKey)
      return repo2.sync().then(changed => {
        assert(changed)
        assert.deepEqual(repo2.getJson('a/b'), payload)
        return null
      })
    })
  })

  it('list', function () {
    const [context] = makeFakeContexts(1)
    const repo = new Repo(context.io, packages.dataKey, packages.syncKey)

    repo.setText('a', 'x')
    repo.setText('a/b', 'x')
    repo.setText('a/c', 'x')
    repo.setText('a/d/e', 'x')
    assert.deepEqual(repo.keys('a').sort(), ['b', 'c'])
  })
})
