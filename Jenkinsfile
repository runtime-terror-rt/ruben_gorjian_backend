pipeline {
    agent {
        docker {
            image 'node:20-alpine' // lightweight Node.js runtime
            args '-u root:root'    // avoid permission issues
        }
    }

    stages {
        stage('Install & Build') {
            steps {
                echo "===== INSTALLING DEPENDENCIES & BUILDING ====="

                sh '''
                    # Fail fast if any command fails
                    set -e

                    # Debug (always good in CI)
                    echo "Node version:"
                    node -v

                    echo "NPM version:"
                    npm -v

                    # Clean install (better than npm install for CI)
                    npm ci

                    # Build project (make sure package.json has "build" script)
                    npm run build
                '''
            }
        }
    }
}
