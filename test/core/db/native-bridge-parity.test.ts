import { expect } from 'chai'
import { readFileSync } from 'fs'
import { describe, it } from 'mocha'
import { join } from 'path'

/**
 * The React Native bridge is one method list written out five times: the
 * TypeScript `NativeMethods` interface, the Java dispatch, the Swift dispatch,
 * the Java `native` declarations, and the JNI symbols the linker matches those
 * against by name.
 *
 * Nothing checks any of that at build time. A method present in TypeScript but
 * missing from Swift is a rejected promise on iOS only; a JNI symbol whose
 * name does not match its Java declaration is an `UnsatisfiedLinkError` the
 * first time an Android device calls it. Both would otherwise be found by
 * running the app, on one platform, by hand.
 */

const rootDir = join(__dirname, '../../..')

function read(path: string): string {
  return readFileSync(join(rootDir, path), 'utf8')
}

function matchAll(text: string, re: RegExp): string[] {
  return [...text.matchAll(re)]
    .map(match => match[1])
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
}

describe('native bridge parity', function () {
  const bridgeTs = read('src/io/react-native/native-bridge.ts')
  const javaText = read(
    'android/src/main/java/app/edge/reactnative/core/EdgeNative.java'
  )
  const swiftText = read('ios/EdgeNative.swift')
  const jniText = read('android/src/main/cpp/edge-core-jni.c')

  /** The method names `NativeMethods` declares, which is the contract. */
  const declared = matchAll(
    bridgeTs.slice(
      bridgeTs.indexOf('interface NativeMethods'),
      bridgeTs.indexOf('export interface NativeBridge')
    ),
    /^ {2}(\w+):/gm
  )

  it('declares methods worth checking', function () {
    // A parser that silently matched nothing would make every test below pass.
    expect(declared.length).greaterThan(5)
  })

  it('Android and iOS implement the same methods', function () {
    const java = matchAll(javaText, /case "(\w+)":/g)
    const swift = matchAll(swiftText, /if name == "(\w+)"/g)

    expect(java).deep.equals(swift)
    expect(java).deep.equals(declared)
  })

  it('every Java native declaration has a JNI symbol', function () {
    const java = matchAll(javaText, /private native [\w[\]]+ (\w+)\(/g)
    const jni = matchAll(
      jniText,
      /Java_app_edge_reactnative_core_EdgeNative_(\w+)\(/g
    )

    expect(java).deep.equals(jni)
  })
})
