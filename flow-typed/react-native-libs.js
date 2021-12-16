// @flow

declare module 'react-native' {
  declare module.exports: any
}

declare module 'react-native-fast-crypto' {
  declare module.exports: any
}

declare module 'react-native-fs' {
  declare module.exports: any
}

declare module 'react-native-webview' {
  declare export type WebViewMessageEvent = {
    nativeEvent: { data: string }
  }

  declare export type CommonNativeWebViewProps = {|
    allowFileAccess?: boolean,
    onMessage?: (message: WebViewMessageEvent) => void,
    originWhitelist?: string[],
    source: { uri: string }
  |}

  declare export class WebView
    extends React$Component<CommonNativeWebViewProps> {
    injectJavaScript(js: string): void;
  }
}
