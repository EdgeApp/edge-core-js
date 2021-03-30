pipeline {
  agent any
  tools {
    nodejs 'v8.12.0'
  }
  options {
    timestamps()
    skipDefaultCheckout true
    overrideIndexTriggers false
    buildDiscarder logRotator(artifactDaysToKeepStr: '', artifactNumToKeepStr: '', daysToKeepStr: '7', numToKeepStr: '10')
  }
  triggers {
    pollSCM('H/5 * * * *')
  }

  stages {
    stage("Clean") {
      steps {
        deleteDir()
        checkout scm
      }
    }

    stage ("Install") {
      steps {
        sh "yarn"
      }
    }

    stage ("Test") {
      steps {
        sh "yarn test"
      }
    }
  }

  post {
    always {
      echo 'Setting the build version'
      script {
        def packageJson = readJSON file: "./package.json"
        currentBuild.description = "[version] ${packageJson.version}"
      }
      echo 'Cleaning the workspace'
      deleteDir()
    }
    success {
      echo "The force is strong with this one"
    }
    unstable {
      echo "Do or do not there is no try"
    }
    failure {
      echo "The dark side I sense in you."
    }
  }
}
