# Edge Core

This library implements the Edge login system. It runs inside a client application, and provides zero-knowledge backup for cryptographic keys and other secrets via a familiar password-based login system.

[![Build Status](https://travis-ci.com/EdgeApp/edge-core-js.svg?branch=master)](https://travis-ci.com/EdgeApp/edge-core-js)
[![JavaScript Style Guide](https://img.shields.io/badge/code_style-standard-brightgreen.svg)](https://standardjs.com)
[![code style: prettier](https://img.shields.io/badge/code_style-prettier-ff69b4.svg?style=flat-square)](https://github.com/prettier/prettier)

## Documentation

Currently the [Flow/typescript types](./src/types/types.js) are the most up-to-date reference for what this library contains.

## Account Management UI

To quickly get up and running with the UI for account creation, login, and management, use [edge-login-ui-web](https://github.com/EdgeApp/edge-login-ui/tree/develop/packages/edge-login-ui-web) for the web or [edge-login-ui-rn](https://github.com/EdgeApp/edge-login-ui/tree/develop/packages/edge-login-ui-rn) for React Native.

## Setup

Add this library to your project using `npm install --save edge-core-js`.

### Node.js & Browsers

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

If the core seems to hang forever when logging in, you probably forgot to call `lockEdgeCorePlugins`.

Please note that edge-core-js uses modern JavaScript syntax features such as `async`, so you may need to run the library through [Babel](https://babeljs.io/) if you plan to run it in a browser. Node 10+ supports these features natively.

### React Native

Edge-core-js directly supports React Native v0.60+ with autolinking. Simply add edge-core-js to your application, and React Native will link the necessary native modules & assets.

To create an `EdgeContext` object, you need to mount a component:

```jsx
<MakeEdgeContext
  // Get this from our support team:
  apiKey="..."
  appId="com.your-app"

  // Configure currencies and swap providers you want to use:
  plugins={{
    'bitcoin': true
  }}
  pluginUris={[
    "edge-currency-plugins.js",
    "edge-exchange-plugins.js"
  ]}

  // Called when the core is done loading:
  onLoad={edgeContext => {}}
  onError={error => {}}
/>
```

The core itself runs inside a hidden WebView, which this `MakeEdgeContext` component mounts & manages.

The core creates a `<script>` tag for each source file in the `pluginUris` array. For this to work, you need to add these plugin files to your app's native asset bundle, which is located at `/android/app/src/main/assets/` on Android. For iOS, drag these files into the "Resources" section of your Xcode project.

To debug the core, run `yarn start` inside the edge-core-js project, and then pass a `debug={true}` property to the `MakeEdgeContext` component. This tells the WebView to load the core from a local development server.

## Contributing

Run `yarn` to download dependencies, and then run `yarn prepare` to build the library.

Use `yarn verify` to run all our code-quality tools. All sources are in the [JavaScript Standard Style](http://standardjs.com/) + [Prettier](https://prettier.io/). We check files prior to each commit, so if you have formatting issues, you can run `yarn fix` to fix them automatically.

If you use Visual Studio Code, consider installing the [ESLint](https://marketplace.visualstudio.com/items?itemName=dbaeumer.vscode-eslint) extension. This will give you nice error highlighting as you work, along with quick fixes for formatting issues.
