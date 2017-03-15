/**
 * Complete information for the 'js test 0' user,
 * used by the unit tests.
 */
import {Account} from '../../src/account.js'
import { loginOffline } from '../../src/login/login.js'
import { base16, base58, base64 } from '../../src/util/encoding.js'
import * as repoModule from '../../src/util/repo.js'

export const userId = base64.parse('m3HF2amNoP0kV4n4Md5vilUYj6l+j7Rlx7VLtuFppFI=')

export const loginKey = base64.parse('GfkdeJm4b4WUYNhQqWcI5e0J/e6wra+QUxmichsaCfA=')

export const username = 'JS test 0'

// Password:

export const password = 'y768Mv4PLFupQjMu'

export const passwordAuth = '5dd0xXRq1tN7JF0aGwmXf9kaExbZyMyIKBWGc0hIACc='

export const passwordAuthBox = {
  'data_base64': 'ZHhQtHA48aPf083XbEeNMAzbu4KE5dNLU6q0WzTUwJkxGG72elIha9wMjpAvwxmJ2PC3ZCMya1eiVgHPqTO+zS8dWHmuqzbpNY+IdoAtjF//dZ6O4mCcMR8enmj5xYaVBIIQ8WCcang+2RTqDzOoI+W8p6mM9N528ypy0lkpYi9lpGrxAAAJjhk+9xdBRcL4O5jkCZ0VQEvoRCqlU2y99YtRYtB/+nYj51PTtU00MUpKq7PggNZI5EDmZC9vK/BRnBArLbnwj7L88vuKEXBumYX0GA9ZhTPXMuRfABzvCxPkTKLGG2KmfQAtSAehCDMtkgQzocXSCiUuzqBdId56WkNFYC+Phq6vgflPK2qcxkV6Kz2qu8Yr1nBveyLsUTGOZgoBlya2UEZrQ4B96mUv5Q==',
  'encryptionType': 0,
  'iv_hex': 'c801b7e3265734544c08c68bdff86979'
}

export const passwordBox = {
  'data_base64': 'sXBdJaaeVNWOuBWdRVvULaS+VqPkTF1eLR0BMSi2a4F+DCc+4JbMqgBPK3uyp7MHd3qpOOt7Fcth5gnT5hspzh47ONsTTaQNglwZ4lY25OKGsK7ldWrcohiDEgswgG8whGM3tqio6iIMndkuZn3Dn9aj0SwWNdCuW1xFYvbMa7pCgWr0QT+zjWJAPnlT0U1hqJNjGDqFK6jYorClWKsbBZtVJ/dCRMv5+xu05S7fCdgQnz1m5O5nMHTcw6NFR0eBApOOh3KbghOeh0QcBAa5jNm4L61BK5wMCgPydh2/u+MSu34ERsomA5kwp86N35EKHGJH3p0Jq/jf9ToR9wU/MlPivmHvbbspxIzay0feJcanodfyFqLLnsfknSptgiaX3ppat83xrdndQH+JNYweNTgoZmd5pt/8hu/LGk1iAs8Z6e61FaYXm+UI/yxUQFy3A8meST1UfVAxeFw3IRCRZRplll8fgALH67kO15s4bts=',
  'encryptionType': 0,
  'iv_hex': '0989bebe4103816be3db48a2ed3ff338'
}

export const passwordKeySnrp = {
  'n': 16384,
  'p': 1,
  'r': 2,
  'salt_hex': 'ed6396d127b60d6ffc469634b9a53bdcfb4ee381e9b9df5e66a0f97895871981'
}

// PIN v1:

export const pin = '1234'

export const pinId = 'ykRUVmIqaGNx3wlp3myep+dDUCHjiRCQ/u30o/0I1tc='

export const pinBox = {
  'data_base64': 'sAofSizrgvQKyYTJh9+MN0TZPa5G02sPxwen+/l/89Wy6dX0PFW8s0NM/gyPhodjrkTrAU6DhWdtlT4ylswWRK6a8DxK/udovFwLy6gtCV2mxgwtqmP/+CHMULrXa1TuffyDSOivPG+Ygu5Hb6JKUpFRVNkeLyHaRgLUgSPp8mtTY8r7yHyIGf8lAk2l4KOJoQTPoqgipbkzx7P3r4Iv8pOecHseVS01VGTGCthST99h10skgOBPNB2hkCO/Ao922WAuotPvK0a339t4AQxGNSfnKL1Jqf4mKcvLLoEY9I0P/a/EaJIrTD0HELc0sw+uxPL56gtkhFyP7WVaxSQk4iEa1FwOV6r0T3G9t6wrzv8vPEDbZr0n/mjWPf+ZuxZVZ4x4OxtaDkBvg6oa/Y8kI2E3E3j72Y5/1Z8xOrYz4ZcwtUGKHtUlwAWdX4Z9DR+Bab7fxQjCeqEg+iMMUyu1qBH7aeqgKkx3AfwT+pwOUiEGM+1cTaxP7ibzW1zYZNbWSzt0PyAlFXF3Q97Rfn2LcMGl4sbx1K5GvjUlOCvigE5ltXgseqLk7/8bpVaj03EThRjN0vT4Hg5BWQyX6m6vWQ==',
  'encryptionType': 0,
  'iv_hex': '33dbb4188630d572cd4a474f780e2799'
}

export const pinKeyBox = {
  'data_base64': 'gW1L57CIJ0sCJa8mDUiqGWpI9dUrV/OQzS+BvIFUtAlBqO6ZxwssTVkos5C1sBDnxlV25eNdrkV4NY24r89wW0k6tGoR6LeKrT0PQggw882vRT4zavAPZNj39sNZ0+Ls1PCdZIU+Ez6a0ZzimAnkofgB1PcS17gmb8mKZOpFyfoKgdg/EBfipUmPn80FWwxvOwM+HTotV3BL3wRLC58UuZzLAFV6cGPCHyYQphWLVk307VaajAAEp7+XHXi6gxp4',
  'encryptionType': 0,
  'iv_hex': 'd882620a197f11c244457ccf5ae804da'
}

// PIN v2:

export const pin2Auth = 'shzN/UzE4byBpHWlFka9fkZ9n+NWRiESqJ6hnso8CQI='

export const pin2Box = {
  encryptionType: 0,
  iv_hex: 'e46f6fa3ffbefcdb549f2a350655c51f',
  data_base64: 'TYNoHvzlC/7r/2mR26bvXI0OBPEuY8lBs3DZi4NephEFjs5za+5RRyilG35piSHhgLzn3u1scpLt0fuvwjT+ZhLsMvsZug8RXzIEqSZFijI='
}

export const pin2Id = 'X8iNgUh49p8B5FZNAsaTk0nXTtbOzWI5Eo91zUvJgd0='

export const pin2Key = base64.parse('D0PT0Gtj0S9vxlcaktwdk3iMlH6osgTgUUNtoTmE2pA=')

export const pin2KeyBox = {
  encryptionType: 0,
  iv_hex: '84e0026a5826e614a0228c68b2161e9c',
  data_base64: '1hN3W2nl1ALVMiJW4Gg4uIUFJdQ3Q/lQpwgCYHycn1nJlxwO7lcjNUG47tYFTdmhsrSmmRixQE+siM7X6II0bDqyyp7ynE9hL6+2ahJvsvA='
}

// Recovery v2:

export const recovery2Answers = [
  'Sir Lancelot of Camelot',
  'To seek the Holy Grail',
  'Blue'
]

export const recovery2Auth = [
  '3HLK5/t/b423IHXRU+Y3QpchDs7vYBTRcmVSDCSxtrM=',
  'NB//m53r5qqz8CvJTU+oX6MUrnRGsXkyiQLvLmBkOpU=',
  'RY5FHVy9P2NU/m57AtJcNepLMEJbSF/nH9kYVUNNLrQ='
]

export const recovery2Box = {
  encryptionType: 0,
  iv_hex: '8413f1eadf981f199e06f90bef1b6f45',
  data_base64: 'bSHUW6sKgDkqaiwsvxWeCNj4KSE3FSKsQ12EAv0iUe9Ym/l6nMrt/Vamwe5Rw7gpRlKaLSklFCXD1TL5EytfwfSrWYz4ijR1NG9FZThW4B8='
}

export const recovery2Id = 'DeovL5jZTjnVjj+W/a7mTFKn0evQw0a3RxaAEwBC1+8='

export const recovery2Key = base64.parse('BYEJSOxFj983EUeAfj57W+dFYm+pdUfIP+jCmYtutOc=')

export const recovery2KeyBox = {
  encryptionType: 0,
  iv_hex: 'a1d70b50758a8b4adee8b1f56b310f6c',
  data_base64: 'Z7lrDhvJC3t/TMwFXVX+iA1RP7erSeLrESbdOGbs0Kl1jeaYDNZMIovo5bX01DB7myS4ozbGu1NKhNk4sxTa3eraTe+dz4khLqm+5cNwuIA='
}

export const recovery2Questions = [
  'What is your name?',
  'What is your quest?',
  'What is your favorite color?'
]

export const question2Box = {
  encryptionType: 0,
  iv_hex: '9e9e326f3290798710db411479a4492f',
  data_base64: 'U4exiu8ycykdZUL/+urQxbVcpyugCJJKtPZ48jvkrMawJhUnolv9g2oCs5IPkUpXx3V7atgpIZHi71tadC0zaIgJfoyXBw0V4ZVNZtiFIljJxYsuI60sGHIrYmyNj3ZDHevpRWoHtEIYNtg8S57ZLIWUO1eQmuEkfpj8VAasGbk='
}

// Long-term key storage:

export const rootKeyBox = {
  'data_base64': 'pR+yQsnkynA03Xqa8AYHzRzunxsBoFM39huz09DL+20RZxAAid4iWkkBNei+Z6Mp0sdhDNfilPQmU5rOuABo70NIO+E3GNZ66RmG6SkN0Jo0Fgp28Qfyg/aD6BlMNw++oXS8yGuDvPotDpM/rgYd6l7/OuLLfg5cZw85Qe1D9UM9dqP8EVpKPQTqSsAnTE0RsHG3HFVIFVRQAsIqqsynAC+h8QiKdAFaqzdFVbB75iu4KV27wdjfRnZrTVPqGA9fnC96vhRRUNRmQnWbJRvdyhIXRHYXJbu/ip1eFts054yfjhyxHffOXfcSpm3xwL0itf3Y4rEUG0dEQO5IwfpuRxspFFn3S/Fi4wGkw+PJNNtF3r5djryeYOFE854n3YOkBayhyhnNAJuaaHeOnrP7QaD3V4hDuFezHqTWCU8lA7W0u7SmFZ1IXXXxvjITvglkmTrnx8CbWkmjRXqIbMl8tg==',
  'encryptionType': 0,
  'iv_hex': '96cc1ebc2d11a0b38c9259c056d3ca23'
}

export const syncKey = base16.parse('e254eb85285f96574a33bfe97b13f533fe245b42')

export const syncKeyBox = {
  'data_base64': 'ruf9v3eWUg2GZJf+94boCPyui4nQ9HnJCWx07kmRg+nKns+1MlqSFQQNINgHXLWDrQvho69AnQrP9Ep+PcXOnG+m0kiqlmzm8UdhQoQJOKP/O5S2TFwMuLpLrGN+I4F5HbdGVMA20WJjhfQ7Kzc3H2hHwm1BUo0xItbV/audT6KySR+ugeW+jF5glzB0/8eAYFKloYd0YC6TZg1gmZU7jqBatpylk7a9znrZG6zKVyPQxnkKr6TnF3xQihSw2H7g1Gd4AI4Pttye/RYsVbwqFFnD2OZwgp7kqeyLwVRsU6OboRtkBYuaa4adYhXHda94',
  'encryptionType': 0,
  'iv_hex': '59309614b12c169af977681e01d6ad8b'
}

// Repositories:
export const repos = {
  'e254eb85285f96574a33bfe97b13f533fe245b42': {
    'Wallets/8568EAC0-62D0-405E-95A1-B457AE372F09.json': {
      'iv_hex': '2902014ac691c90f8183140ba74c921c',
      'data_base64': 'gmTTFYpxEJKM+ibmvwDi/uvdL0mq0Pzy1vziTKXRSL49ekHuE2o7HtYJENztg9dLJd1nNXpZD1Y9xsrLrPDzV8r3LDcm6yOLBbBBHle9UwsaSaPLE4KNgh8QzCnm3eeDJMaNHRoxyr/hyUsDo2KwV7FYrmf2gLdnG0yXu/W0im5YgUmAMvG+7u/OQpCuQQyJvBpFVR+7UpP2MNVUnaTacXPPNjfktegHQ8mWwgomRLtVZQbgYcZZFivSvWuUoWbr61/qosF5qGzqRQ9slI3w4J6veN5xpzRMkP9B6pFQRn+tk1jWk8v3GnKACI8+SOzQt+ZcBt/XVR3vExrHgVF7j+OrBy+jyhg9KaiaxoCTVDd0zaqkN+kCh9KgqOLZn2s0SXl2O0IzpdbtKZUyVxoh6Pjkli/t2FqEs5WdZrbwI2k=',
      'encryptionType': 0
    }
  }
}

export function makeAccount (context) {
  // Create the login on the server:
  const data = {
    userId: base64.stringify(userId),
    passwordAuth,
    passwordAuthBox,
    passwordBox,
    passwordKeySnrp,
    pin2Auth,
    pin2Box,
    pin2Id,
    pin2KeyBox,
    question2Box,
    recovery2Auth,
    recovery2Box,
    recovery2Id,
    recovery2KeyBox,
    rootKeyBox,
    syncKeyBox,
    newSyncKeys: Object.keys(repos)
  }
  context.io.fetch('https://hostname/api/v2/login/create', {
    method: 'POST',
    body: JSON.stringify({ data })
  })

  // Store the login on the client:
  const loginStash = {
    username: context.fixUsername(username),
    userId: base64.stringify(userId),
    passwordAuthBox,
    passwordBox,
    passwordKeySnrp,
    pinAuthId: pinId,
    pinBox,
    pin2Key: base58.stringify(pin2Key),
    recovery2Key: base58.stringify(recovery2Key),
    rootKeyBox,
    syncKeyBox
  }
  context.io.loginStore.update(userId, loginStash)

  // Populate the repos on the server:
  Object.keys(repos)
    .forEach(syncKey => context.io.fetch(
      'https://hostname/api/v2/store/' + syncKey,
      {
        method: 'POST',
        body: JSON.stringify({ changes: repos[syncKey] })
      }
    ))

  // Populate the repos on the client:
  Object.keys(repos).forEach(syncKey => {
    const repo = new repoModule.Repo(
      context.io,
      loginKey,
      base16.parse(syncKey)
    )
    repoModule.mergeChanges(repo.dataStore, repos[syncKey])
  })

  // Return the account object:
  const login = loginOffline(context.io, loginKey, loginStash)
  return new Account(context, login)
}
