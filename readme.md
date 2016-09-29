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
