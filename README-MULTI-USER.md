# QAterm Multi-User Setup

This document explains how to set up and use the multi-user version of QAterm, which allows multiple users to share a single model instance.

## Architecture

The multi-user setup consists of:

1. **Model Server** (`modelServer.js`) - A background service that loads the model once and handles multiple client connections
2. **Socket Client** (`phindSocketClient.js`) - A client that connects to the model server via Unix domain sockets
3. **Multi-User Interface** (`index-multi.js`) - The main application that can use either direct or socket-based connections

## Benefits

- ✅ **Resource Efficiency**: Single model instance shared across all users
- ✅ **Security**: Unix domain sockets (no network exposure)
- ✅ **Performance**: No network overhead, direct local communication
- ✅ **Backward Compatibility**: Falls back to direct mode if server unavailable
- ✅ **User Isolation**: Each user has separate conversation context

## Setup Instructions

### 1. Start the Model Server

First, start the model server in the background:

```bash
# Option 1: Use the startup script
./start-server.sh start

# Option 2: Run directly
node modelServer.js
```

The server will:
- Load the model into GPU memory once
- Create a Unix domain socket at `/tmp/qa-model-server.sock`
- Wait for client connections

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
./start-server.sh status
```

### View Server Logs
```bash
./start-server.sh logs
```

### Stop Server
```bash
./start-server.sh stop
```

### Restart Server
```bash
./start-server.sh restart
```

## Configuration

The multi-user setup is configured in `config.json`:

```json
{
  "server": {
    "enabled": true,
    "socketPath": "/tmp/qa-model-server.sock",
    "maxConcurrentUsers": 10,
    "autoStart": false
  }
}
```

## Special Commands

The multi-user version includes additional commands:

- `\mode` - Show connection mode (Shared Model Server vs Direct Process)
- `\status` - Enhanced status showing connection mode
- `\context` - Context usage information
- `\help` - List all available commands

## Fallback Mode

If the model server is not running, the application automatically falls back to direct mode:

```
⚠️  Model server not available, using direct mode
✔ Connected to Phind-34B (direct mode)
```

## Troubleshooting

### Server Won't Start
1. Check if the model path is correct
2. Verify llama-simple-chat is available
3. Check GPU memory availability
4. View logs: `./start-server.sh logs`

### Clients Can't Connect
1. Verify server is running: `./start-server.sh status`
2. Check socket file exists: `ls -la /tmp/qa-model-server.sock`
3. Ensure proper permissions

### Performance Issues
1. Monitor GPU memory usage
2. Check server logs for errors
3. Consider reducing `maxConcurrentUsers` in config

## Security Considerations

- Unix domain sockets are local-only (no network exposure)
- Each user's context is isolated
- No authentication required (relies on Unix user system)
- Socket file permissions control access

## Performance Monitoring

Monitor the server with:
```bash
# Check active connections
./start-server.sh status

# Monitor logs in real-time
./start-server.sh logs

# Check GPU usage
nvidia-smi
```

## Migration from Single-User

To migrate from the single-user version:

1. Stop any running `qa` processes
2. Start the model server: `./start-server.sh start`
3. Use `node index-multi.js` instead of `node index.js`
4. The application will automatically detect and use the shared model

## File Structure

```
QAtermPhind/
├── modelServer.js          # Model server (shared model instance)
├── phindSocketClient.js    # Socket-based client
├── index-multi.js          # Multi-user interface
├── start-server.sh         # Server management script
├── config.json             # Configuration (updated for multi-user)
├── phindClient.js          # Original direct client (fallback)
└── index.js               # Original single-user interface
``` 