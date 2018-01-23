# Airbitz Javascript core

This library implements the Airbitz Edge Security login infrastructure.
It runs inside a client application, and provides zero-knowledge access to
cryptographic keys and other secrets via a familiar password-based login
system.

## Documentation

See https://developer.airbitz.co/javascript/

## Account Management UI

To quickly get up and running with the UI for account creation, login, and
management (change PIN/password), use [airbitz-core-js-ui](https://github.com/Airbitz/airbitz-core-js-ui/).

## Setup

Just use `npm install --save airbitz-core-js` to add this library to your project.

If you are on React Native, you must also do:

    # Install native support libraries:
    npm install --save react-native-fast-crypto react-native-fs
    npm install --save git://github.com/Airbitz/react-native-randombytes.git
    npm install --save git://github.com/Airbitz/react-native-tcp.git

    # Link support libraries into the native project files:
    react-native link react-native-fast-crypto
    react-native link react-native-fs
    react-native link react-native-randombytes
    react-native link react-native-tcp

The bundled library uses only ES5 feature thanks to [Bublé](https://buble.surge.sh),
but we do require the following ES2015 features either natively or as pollyfills:

* Object.assign
* Promise
* Uint8Array

If you want to run in the browser, you must also have:

* fetch
* localStorage
* Window.crypto.getRandomNumbers

## Contributing

Run `yarn` to download dependencies and build the library, then run `yarn test` to run the unit tests, and `yarn flow` to check for type errors.

All sources are in the [JavaScript Standard Style](http://standardjs.com/) + [Prettier](https://prettier.io/). We check files prior to each commit, so if you have formatting issues, you can run `yarn format` to fix them automatically.

If you use Visual Studio Code, consider installing the [prettier-vscode](https://marketplace.visualstudio.com/items?itemName=esbenp.prettier-vscode) extension. You'll want to enable the `prettier.eslintIntegration` configuration option for this to work seamlessly with Standard.

If you use Atom, you can use [prettier-atom](https://atom.io/packages/prettier-atom). You'll want to check the "ESLint Integration" setting for this to work seamlessly with Standard.
