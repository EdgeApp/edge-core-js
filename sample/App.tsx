import React, { useEffect, useState } from 'react'
import {
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  View,
  Alert,
} from 'react-native'
import EdgeCore from 'edge-core-js/src/NativeEdgeCore'

const App: React.FC = () => {
  const [randomData, setRandomData] = useState<string>('')
  const [diskletData, setDiskletData] = useState<string>('')

  useEffect(() => {
    testTurboModule()
  }, [])

  const testTurboModule = async () => {
    try {
      // Test randomBytes
      const random = await EdgeCore.randomBytes(16)
      setRandomData(random)
      
      // Test disklet operations
      await EdgeCore.diskletSetText('test.txt', 'Hello TurboModules!')
      const text = await EdgeCore.diskletGetText('test.txt')
      setDiskletData(text)
      
      Alert.alert('Success', 'TurboModule test completed successfully!')
    } catch (error) {
      Alert.alert('Error', `TurboModule test failed: ${error}`)
    }
  }

  return (
    <SafeAreaView style={styles.backgroundStyle}>
      <StatusBar backgroundColor="#6200EE" />
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        style={styles.backgroundStyle}>
        <View style={styles.container}>
          <Text style={styles.title}>Edge Core TurboModule Test</Text>
          
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Random Bytes (Base64):</Text>
            <Text style={styles.data}>{randomData || 'Loading...'}</Text>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Disklet Data:</Text>
            <Text style={styles.data}>{diskletData || 'Loading...'}</Text>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  backgroundStyle: {
    backgroundColor: '#f5f5f5',
    flex: 1,
  },
  container: {
    padding: 20,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 30,
    color: '#333',
  },
  section: {
    marginBottom: 20,
    padding: 15,
    backgroundColor: 'white',
    borderRadius: 8,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 10,
    color: '#333',
  },
  data: {
    fontSize: 14,
    color: '#666',
    fontFamily: 'monospace',
  },
})

export default App
