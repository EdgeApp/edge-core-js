module.exports = {
  dependency: {
    platforms: {
      android: {
        sourceDir: '../android',
        packageImportPath: 'import app.edge.reactnative.core.EdgeCorePackage;',
      },
      ios: {
        podspecPath: '../edge-core-js.podspec',
      },
    },
  },
}