# Edge Core

This library implements the Edge login system. It runs inside a client application, and provides zero-knowledge backup for cryptographic keys and other secrets via a familiar password-based login system.

[![Build Status](https://travis-ci.com/EdgeApp/edge-core-js.svg?branch=master)](https://travis-ci.com/EdgeApp/edge-core-js)
[![JavaScript Style Guide](https://img.shields.io/badge/code_style-standard-brightgreen.svg)](https://standardjs.com)
[![code style: prettier](https://img.shields.io/badge/code_style-prettier-ff69b4.svg?style=flat-square)](https://github.com/prettier/prettier)

## Documentation

We have documentation at https://developer.airbitz.co/javascript/, but our [Flow types](./src/types/types.js) are the best, most up-to-date reference for what this library contains.

## Account Management UI

To quickly get up and running with the UI for account creation, login, and management, use [edge-login-ui-web](https://github.com/EdgeApp/edge-login-ui/tree/develop/packages/edge-login-ui-web) for the web or [edge-login-ui-rn](https://github.com/EdgeApp/edge-login-ui/tree/develop/packages/edge-login-ui-rn) for React Native.

## Setup

Just use `npm install --save edge-core-js` to add this library to your project.

To create an `EdgeContext` object, which provides various methods for logging in and creating account, do something like this:

```javascript
const context = await makeEdgeContext({
  apiKey: '...', // Get this from our support team
  appId: 'com.your-app',
  plugins: {
    // Configure currencies, exchange rates, and swap providers you want to use:
    'bitcoin': true
  }
})
```

The core uses various plugins to provide its currency, exchange rate, and swap features. These plugins ship separately, and are designed to load in parallel with the core:

```js
import { addEdgeCorePlugins, lockEdgeCorePlugins } from 'edge-core-js'
import exchangePlugins from 'edge-exchange-plugins'
import bitcoinPlugins from 'edge-currency-bitcoin'
import currencyPlugins from 'edge-currency-accountbased'

addEdgeCorePlugins(exchangePlugins)
addEdgeCorePlugins(bitcoinPlugins)
addEdgeCorePlugins(currencyPlugins)
lockEdgeCorePlugins()
```

The above code sample works for Node.js. For the browser and React Native, plugins load using a `<script>` tag. The `lockEdgeCorePlugins` is necessary on all platforms, and must happen before login can proceed.

### React Native

This library has React Native support. Starting at version 0.15.0, however, it achieves this support by running most of its logic inside a WebView component. This has several important advantages, including better performance, but it makes integration quite complicated. We are in the process of simplifying and documenting the necessary steps. In the mean time, please refer to the [edge-react-gui](https://github.com/EdgeApp/edge-react-gui) project for an example of what this integration looks like.

### Platform Requirements

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
