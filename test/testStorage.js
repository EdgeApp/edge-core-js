/* global describe, it */
import { makeFakeContexts } from '../src'
import assert from 'assert'

describe('storage', function () {
  it('single file', function () {
    const [context] = makeFakeContexts(1)
    const folder = context.io.folder

    folder.setFileText('a', 'text')
    assert.equal(folder.getFileText('a'), 'text')
    assert.deepEqual(folder.listFolders(), [])
    assert.deepEqual(folder.listFiles(), ['a'])

    folder.removeFile('a')
    assert.deepEqual(folder.listFiles(), [])
  })

  it('sub-folder', function () {
    const [context] = makeFakeContexts(1)
    const folder = context.io.folder
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
    const [context] = makeFakeContexts(1)
    const folder = context.io.folder
    const child = folder.getFolder('sub')

    child.setFileText('a', 'text')
    folder.removeFolder('sub')
    assert.deepEqual(child.listFiles(), [])
    assert.deepEqual(folder.listFiles(), [])
    assert.deepEqual(folder.listFolders(), [])
  })
})
