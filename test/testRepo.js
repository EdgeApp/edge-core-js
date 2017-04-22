/* global describe, it */
import { makeContext, makeFakeIos } from '../src'
import { makeRepoFolder, syncRepo } from '../src/repo'
import { fakeUser, fakeRepoInfo, makeFakeAccount } from './fake/fakeUser.js'
import assert from 'assert'

describe('repo', function () {
  it('local get', function () {
    const [io] = makeFakeIos(1)
    const folder = makeRepoFolder(io, fakeRepoInfo)

    const payload = '{"message":"Hello"}'
    const box = `{
      "encryptionType": 0,
      "iv_hex": "82454458a5eaa6bc7dc4b4081b9f36d1",
      "data_base64": "lykLWi2MUBbcrdbbo2cZ9Q97aVohe6LZUihp7xfr1neAMj8mr0l9MP1ElteAzG4GG1FmjSsptajr6I2sNc5Kmw=="
    }`

    return io.folder
      .folder('repos')
      .folder('GkVrxd1EmZpU6SkEwfo3911t1WjwBDW3tdrKd7QUDvvN')
      .folder('changes')
      .folder('a')
      .file('b.json')
      .setText(box)
      .then(() => {
        return folder
          .folder('a')
          .file('b.json')
          .getText()
          .then(text => assert.equal(text, payload))
      })
  })

  it('offline set/get', function () {
    const [io] = makeFakeIos(1)
    const folder = makeRepoFolder(io, fakeRepoInfo)
    const file = folder.file('b.txt')
    const payload = 'Test data'

    return file
      .setText(payload)
      .then(() => file.getText())
      .then(text => assert.equal(text, payload))
  })

  it('repo-to-repo sync', function () {
    const [io1, io2, io3] = makeFakeIos(3)
    io1.log = io1.console
    io2.log = io2.console
    makeFakeAccount(makeContext({ io: io3 }), fakeUser)

    const folder1 = makeRepoFolder(io1, fakeRepoInfo)
    const folder2 = makeRepoFolder(io2, fakeRepoInfo)
    const payload = 'Test data'

    return folder1
      .folder('a')
      .file('b.json')
      .setText(payload)
      .then(() => syncRepo(io1, fakeRepoInfo).then(changed => assert(changed)))
      .then(() => syncRepo(io2, fakeRepoInfo).then(changed => assert(changed)))
      .then(() => folder2.folder('a').file('b.json').getText())
      .then(text => assert.equal(text, payload))
  })
})
