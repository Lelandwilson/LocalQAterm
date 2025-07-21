# QAterm vLLM Multi-User Setup

This document explains how to set up and use the vLLM-based multi-user version of QAterm, which provides superior performance and parallelism for multiple users.

## Why vLLM?

vLLM is specifically designed for serving large language models with multiple concurrent users:

- ✅ **Dynamic Batching**: Automatically batches requests for efficiency
- ✅ **Better GPU Utilization**: More efficient memory management
- ✅ **Built-in Concurrency**: Handles multiple requests simultaneously
- ✅ **Production Ready**: Used by major AI companies
- ✅ **REST API**: Standard HTTP API for model serving

## Architecture

The vLLM setup consists of:

1. **vLLM Server** (`vllmServer.js`) - Uses vLLM's REST API for model serving
2. **Socket Client** (`phindSocketClient.js`) - Connects to the vLLM server via Unix domain sockets
3. **Multi-User Interface** (`index-multi.js`) - The main application

## Prerequisites

### 1. Install vLLM

```bash
# Install vLLM
pip install vllm

# Verify installation
vllm --version
```

### 2. Install Node.js Dependencies

```bash
npm install
```

## Setup Instructions

### 1. Start the vLLM Model Server

```bash
# Option 1: Use the startup script
./start-vllm-server.sh start

# Option 2: Run directly
node vllmServer.js
```

The server will:
- Start vLLM with your model
- Create a REST API on port 8000
- Create a Unix domain socket at `/tmp/qa-vllm-server.sock`
- Handle multiple concurrent requests efficiently

### 2. Connect Multiple Users

Each user can now connect to the shared model:

```bash
# User 1
user1@server:~$ node index-multi.js

# User 2 (in another terminal/SSH session)
user2@server:~$ node index-multi.js

# User 3 (in another terminal/SSH session)
user3@server:~$ node index-multi.js
```

### 3. Verify Multi-User Operation

Each user will see:
```
  ____  _____      ___      _   _                      
 | __ )|  ___|    / _ \    / \ | |_ ___ _ __ _ __ ___  
 |  _ \| |_ _____| | | |  / _ \| __/ _ \ '__| '_ ` _ \ 
 | |_) |  _|_____| |_| | / ___ \ ||  __/ |  | | | | | |
 |____/|_|        \__\_\/_/   \_\__\___|_|  |_| |_| |_|
                                                       
Local Phind-34B Coding Assistant (Multi-User)

✔ Connected to shared model server

phind> Hello, I'm user1
```

## Server Management

### Check Server Status
```bash
./start-vllm-server.sh status
```

### View Server Logs
```bash
./start-vllm-server.sh logs
```

### Stop Server
```bash
./start-vllm-server.sh stop
```

### Restart Server
```bash
./start-vllm-server.sh restart
```

### Install vLLM
```bash
./start-vllm-server.sh install
```

## Configuration

The vLLM setup is configured in `config.json`:

```json
{
  "phind": {
    "modelPath": "/home/phind-container/models/phind-codellama-34b-v2.Q4_K_M.gguf",
    "vllmPath": "vllm",
    "maxConcurrentRequests": 10,
    "tensorParallelSize": 1
  },
  "server": {
    "enabled": true,
    "socketPath": "/tmp/qa-vllm-server.sock",
    "maxConcurrentUsers": 10,
    "autoStart": false
  }
}
```

## vLLM vs llama.cpp Comparison

| Feature | llama.cpp | vLLM |
|---------|-----------|------|
| **Concurrent Requests** | Manual queue | Built-in batching |
| **GPU Memory** | Less efficient | Optimized |
| **Request Handling** | Single-threaded | Multi-threaded |
| **Production Ready** | Basic | Enterprise-grade |
| **API** | Custom | REST API |
| **Performance** | Good | Excellent |

## Performance Benefits

### Before (llama.cpp):
- Single request at a time
- Manual request queuing
- Basic GPU utilization
- ~2-3 concurrent users max

### After (vLLM):
- Multiple concurrent requests
- Dynamic request batching
- Optimized GPU utilization
- ~10+ concurrent users

## Troubleshooting

### vLLM Not Installed
```bash
./start-vllm-server.sh install
```

### Server Won't Start
1. Check if vLLM is installed: `vllm --version`
2. Verify model path exists
3. Check GPU memory availability
4. View logs: `./start-vllm-server.sh logs`

### API Not Responding
```bash
# Check if vLLM API is running
curl http://localhost:8000/health

# Check server status
./start-vllm-server.sh status
```

### Performance Issues
1. Monitor GPU usage: `nvidia-smi`
2. Check concurrent requests in logs
3. Adjust `maxConcurrentRequests` in config
4. Consider reducing `tensorParallelSize`

## Advanced Configuration

### GPU Memory Optimization
```bash
# For limited GPU memory
export MAX_CONCURRENT_REQUESTS=5
export TENSOR_PARALLEL_SIZE=1

# For multiple GPUs
export TENSOR_PARALLEL_SIZE=2
```

### Model Loading
```bash
# Load model with specific settings
vllm serve /path/to/model.gguf \
  --max-model-len 16384 \
  --max-num-batched-tokens 4096 \
  --max-num-seqs 10 \
  --tensor-parallel-size 1
```

## Migration from llama.cpp

To migrate from the llama.cpp version:

1. Install vLLM: `./start-vllm-server.sh install`
2. Stop old server: `./start-server.sh stop`
3. Start vLLM server: `./start-vllm-server.sh start`
4. Use `node index-multi.js` (same interface)

## File Structure

```
QAtermPhind/
├── vllmServer.js           # vLLM-based model server
├── phindSocketClient.js    # Socket-based client
├── index-multi.js          # Multi-user interface
├── start-vllm-server.sh    # vLLM server management
├── config.json             # Configuration (updated for vLLM)
├── README-VLLM.md          # This documentation
└── package.json            # Dependencies (includes node-fetch)
```

## Monitoring

### Real-time Monitoring
```bash
# Monitor server logs
./start-vllm-server.sh logs

# Check API health
curl http://localhost:8000/health

# Monitor GPU usage
nvidia-smi -l 1
```

### Performance Metrics
- **Concurrent Users**: Check server logs
- **Response Time**: Monitor API calls
- **GPU Utilization**: Use `nvidia-smi`
- **Memory Usage**: Check system resources 