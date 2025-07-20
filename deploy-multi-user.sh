#!/bin/bash

# QAterm Multi-User Deployment Script
# This script helps deploy the multi-user version to your cloud server

# Configuration - UPDATE THESE FOR YOUR SERVER
SERVER_USER="root"
SERVER_HOST="your-server-ip-or-hostname"
SERVER_PATH="/home/LocalQAterm"

# Files to deploy
FILES=(
    "modelServer.js"
    "phindSocketClient.js"
    "index-multi.js"
    "start-server.sh"
    "README-MULTI-USER.md"
    "config.json"
)

echo "🚀 Deploying QAterm Multi-User to server..."
echo "Server: $SERVER_USER@$SERVER_HOST:$SERVER_PATH"
echo ""

# Check if files exist
for file in "${FILES[@]}"; do
    if [ ! -f "$file" ]; then
        echo "❌ Error: $file not found"
        exit 1
    fi
done

echo "✅ All files found locally"

# Deploy files
echo ""
echo "📤 Uploading files to server..."

for file in "${FILES[@]}"; do
    echo "  Uploading $file..."
    scp "$file" "$SERVER_USER@$SERVER_HOST:$SERVER_PATH/"
done

echo ""
echo "🔧 Setting up server..."

# Make startup script executable and start server
ssh "$SERVER_USER@$SERVER_HOST" << 'EOF'
cd /home/LocalQAterm

# Make startup script executable
chmod +x start-server.sh

# Stop any existing server
./start-server.sh stop 2>/dev/null || true

# Start the new server
./start-server.sh start

echo ""
echo "✅ Multi-user setup complete!"
echo ""
echo "To test:"
echo "1. SSH to your server"
echo "2. Run: node index-multi.js"
echo "3. In another terminal, run: node index-multi.js"
echo ""
echo "Server management:"
echo "  ./start-server.sh status  # Check status"
echo "  ./start-server.sh logs    # View logs"
echo "  ./start-server.sh stop    # Stop server"
EOF

echo ""
echo "🎉 Deployment complete!"
echo ""
echo "Next steps:"
echo "1. SSH to your server: ssh $SERVER_USER@$SERVER_HOST"
echo "2. Test multi-user: node index-multi.js"
echo "3. Check server status: ./start-server.sh status" 