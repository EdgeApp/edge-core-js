# Airbitz Javascript core

This library implements the Airbitz Edge Security login infrastructure.
It runs inside a client application, and provides zero-knowledge access to
cryptographic keys and other secrets via a familiar password-based login
system.

## Setup

Run `npm install` to download dependencies and build the library,
then run `npm test` to run the tests.

If you would like to make the CLI tool globally accessible, do `npm link`.
After that, you can invoke the `airbitz-core-js` executable from anywhere.

## Developing

All sources are in the [JavaScript Standard Style](http://standardjs.com/).

We use a limited subset of ES6 syntax feature,
as supported by [Bublé](https://buble.surge.sh). We also use the `Promise`
and node.js `Buffer` types, so polyfills may be necessary.

## React Native

Since React Native doesn't support several nodeisms like `Buffer`,
our stopgap measure is to bundle things with Webpack.
To do this, just run `webpack`. This will produce `dist/abc.bundle.js`.
Then adjust `package.json` to point `main` at that file.
