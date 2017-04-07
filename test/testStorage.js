/* global describe, it */
import { makeFakeIos } from '../src'
import { LocalStorageFolder } from '../src/io/localStorageFolder.js'
import assert from 'assert'

describe('storage', function () {
  it('single file', function () {
    const [io] = makeFakeIos(1)
    const folder = new LocalStorageFolder(io.localStorage, '')

    folder.setFileText('a', 'text')
    assert.equal(folder.getFileText('a'), 'text')
    assert.deepEqual(folder.listFolders(), [])
    assert.deepEqual(folder.listFiles(), ['a'])

    folder.removeFile('a')
    assert.deepEqual(folder.listFiles(), [])
  })

  it('sub-folder', function () {
    const [io] = makeFakeIos(1)
    const folder = new LocalStorageFolder(io.localStorage, '')
    const child = folder.getFolder('sub')

    child.setFileText('a', 'text')
    assert.equal(child.getFileText('a'), 'text')
    assert.deepEqual(child.listFolders(), [])
    assert.deepEqual(child.listFiles(), ['a'])
    assert.deepEqual(folder.listFolders(), ['sub'])
    assert.deepEqual(folder.listFiles(), [])

    folder.removeFile('a')
    assert.deepEqual(folder.listFiles(), [])
    assert.deepEqual(folder.listFiles(), [])
  })

  it('remove folder', function () {
    const [io] = makeFakeIos(1)
    const folder = new LocalStorageFolder(io.localStorage, '')
    const child = folder.getFolder('sub')

    child.setFileText('a', 'text')
    folder.removeFolder('sub')
    assert.deepEqual(child.listFiles(), [])
    assert.deepEqual(folder.listFiles(), [])
    assert.deepEqual(folder.listFolders(), [])
  })
})
