# Airbitz Javascript core

This library implements the Airbitz Edge Security login infrastructure.
It runs inside a client application, and provides zero-knowledge access to
cryptographic keys and other secrets via a familiar password-based login
system.

## Setup

Run `npm install` to download dependencies and build the library,
then run `npm test` to run the tests.

The bundled library uses only ES5 feature thanks to [Bublé](https://buble.surge.sh),
but we do require the following ES6 either natively or as pollyfills:

* Promise
* Uint8Array

If you want to run in the browser, you must also provide:

* fetch
* localStorage
* Window.crypto.getRandomNumbers

## Account Management UI

To quickly get up and running with the UI for account creation, login, and
management (change PIN/password), use [airbitz-core-js-ui](https://github.com/Airbitz/airbitz-core-js-ui/).

## Documentation

See https://developer.airbitz.co/javascript/

## Developing

All sources are in the [JavaScript Standard Style](http://standardjs.com/).
