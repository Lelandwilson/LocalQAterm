#!/bin/bash

# QAterm Model Server Startup Script
# This script starts the model server in the background

# Configuration
MODEL_PATH="/home/phind-container/models/phind-codellama-34b-v2.Q4_K_M.gguf"
LLAMA_PATH="/home/llama.cpp/build/bin/llama-simple-chat"
SOCKET_PATH="/tmp/qa-model-server.sock"
LOG_FILE="/var/log/qa-model-server.log"
PID_FILE="/var/run/qa-model-server.pid"

# Function to check if server is already running
check_running() {
    if [ -f "$PID_FILE" ]; then
        PID=$(cat "$PID_FILE")
        if ps -p $PID > /dev/null 2>&1; then
            echo "Model server is already running (PID: $PID)"
            return 0
        else
            echo "Stale PID file found, removing..."
            rm -f "$PID_FILE"
        fi
    fi
    return 1
}

# Function to start the server
start_server() {
    echo "Starting QAterm Model Server..."
    
    # Set environment variables
    export MODEL_PATH="$MODEL_PATH"
    export LLAMA_PATH="$LLAMA_PATH"
    export SOCKET_PATH="$SOCKET_PATH"
    export GPU_LAYERS=99
    export CONTEXT_SIZE=16384
    export MAX_TOKENS=1024
    export MAX_USERS=10
    
    # Start the server in background
    nohup node modelServer.js > "$LOG_FILE" 2>&1 &
    SERVER_PID=$!
    
    # Save PID
    echo $SERVER_PID > "$PID_FILE"
    
    # Wait a moment for server to start
    sleep 3
    
    # Check if server started successfully
    if ps -p $SERVER_PID > /dev/null 2>&1; then
        echo "✅ Model server started successfully (PID: $SERVER_PID)"
        echo "📝 Log file: $LOG_FILE"
        echo "🔌 Socket: $SOCKET_PATH"
        return 0
    else
        echo "❌ Failed to start model server"
        rm -f "$PID_FILE"
        return 1
    fi
}

# Function to stop the server
stop_server() {
    if [ -f "$PID_FILE" ]; then
        PID=$(cat "$PID_FILE")
        if ps -p $PID > /dev/null 2>&1; then
            echo "Stopping model server (PID: $PID)..."
            kill $PID
            sleep 2
            if ps -p $PID > /dev/null 2>&1; then
                echo "Force killing server..."
                kill -9 $PID
            fi
            rm -f "$PID_FILE"
            echo "✅ Model server stopped"
        else
            echo "Server not running"
            rm -f "$PID_FILE"
        fi
    else
        echo "No PID file found"
    fi
}

# Function to show status
show_status() {
    if check_running; then
        PID=$(cat "$PID_FILE")
        echo "✅ Model server is running (PID: $PID)"
        echo "📝 Log file: $LOG_FILE"
        echo "🔌 Socket: $SOCKET_PATH"
        
        # Show recent log entries
        if [ -f "$LOG_FILE" ]; then
            echo ""
            echo "Recent log entries:"
            tail -5 "$LOG_FILE"
        fi
    else
        echo "❌ Model server is not running"
    fi
}

# Function to show logs
show_logs() {
    if [ -f "$LOG_FILE" ]; then
        tail -f "$LOG_FILE"
    else
        echo "Log file not found: $LOG_FILE"
    fi
}

# Main script logic
case "$1" in
    start)
        if check_running; then
            exit 0
        fi
        start_server
        ;;
    stop)
        stop_server
        ;;
    restart)
        stop_server
        sleep 2
        start_server
        ;;
    status)
        show_status
        ;;
    logs)
        show_logs
        ;;
    *)
        echo "Usage: $0 {start|stop|restart|status|logs}"
        echo ""
        echo "Commands:"
        echo "  start   - Start the model server"
        echo "  stop    - Stop the model server"
        echo "  restart - Restart the model server"
        echo "  status  - Show server status"
        echo "  logs    - Show live log output"
        exit 1
        ;;
esac 