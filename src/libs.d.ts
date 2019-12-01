declare module 'aes-js'

declare module 'base-x' {
  export default function makeCodec(
    alphabet: string
  ): {
    encode: (data: ArrayLike<number>) => string
    decode: (base: string) => Uint8Array
  }
}

declare module 'currency-codes'
declare module 'ethereumjs-tx'
declare module 'ethereumjs-util'
declare module 'hmac-drbg'
declare module 'node-fetch'

declare module 'react-native' {
  // We can't install the React Native type definitions in node_modules,
  // since they conflict with the DOM ones, which we also need.
  //
  // Instead, we provide our own local definitions for the few React Native
  // things we use.

  function findNodeHandle(component: React.Component<any>): number
  function requireNativeComponent(name: string): React.ComponentClass<any>

  interface UIManager {
    dispatchViewManagerCommand: (
      handle: number,
      method: string,
      args: any[]
    ) => void
  }
  const UIManager: UIManager
}

declare module 'scrypt-js' {
  export default function scrypt(
    data: ArrayLike<number>,
    salt: ArrayLike<number>,
    n: number,
    r: number,
    p: number,
    outLength: number,
    onProgress: (
      error: Error | undefined,
      progress: number,
      key: ArrayLike<number> | undefined
    ) => void
  ): void
}
