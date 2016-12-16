/* global describe, it */
import assert from 'assert'

import * as packages from './fake/packages.js'
import {Repo} from '../src/util/repo.js'
import {makeSession} from './fake/session.js'

describe('repo', function () {
  it('local get', function () {
    const session = makeSession({needsContext: true})
    const repo = new Repo(session.context, packages.dataKey, packages.syncKey)

    const payload = {'message': 'Hello'}
    session.storage.setItem(
      'airbitz.repo.2XYHMLLi8CapUQJDwxfeosLkfEwRABDgARM4B3Egqhn1.changes.a.b',
      '{"encryptionType":0,"iv_hex":"82454458a5eaa6bc7dc4b4081b9f36d1","data_base64":"lykLWi2MUBbcrdbbo2cZ9Q97aVohe6LZUihp7xfr1neAMj8mr0l9MP1ElteAzG4GG1FmjSsptajr6I2sNc5Kmw=="}'
    )
    assert.deepEqual(repo.getJson('a/b'), payload)
  })

  it('offline set/get', function () {
    const session = makeSession({needsContext: true})
    const repo = new Repo(session.context, packages.dataKey, packages.syncKey)

    const payload = {'message': 'Hello'}
    repo.setJson('a/b', payload)
    assert.deepEqual(repo.getJson('a/b'), payload)
  })

  it('repo-to-repo sync', function () {
    const session = makeSession({needsContext: true})
    session.server.populateRepos()
    const repo1 = new Repo(session.context, packages.dataKey, packages.syncKey)

    const payload = {'message': 'Hello'}
    repo1.setJson('a/b', payload)
    return repo1.sync().then(changed => {
      assert(changed)
      session.storage.clear()
      const repo2 = new Repo(session.context, packages.dataKey, packages.syncKey)
      return repo2.sync().then(changed => {
        assert(changed)
        assert.deepEqual(repo2.getJson('a/b'), payload)
        return null
      })
    })
  })

  it('list', function () {
    const session = makeSession({needsContext: true})
    const repo = new Repo(session.context, packages.dataKey, packages.syncKey)

    repo.setText('a', 'x')
    repo.setText('a/b', 'x')
    repo.setText('a/c', 'x')
    repo.setText('a/d/e', 'x')
    assert.deepEqual(repo.keys('a').sort(), ['b', 'c'])
  })
})
