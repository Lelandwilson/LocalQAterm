#!/bin/bash

# QAterm vLLM Model Server Startup Script
# This script starts the vLLM model server in the background

# Configuration
MODEL_PATH="/home/phind-container/models/phind-codellama-34b-v2.Q4_K_M.gguf"
VLLM_PATH="vllm"
SOCKET_PATH="/tmp/qa-vllm-server.sock"
LOG_FILE="/var/log/qa-vllm-server.log"
PID_FILE="/var/run/qa-vllm-server.pid"
API_PORT=8000

# Function to check if server is already running
check_running() {
    if [ -f "$PID_FILE" ]; then
        PID=$(cat "$PID_FILE")
        if ps -p $PID > /dev/null 2>&1; then
            echo "vLLM Model server is already running (PID: $PID)"
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
    echo "Starting QAterm vLLM Model Server..."
    
    # Set environment variables
    export MODEL_PATH="$MODEL_PATH"
    export VLLM_PATH="$VLLM_PATH"
    export SOCKET_PATH="$SOCKET_PATH"
    export API_PORT="$API_PORT"
    export CONTEXT_SIZE=16384
    export MAX_TOKENS=1024
    export MAX_CONCURRENT_REQUESTS=10
    export TENSOR_PARALLEL_SIZE=1
    
    # Start the server in background
    nohup node vllmServer.js > "$LOG_FILE" 2>&1 &
    SERVER_PID=$!
    
    # Save PID
    echo $SERVER_PID > "$PID_FILE"
    
    # Wait a moment for server to start
    sleep 5
    
    # Check if server started successfully
    if ps -p $SERVER_PID > /dev/null 2>&1; then
        echo "✅ vLLM Model server started successfully (PID: $SERVER_PID)"
        echo "📝 Log file: $LOG_FILE"
        echo "🔌 Socket: $SOCKET_PATH"
        echo "🌐 API: http://localhost:$API_PORT"
        return 0
    else
        echo "❌ Failed to start vLLM Model server"
        rm -f "$PID_FILE"
        return 1
    fi
}

# Function to stop the server
stop_server() {
    if [ -f "$PID_FILE" ]; then
        PID=$(cat "$PID_FILE")
        if ps -p $PID > /dev/null 2>&1; then
            echo "Stopping vLLM Model server (PID: $PID)..."
            kill $PID
            sleep 3
            if ps -p $PID > /dev/null 2>&1; then
                echo "Force killing server..."
                kill -9 $PID
            fi
            rm -f "$PID_FILE"
            echo "✅ vLLM Model server stopped"
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
        echo "✅ vLLM Model server is running (PID: $PID)"
        echo "📝 Log file: $LOG_FILE"
        echo "🔌 Socket: $SOCKET_PATH"
        echo "🌐 API: http://localhost:$API_PORT"
        
        # Show recent log entries
        if [ -f "$LOG_FILE" ]; then
            echo ""
            echo "Recent log entries:"
            tail -5 "$LOG_FILE"
        fi
        
        # Check API health
        echo ""
        echo "API Health Check:"
        if curl -s http://localhost:$API_PORT/health > /dev/null 2>&1; then
            echo "✅ vLLM API is responding"
        else
            echo "❌ vLLM API is not responding"
        fi
    else
        echo "❌ vLLM Model server is not running"
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

# Function to install vLLM
install_vllm() {
    echo "Installing vLLM..."
    pip install vllm
    
    if command -v vllm > /dev/null 2>&1; then
        echo "✅ vLLM installed successfully"
        echo "Version: $(vllm --version)"
    else
        echo "❌ Failed to install vLLM"
        exit 1
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
    install)
        install_vllm
        ;;
    *)
        echo "Usage: $0 {start|stop|restart|status|logs|install}"
        echo ""
        echo "Commands:"
        echo "  start   - Start the vLLM model server"
        echo "  stop    - Stop the vLLM model server"
        echo "  restart - Restart the vLLM model server"
        echo "  status  - Show server status and health"
        echo "  logs    - Show live log output"
        echo "  install - Install vLLM (if not already installed)"
        exit 1
        ;;
esac 