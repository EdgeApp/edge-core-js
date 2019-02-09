# Edge Core

This library implements the Edge login system. It runs inside a client application, and provides zero-knowledge backup for cryptographic keys and other secrets via a familiar password-based login system.

[![JavaScript Style Guide](https://img.shields.io/badge/code_style-standard-brightgreen.svg)](https://standardjs.com)
[![code style: prettier](https://img.shields.io/badge/code_style-prettier-ff69b4.svg?style=flat-square)](https://github.com/prettier/prettier)

## Documentation

See https://developer.airbitz.co/javascript/

## Account Management UI

To quickly get up and running with the UI for account creation, login, and management, use [edge-login-ui-web](https://github.com/EdgeApp/edge-login-ui/tree/develop/packages/edge-login-ui-web) for the web or [edge-login-ui-rn](https://github.com/EdgeApp/edge-login-ui/tree/develop/packages/edge-login-ui-rn) for React Native.

## Setup

Just use `npm install --save edge-core-js` to add this library to your project.

If you are on React Native, you must also do:

    # Install native support libraries:
    npm install --save react-native-fast-crypto react-native-fs
    npm install --save git://github.com/EdgeApp/react-native-randombytes.git
    npm install --save git://github.com/EdgeApp/react-native-tcp.git

    # Link support libraries into the native project files:
    react-native link react-native-fast-crypto
    react-native link react-native-fs
    react-native link react-native-randombytes
    react-native link react-native-tcp

This library uses modern Javascript syntax features from ES 2018. While these work fine in recent browsers, React Native, and Node 10+, you might need to run this library through [Babel](https://babeljs.io/) if you care about older systems.

On the other hand, this library avoids modern run-time features from ES 2015 or later, so you don't need to provide polyfills. The only features we use from ES 2015 or later are:

- `Object.assign`
- `Promise`
- `Uint8Array`

If you want to run in the browser, you must also have:

- `fetch`
- `localStorage`
- `Window.crypto.getRandomNumbers`

## Contributing

Run `yarn` to download dependencies and build the library, then run `yarn test` to run the unit tests, and `yarn flow` to check for type errors.

All sources are in the [JavaScript Standard Style](http://standardjs.com/) + [Prettier](https://prettier.io/). We check files prior to each commit, so if you have formatting issues, you can run `yarn format` to fix them automatically.

If you use Visual Studio Code, consider installing the [prettier-vscode](https://marketplace.visualstudio.com/items?itemName=esbenp.prettier-vscode) extension. You'll want to enable the `prettier.eslintIntegration` configuration option for this to work seamlessly with Standard.

If you use Atom, you can use [prettier-atom](https://atom.io/packages/prettier-atom). You'll want to check the "ESLint Integration" setting for this to work seamlessly with Standard.
