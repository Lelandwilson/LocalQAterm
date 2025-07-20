#!/bin/bash

# Setup new directory for multi-user testing
# This script helps create a fresh directory on your server

# Configuration - UPDATE THESE FOR YOUR SERVER
SERVER_USER="root"
SERVER_HOST="your-server-ip-or-hostname"
NEW_DIR="/home/LocalQAterm-multi"
GIT_REPO="https://github.com/Lelandwilson/LocalQAterm.git"

echo "🚀 Setting up new directory for multi-user testing..."
echo "Server: $SERVER_USER@$SERVER_HOST"
echo "New directory: $NEW_DIR"
echo ""

# Create new directory and pull latest code
ssh "$SERVER_USER@$SERVER_HOST" << EOF
echo "📁 Creating new directory..."
mkdir -p $NEW_DIR
cd $NEW_DIR

echo "📥 Pulling latest code from git..."
git clone $GIT_REPO .

echo "📦 Installing dependencies..."
npm install

echo "🔧 Setting up multi-user files..."
chmod +x start-server.sh

echo ""
echo "✅ Setup complete!"
echo ""
echo "Next steps:"
echo "1. Start the model server: ./start-server.sh start"
echo "2. Test multi-user: node index-multi.js"
echo "3. Check status: ./start-server.sh status"
EOF

echo ""
echo "🎉 New directory setup complete!"
echo ""
echo "To test:"
echo "1. SSH to your server: ssh $SERVER_USER@$SERVER_HOST"
echo "2. Navigate to: cd $NEW_DIR"
echo "3. Start server: ./start-server.sh start"
echo "4. Test: node index-multi.js" 