// @flow

import { type EdgeFakeUser } from '../../src/index.js'

// Credentials:
const info = {
  password: 'y768Mv4PLFupQjMu',
  pin: '1234',
  recovery2Answers: [
    'Sir Lancelot of Camelot',
    'To seek the Holy Grail',
    'Blue'
  ],
  recovery2Key: 'NVADGXzb5Zc55PYXVVT7GRcXPnY9NZJUjiZK8aQnidc',
  recovery2Questions: [
    'What is your name?',
    'What is your quest?',
    'What is your favorite color?'
  ],

  // Account syncKey in base64:
  syncKey: '4lTrhShflldKM7/pexP1M/4kW0I='
}

export const fakeUserDump: EdgeFakeUser = {
  username: 'js test 0',
  loginKey: 'GfkdeJm4b4WUYNhQqWcI5e0J/e6wra+QUxmichsaCfA=',
  loginId: 'm3HF2amNoP0kV4n4Md5vilUYj6l+j7Rlx7VLtuFppFI=',
  repos: {
    e254eb85285f96574a33bfe97b13f533fe245b42: {
      'Wallets/8568EAC0-62D0-405E-95A1-B457AE372F09.json': {
        iv_hex: '2902014ac691c90f8183140ba74c921c',
        data_base64:
          'gmTTFYpxEJKM+ibmvwDi/uvdL0mq0Pzy1vziTKXRSL49ekHuE2o7HtYJENztg9dLJd1nNXpZD1Y9xsrLrPDzV8r3LDcm6yOLBbBBHle9UwsaSaPLE4KNgh8QzCnm3eeDJMaNHRoxyr/hyUsDo2KwV7FYrmf2gLdnG0yXu/W0im5YgUmAMvG+7u/OQpCuQQyJvBpFVR+7UpP2MNVUnaTacXPPNjfktegHQ8mWwgomRLtVZQbgYcZZFivSvWuUoWbr61/qosF5qGzqRQ9slI3w4J6veN5xpzRMkP9B6pFQRn+tk1jWk8v3GnKACI8+SOzQt+ZcBt/XVR3vExrHgVF7j+OrBy+jyhg9KaiaxoCTVDd0zaqkN+kCh9KgqOLZn2s0SXl2O0IzpdbtKZUyVxoh6Pjkli/t2FqEs5WdZrbwI2k=',
        encryptionType: 0
      }
    },
    '6036207e1f8c87346a8c7585495537d98804084c': {},
    '5ca83c3a724244d519aec49efe5a8fc96c6fcdac': {
      'WalletName.json': {
        data_base64:
          'MFD9Q9hL48NfjUkP7XYi1UKhenwCxsw10y5ASMZvNLWBmBkxiSiBxQzd92ga15qtuce+0iWj43tRn6HWw0wzvglIuxqNDAXE9B8WLGxOS9U=',
        encryptionType: 0,
        iv_hex: '03125dd427c6e1680b3a25bcaf6e29d0'
      }
    },
    '0930f3c2cd0417765198fbea95ec9f1e99000312': {}
  },
  server: {
    appId: '',
    loginId: 'm3HF2amNoP0kV4n4Md5vilUYj6l+j7Rlx7VLtuFppFI=',
    otpTimeout: 100,
    passwordAuthBox: {
      data_base64:
        'ZHhQtHA48aPf083XbEeNMAzbu4KE5dNLU6q0WzTUwJkxGG72elIha9wMjpAvwxmJ2PC3ZCMya1eiVgHPqTO+zS8dWHmuqzbpNY+IdoAtjF//dZ6O4mCcMR8enmj5xYaVBIIQ8WCcang+2RTqDzOoI+W8p6mM9N528ypy0lkpYi9lpGrxAAAJjhk+9xdBRcL4O5jkCZ0VQEvoRCqlU2y99YtRYtB/+nYj51PTtU00MUpKq7PggNZI5EDmZC9vK/BRnBArLbnwj7L88vuKEXBumYX0GA9ZhTPXMuRfABzvCxPkTKLGG2KmfQAtSAehCDMtkgQzocXSCiUuzqBdId56WkNFYC+Phq6vgflPK2qcxkV6Kz2qu8Yr1nBveyLsUTGOZgoBlya2UEZrQ4B96mUv5Q==',
      encryptionType: 0,
      iv_hex: 'c801b7e3265734544c08c68bdff86979'
    },
    passwordBox: {
      data_base64:
        'sXBdJaaeVNWOuBWdRVvULaS+VqPkTF1eLR0BMSi2a4F+DCc+4JbMqgBPK3uyp7MHd3qpOOt7Fcth5gnT5hspzh47ONsTTaQNglwZ4lY25OKGsK7ldWrcohiDEgswgG8whGM3tqio6iIMndkuZn3Dn9aj0SwWNdCuW1xFYvbMa7pCgWr0QT+zjWJAPnlT0U1hqJNjGDqFK6jYorClWKsbBZtVJ/dCRMv5+xu05S7fCdgQnz1m5O5nMHTcw6NFR0eBApOOh3KbghOeh0QcBAa5jNm4L61BK5wMCgPydh2/u+MSu34ERsomA5kwp86N35EKHGJH3p0Jq/jf9ToR9wU/MlPivmHvbbspxIzay0feJcanodfyFqLLnsfknSptgiaX3ppat83xrdndQH+JNYweNTgoZmd5pt/8hu/LGk1iAs8Z6e61FaYXm+UI/yxUQFy3A8meST1UfVAxeFw3IRCRZRplll8fgALH67kO15s4bts=',
      encryptionType: 0,
      iv_hex: '0989bebe4103816be3db48a2ed3ff338'
    },
    passwordKeySnrp: {
      n: 16384,
      p: 1,
      r: 2,
      salt_hex:
        'ed6396d127b60d6ffc469634b9a53bdcfb4ee381e9b9df5e66a0f97895871981'
    },
    pin2Box: {
      encryptionType: 0,
      iv_hex: 'e46f6fa3ffbefcdb549f2a350655c51f',
      data_base64:
        'TYNoHvzlC/7r/2mR26bvXI0OBPEuY8lBs3DZi4NephEFjs5za+5RRyilG35piSHhgLzn3u1scpLt0fuvwjT+ZhLsMvsZug8RXzIEqSZFijI='
    },
    pin2KeyBox: {
      encryptionType: 0,
      iv_hex: '84e0026a5826e614a0228c68b2161e9c',
      data_base64:
        '1hN3W2nl1ALVMiJW4Gg4uIUFJdQ3Q/lQpwgCYHycn1nJlxwO7lcjNUG47tYFTdmhsrSmmRixQE+siM7X6II0bDqyyp7ynE9hL6+2ahJvsvA='
    },
    question2Box: {
      encryptionType: 0,
      iv_hex: '9e9e326f3290798710db411479a4492f',
      data_base64:
        'U4exiu8ycykdZUL/+urQxbVcpyugCJJKtPZ48jvkrMawJhUnolv9g2oCs5IPkUpXx3V7atgpIZHi71tadC0zaIgJfoyXBw0V4ZVNZtiFIljJxYsuI60sGHIrYmyNj3ZDHevpRWoHtEIYNtg8S57ZLIWUO1eQmuEkfpj8VAasGbk='
    },
    recovery2Box: {
      encryptionType: 0,
      iv_hex: '8413f1eadf981f199e06f90bef1b6f45',
      data_base64:
        'bSHUW6sKgDkqaiwsvxWeCNj4KSE3FSKsQ12EAv0iUe9Ym/l6nMrt/Vamwe5Rw7gpRlKaLSklFCXD1TL5EytfwfSrWYz4ijR1NG9FZThW4B8='
    },
    recovery2KeyBox: {
      encryptionType: 0,
      iv_hex: 'a1d70b50758a8b4adee8b1f56b310f6c',
      data_base64:
        'Z7lrDhvJC3t/TMwFXVX+iA1RP7erSeLrESbdOGbs0Kl1jeaYDNZMIovo5bX01DB7myS4ozbGu1NKhNk4sxTa3eraTe+dz4khLqm+5cNwuIA='
    },
    keyBoxes: [
      {
        data_base64:
          'ABM8mwYTGuODvGXR6BMN0/2AXK6nO+AaZ0QZamdLsZGd1YnfdnERXyYHZJPXD3CtUPY7lpXuohawb8H9MMce6fDxI9Dx+xEb6FjZZYcQsRD0r6fCWHgGSbXhQyo5AQ8xMLQrs0Y34bOH5MWnIlKU8zci5P0RvryZNDa9QvaHWTK5Klxsd9dD7MlkGAjeCloyN+aLi11SdK0IaCz14FqEwQatcbSQeStY4xGh2fKIKQp41ycvEYg6y94UB9kmQ1ncYSnpElfNb7Eb8XjzH7xOje4Bxs29gYC3uE72u4RslcpjxGZJFApKxYhn5gNfTfA4z1PGBSl0ihe5ABq1F8AavkGzY65+IwVmYqDYVum9JoErXG3qM8eE4W2WU+SomAsU',
        encryptionType: 0,
        iv_hex: '59492a8c11fac4baf5fccfdef83be212'
      }
    ],
    rootKeyBox: {
      data_base64:
        'pR+yQsnkynA03Xqa8AYHzRzunxsBoFM39huz09DL+20RZxAAid4iWkkBNei+Z6Mp0sdhDNfilPQmU5rOuABo70NIO+E3GNZ66RmG6SkN0Jo0Fgp28Qfyg/aD6BlMNw++oXS8yGuDvPotDpM/rgYd6l7/OuLLfg5cZw85Qe1D9UM9dqP8EVpKPQTqSsAnTE0RsHG3HFVIFVRQAsIqqsynAC+h8QiKdAFaqzdFVbB75iu4KV27wdjfRnZrTVPqGA9fnC96vhRRUNRmQnWbJRvdyhIXRHYXJbu/ip1eFts054yfjhyxHffOXfcSpm3xwL0itf3Y4rEUG0dEQO5IwfpuRxspFFn3S/Fi4wGkw+PJNNtF3r5djryeYOFE854n3YOkBayhyhnNAJuaaHeOnrP7QaD3V4hDuFezHqTWCU8lA7W0u7SmFZ1IXXXxvjITvglkmTrnx8CbWkmjRXqIbMl8tg==',
      encryptionType: 0,
      iv_hex: '96cc1ebc2d11a0b38c9259c056d3ca23'
    },
    syncKeyBox: {
      data_base64:
        'ruf9v3eWUg2GZJf+94boCPyui4nQ9HnJCWx07kmRg+nKns+1MlqSFQQNINgHXLWDrQvho69AnQrP9Ep+PcXOnG+m0kiqlmzm8UdhQoQJOKP/O5S2TFwMuLpLrGN+I4F5HbdGVMA20WJjhfQ7Kzc3H2hHwm1BUo0xItbV/audT6KySR+ugeW+jF5glzB0/8eAYFKloYd0YC6TZg1gmZU7jqBatpylk7a9znrZG6zKVyPQxnkKr6TnF3xQihSw2H7g1Gd4AI4Pttye/RYsVbwqFFnD2OZwgp7kqeyLwVRsU6OboRtkBYuaa4adYhXHda94',
      encryptionType: 0,
      iv_hex: '59309614b12c169af977681e01d6ad8b'
    },
    otpKey: 'He110==',
    passwordAuth: '5dd0xXRq1tN7JF0aGwmXf9kaExbZyMyIKBWGc0hIACc=',
    pin2Auth: 'shzN/UzE4byBpHWlFka9fkZ9n+NWRiESqJ6hnso8CQI=',
    pin2Id: 'X8iNgUh49p8B5FZNAsaTk0nXTtbOzWI5Eo91zUvJgd0=',
    recovery2Auth: [
      '3HLK5/t/b423IHXRU+Y3QpchDs7vYBTRcmVSDCSxtrM=',
      'NB//m53r5qqz8CvJTU+oX6MUrnRGsXkyiQLvLmBkOpU=',
      'RY5FHVy9P2NU/m57AtJcNepLMEJbSF/nH9kYVUNNLrQ='
    ],
    recovery2Id: 'DeovL5jZTjnVjj+W/a7mTFKn0evQw0a3RxaAEwBC1+8=',
    pinBox: {
      data_base64:
        'sAofSizrgvQKyYTJh9+MN0TZPa5G02sPxwen+/l/89Wy6dX0PFW8s0NM/gyPhodjrkTrAU6DhWdtlT4ylswWRK6a8DxK/udovFwLy6gtCV2mxgwtqmP/+CHMULrXa1TuffyDSOivPG+Ygu5Hb6JKUpFRVNkeLyHaRgLUgSPp8mtTY8r7yHyIGf8lAk2l4KOJoQTPoqgipbkzx7P3r4Iv8pOecHseVS01VGTGCthST99h10skgOBPNB2hkCO/Ao922WAuotPvK0a339t4AQxGNSfnKL1Jqf4mKcvLLoEY9I0P/a/EaJIrTD0HELc0sw+uxPL56gtkhFyP7WVaxSQk4iEa1FwOV6r0T3G9t6wrzv8vPEDbZr0n/mjWPf+ZuxZVZ4x4OxtaDkBvg6oa/Y8kI2E3E3j72Y5/1Z8xOrYz4ZcwtUGKHtUlwAWdX4Z9DR+Bab7fxQjCeqEg+iMMUyu1qBH7aeqgKkx3AfwT+pwOUiEGM+1cTaxP7ibzW1zYZNbWSzt0PyAlFXF3Q97Rfn2LcMGl4sbx1K5GvjUlOCvigE5ltXgseqLk7/8bpVaj03EThRjN0vT4Hg5BWQyX6m6vWQ==',
      encryptionType: 0,
      iv_hex: '33dbb4188630d572cd4a474f780e2799'
    },
    pinId: 'ykRUVmIqaGNx3wlp3myep+dDUCHjiRCQ/u30o/0I1tc=',
    pinKeyBox: {
      data_base64:
        'gW1L57CIJ0sCJa8mDUiqGWpI9dUrV/OQzS+BvIFUtAlBqO6ZxwssTVkos5C1sBDnxlV25eNdrkV4NY24r89wW0k6tGoR6LeKrT0PQggw882vRT4zavAPZNj39sNZ0+Ls1PCdZIU+Ez6a0ZzimAnkofgB1PcS17gmb8mKZOpFyfoKgdg/EBfipUmPn80FWwxvOwM+HTotV3BL3wRLC58UuZzLAFV6cGPCHyYQphWLVk307VaajAAEp7+XHXi6gxp4',
      encryptionType: 0,
      iv_hex: 'd882620a197f11c244457ccf5ae804da'
    },
    children: [
      {
        appId: 'test-child',
        loginAuthBox: {
          encryptionType: 0,
          iv_hex: '03125dd427c6e1680b3a25bcaf6e29d0',
          data_base64:
            'VpqitCInCKYD8ZkYgR9/1aPrAFPEPDd/h6mqZmUE9eXuVDKzJcufXV/TgPnomLKBsprNOoZ0QNzudtXYLJu6AxDtMI4i/brvj/6gC26zaqE='
        },
        loginId: 'XLEnM4m6ArsEQp+OheBSgIXGLb88RvO086D65ILwAkg=',
        pin2Box: {
          encryptionType: 0,
          iv_hex: '03125dd427c6e1680b3a25bcaf6e29d0',
          data_base64:
            'G/edIgFPvr57S02TyT2qH3ylZ5BmOWMvMAMLKUksRr5Zw4nNGAy95Erga2BqWCqAYR3fCAp+TTKoCR/Wd6lgesCkpQYxh3fTUBliZwbUUtY='
        },
        pin2KeyBox: {
          encryptionType: 0,
          iv_hex: '03125dd427c6e1680b3a25bcaf6e29d0',
          data_base64:
            '1nCWjsW66E8RceBNFkP8bH5I5H4yhMGJrLCxwhbsKmo5x+hpFW0G/sUNXlsuIRCaEiKGODuI4cyeeUQoqbd03ZxFCwpDHrYD8C1NDW2JOJY='
        },
        keyBoxes: [
          {
            encryptionType: 0,
            iv_hex: 'b691d83b2ad52cdf5ed94043529d1467',
            data_base64:
              'xHKpFZab1tRhari9uZFouMMF8jC6kwDyi4aEivrigdCRACcB5Ojz9dmTUBxqnTGYkMnEDcdNkcxh7hFOe6y1vp6047gT/yMt1t2hLnTuyC9ebFDEDcCpWvOGSEPS9rOqEj8JDBU13xOCkAee0m5KmDaB5a2W1dehSAf6gD9OCdAap8WhcDP3CNodBDQYEpJuWGtUF7vxf46WyG3PYswnrXbMJAT0ksFBv5vhre2mcSHxxXj39TqyQZN6YESNujUkamge/0ky5MVXG2abIMouU4QgsoTkRZJfJ9w/4giXT8KSyMlCOL8/n9Xb67Tow5HeTiPZe7SHz7NUkW1N13E4CpnJUSj8NwW77LQbmuikci9avhpGiXDZOOK+VEm0aMjVAuZ9kVjkEHxXsuOk1yowfA=='
          }
        ],
        parentBox: {
          encryptionType: 0,
          iv_hex: '03125dd427c6e1680b3a25bcaf6e29d0',
          data_base64:
            'Eel57GZtGBSs5WmIK2YpCelZd793qsWcjfHz4zrsUHyV8PgifyAcFH/9ByKmHg6JUFUPW5mqMNCjn+gLjUGyibV6LA0iD6FVm+FGhhDlxEY='
        },
        loginAuth: 'cfNNeN4xPQK7+2/j8xSyF/xm5NVTDOZkzacwO1FTaKw=',
        pin2Auth: 'i5LBqVNDTMU60rQLfjOiEatR5P/xzRS9mmdfk8TQdrM=',
        pin2Id: 'oEfMhgYiGLM0JGcrxA3FgACSURA9QIkb+yanM8Euiqo=',
        children: [
          {
            appId: 'test-child-child',
            loginAuthBox: {
              encryptionType: 0,
              iv_hex: '03125dd427c6e1680b3a25bcaf6e29d0',
              data_base64:
                'mLsk9qk63Ds3otupOcQwCvDgfzmn9koQ1tBNyBDGGDYvbVmD6gS/hZuresxTpX2DHWNVQC25Y5sISRvbCO1jWuImv8JuT9rCp7aWd+fTgdY='
            },
            loginId: 'aE08nXKAftS37IQiOx7ccRrCkh8fLLiRbw5CnG26bbc=',
            parentBox: {
              encryptionType: 0,
              iv_hex: '03125dd427c6e1680b3a25bcaf6e29d0',
              data_base64:
                'nT3OFKzf/hsIZOZhG6BtPwL1z9wkZk5KolB9MH02FITQQOvQ0pPZtf0Es5rj9TCrJM3VUSJ4AjPh8NGzgyY6q8qr/mKI158pyqeDai+IeL4='
            },
            loginAuth: 'bqqKPbbmpcBS1185JjzNFRRYPjkkIG8aCLujRMdqng==',
            children: []
          }
        ]
      }
    ]
  }
}

export const fakeUser = { ...info, ...fakeUserDump }
