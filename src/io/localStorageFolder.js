/**
 * Verifies that a name contains no slashes.
 */
function checkSlashes (name) {
  if (/\//.test(name)) {
    throw new Error('Slashes are not allowed in file names.')
  }
}

/**
 * Lists the keys in a localStorage object.
 */
function storageKeys (localStorage) {
  const keys = []
  for (let i = 0; i < localStorage.length; ++i) {
    keys.push(localStorage.key(i))
  }
  return keys
}

/**
 * Emulates a filesystem inside a localStorage instance.
 */
export class LocalStorageFolder {
  constructor (localStorage, path) {
    this.localStorage = localStorage
    this.path = path + '/'
  }

  getFileJson (name) {
    const text = this.getFileText(name)
    return text == null ? null : JSON.parse(text)
  }

  getFileText (name) {
    checkSlashes(name)
    return this.localStorage.getItem(this.path + name)
  }

  getFolder (name) {
    checkSlashes(name)
    return new LocalStorageFolder(this.localStorage, this.path + name)
  }

  listFiles () {
    const files = []

    const test = new RegExp(`^${this.path}([^/]+)$`)
    storageKeys(this.localStorage).forEach(key => {
      const results = test.exec(key)
      if (results != null) files.push(results[1])
    })
    return files
  }

  listFolders () {
    const folders = {}

    const test = new RegExp(`^${this.path}([^/]+)/.+`)
    storageKeys(this.localStorage).forEach(key => {
      const results = test.exec(key)
      if (results != null) folders[results[1]] = true
    })

    return Object.keys(folders)
  }

  removeFile (name) {
    checkSlashes(name)
    this.localStorage.removeItem(this.path + name)
  }

  removeFolder (name) {
    checkSlashes(name)
    const test = new RegExp(`^${this.path}${name}/`)
    storageKeys(this.localStorage).forEach(key => {
      if (test.test(key)) {
        this.localStorage.removeItem(key)
      }
    })
  }

  setFileJson (name, value) {
    return this.setFileText(name, JSON.stringify(value))
  }

  setFileText (name, text) {
    checkSlashes(name)
    return this.localStorage.setItem(this.path + name, text)
  }
}
