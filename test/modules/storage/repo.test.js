// @flow

import { assert } from 'chai'
import { downgradeDisklet } from 'disklet'
import { describe, it } from 'mocha'

import { fakeUser, makeFakeIos } from '../../../src/index.js'
import { makeRepoPaths, syncRepo } from '../../../src/modules/storage/repo.js'
import { base64 } from '../../../src/util/encoding.js'

const fakeRepoInfo = {
  id: '',
  type: '',
  keys: {
    dataKey: base64.stringify(fakeUser.loginKey),
    syncKey: base64.stringify(fakeUser.syncKey)
  }
}

describe('repo', function () {
  it('local get', async function () {
    const [io] = makeFakeIos(1)
    const paths = makeRepoPaths(io, fakeRepoInfo)

    const payload = '{"message":"Hello"}'
    const box = `{
      "encryptionType": 0,
      "iv_hex": "82454458a5eaa6bc7dc4b4081b9f36d1",
      "data_base64": "lykLWi2MUBbcrdbbo2cZ9Q97aVohe6LZUihp7xfr1neAMj8mr0l9MP1ElteAzG4GG1FmjSsptajr6I2sNc5Kmw=="
    }`

    await downgradeDisklet(io.disklet)
      .folder('repos')
      .folder('GkVrxd1EmZpU6SkEwfo3911t1WjwBDW3tdrKd7QUDvvN')
      .folder('changes')
      .folder('a')
      .file('b.json')
      .setText(box)

    const text = await paths.disklet.getText('a/b.json')
    assert.equal(text, payload)
  })

  it('offline set/get', async function () {
    const [io] = makeFakeIos(1)
    const { disklet } = makeRepoPaths(io, fakeRepoInfo)
    const payload = 'Test data'

    await disklet.setText('b.txt', payload)
    const text = await disklet.getText('b.txt')
    assert.equal(text, payload)
  })

  it('repo-to-repo sync', async function () {
    const [io1, io2] = makeFakeIos(2)

    const paths1 = makeRepoPaths(io1, fakeRepoInfo)
    const paths2 = makeRepoPaths(io2, fakeRepoInfo)
    const payload = 'Test data'

    const dummyStatus = { lastSync: 0, lastHash: void 0 }
    await paths1.disklet.setText('a/b.json', payload)
    await syncRepo(io1, paths1, dummyStatus).then(changed => assert(changed))
    await syncRepo(io2, paths2, dummyStatus).then(changed => assert(changed))
    const text = await paths2.disklet.getText('a/b.json')
    assert.equal(text, payload)
  })
})
