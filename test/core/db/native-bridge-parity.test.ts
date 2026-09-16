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

  it('both platforms read the same number of arguments', function () {
    /*
     * The test above compares names; this compares arity, which is the other
     * way the five copies drift. Nothing here compiles the Java or the Swift,
     * so a dispatch that reads `args[2]` for a call that carries three
     * arguments is an error only a device finds -- and it finds it as a
     * mis-scoped query or a null path, not as a crash.
     */
    const countArgs = (body: string, pattern: RegExp): number => {
      let highest = -1
      for (const match of body.matchAll(pattern)) {
        highest = Math.max(highest, Number(match[1]))
      }
      return highest + 1
    }

    /**
     * One method's dispatch body.
     *
     * Bounded by its own terminator rather than by the next marker, because
     * the last case in each file is followed by helper functions that also
     * read arguments -- and swallowing those makes the count meaningless in
     * exactly the place nobody checks.
     */
    const slice = (
      text: string,
      markers: RegExp,
      name: string,
      terminator: string
    ): string => {
      const all = [...text.matchAll(markers)]
      const match = all.find(match => match[1] === name)
      if (match?.index == null) return ''
      const rest = text.slice(match.index)
      const end = rest.indexOf(terminator)
      return end < 0 ? rest : rest.slice(0, end)
    }

    for (const method of declared) {
      const javaBody = slice(javaText, /case "(\w+)":/g, method, 'break;')
      const swiftBody = slice(
        swiftText,
        /if name == "(\w+)"/g,
        method,
        // The closing brace of the `if` block, at its own indentation.
        '\n    }'
      )

      const javaArgs = countArgs(javaBody, /args\.\w+\((\d+)\)/g)
      const swiftArgs = countArgs(swiftBody, /args\[(\d+)\]/g)

      // A dispatch that hands the whole argument list to a helper reads no
      // indices of its own, which is not a disagreement. `fetch` does that on
      // Android.
      if (javaArgs === 0 || swiftArgs === 0) continue

      expect(
        javaArgs,
        `${method} reads a different count on each platform`
      ).equals(swiftArgs)
    }
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
