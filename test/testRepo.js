/* global describe, it */
import assert from 'assert'

import * as packages from './fake/packages.js'
import {Repo} from '../src/util/repo.js'
import {makeSession} from './fake/session.js'

describe('repo', function () {
  it('local get', function () {
    var session = makeSession({needsContext: true})
    var repo = new Repo(session.context, packages.dataKey, packages.syncKey)

    var payload = {'message': 'Hello'}
    session.storage.setItem(
      'airbitz.repo.2XYHMLLi8CapUQJDwxfeosLkfEwRABDgARM4B3Egqhn1.changes.a.b',
      '{"encryptionType":0,"iv_hex":"82454458a5eaa6bc7dc4b4081b9f36d1","data_base64":"lykLWi2MUBbcrdbbo2cZ9Q97aVohe6LZUihp7xfr1neAMj8mr0l9MP1ElteAzG4GG1FmjSsptajr6I2sNc5Kmw=="}'
    )
    assert.deepEqual(repo.getJson('a/b'), payload)
  })

  it('offline set/get', function () {
    var session = makeSession({needsContext: true})
    var repo = new Repo(session.context, packages.dataKey, packages.syncKey)

    var payload = {'message': 'Hello'}
    repo.setJson('a/b', payload)
    assert.deepEqual(repo.getJson('a/b'), payload)
  })

  it('repo-to-repo sync', function (done) {
    var session = makeSession({needsContext: true})
    session.server.populateRepos()
    var repo1 = new Repo(session.context, packages.dataKey, packages.syncKey)

    var payload = {'message': 'Hello'}
    repo1.setJson('a/b', payload)
    repo1.sync(function (err, changed) {
      if (err) return done(err)
      assert(changed)
      session.storage.clear()
      var repo2 = new Repo(session.context, packages.dataKey, packages.syncKey)
      repo2.sync(function (err, changed) {
        if (err) return done(err)
        assert(changed)
        assert.deepEqual(repo2.getJson('a/b'), payload)
        done()
      })
    })
  })

  it('list', function () {
    var session = makeSession({needsContext: true})
    var repo = new Repo(session.context, packages.dataKey, packages.syncKey)

    repo.setText('a', 'x')
    repo.setText('a/b', 'x')
    repo.setText('a/c', 'x')
    repo.setText('a/d/e', 'x')
    assert.deepEqual(repo.keys('a').sort(), ['b', 'c'])
  })
})
