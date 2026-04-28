pipeline {
    agent {
        docker {
            image 'node:20-alpine' // lightweight + production-ready
            args '-u root:root'    // avoid permission issues
        }
    }

    stages {
        stage('Install Dependencies') {
            steps {
                echo "================RUBEN================"
                echo "Running inside Node container"
                echo "================RUBEN================"

                sh '''
                    # Verify runtime
                    node -v
                    npm -v

                    # Install dependencies
                    npm install
                '''
            }
        }
    }
}
