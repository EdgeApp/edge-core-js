import codegenNativeComponent from 'react-native/Libraries/Utilities/codegenNativeComponent'
import type {
  ViewProps,
  DirectEventHandler,
} from 'react-native/Libraries/Components/View/ViewPropTypes'
import type { HostComponent } from 'react-native'

export interface NativeProps extends ViewProps {
  allowDebugging?: boolean
  source?: string | null
  onMessage?: DirectEventHandler<{ message: string }>
  onScriptError?: DirectEventHandler<{ source: string }>
}

export interface NativeCommands {
  runJs: (viewRef: React.ElementRef<HostComponent<NativeProps>>, js: string) => void
}

export default codegenNativeComponent<NativeProps, NativeCommands>('EdgeCoreWebView')