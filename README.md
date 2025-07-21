# QAterm - Local Phind-34B Coding Assistant

A streamlined terminal application for local AI coding assistance using Phind-34B, a 34B parameter model fine-tuned for code understanding and generation.

## 🚀 Multi-User Support

This project now supports multiple deployment options:

- **Single User** (`master` branch): Direct llama.cpp integration
- **Multi-User** (`fundamental-changes` branch): Shared model server with Unix sockets
- **vLLM Multi-User** (`vLLM` branch): Enterprise-grade vLLM with REST API

### Quick Start Guide

**For Single User:**
```bash
git checkout master
npm install
node index.js
```

**For Multi-User (llama.cpp):**
```bash
git checkout fundamental-changes
npm install
./start-server.sh start
node index-multi.js
```

**For vLLM Multi-User (Recommended):**
```bash
git checkout vLLM
npm install
pip install vllm
./start-vllm-server.sh start
node index-multi.js
```

### Performance Comparison

| Feature | Single User | Multi-User (llama.cpp) | Multi-User (vLLM) |
|---------|-------------|------------------------|-------------------|
| **Concurrent Users** | 1 | 2-3 | 10+ |
| **GPU Efficiency** | Good | Basic | Excellent |
| **Request Handling** | Direct | Manual Queue | Dynamic Batching |
| **Production Ready** | No | Basic | Yes |

## Features

- 🤖 **Local AI Model**: Uses Phind-34B running on your cloud VM with A100 GPU
- 💬 **Persistent Context**: Maintains conversation history across sessions
- 🎨 **Beautiful Terminal UI**: Clean, colourful interface with real-time responses
- ⚙️ **Simple Configuration**: Easy setup for local model parameters
- 🔒 **Privacy First**: All processing happens locally on your infrastructure
- 💻 **Coding Focused**: Optimised for code generation, explanation, and refactoring
- 📁 **Project Context**: Maintains project-specific context in markdown files
- 🚀 **Fast Inference**: Leverages CUDA-accelerated GGML with full GPU offload

## Prerequisites

### Cloud VM Setup
You need a cloud VM with:
- **NVIDIA A100 GPU** (80GB recommended)
- **Ubuntu 20.04+** environment
- **CUDA 12.4** support
- **llama.cpp** compiled with CUDA support

### Model Installation
```bash
# On your cloud VM
cd ~/llama.cpp
# Download Phind-34B model
wget https://huggingface.co/TheBloke/phind-codellama-34b-v2-GGUF/resolve/main/phind-codellama-34b-v2.Q4_K_M.gguf
```

## Installation

1. **Clone or create the files**:
   - `index.js` - Main application
   - `phindClient.js` - Phind model integration
   - `config.json` - Configuration settings
   - `package.json` - Dependencies

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Configure your model path** in `config.json`:
   ```json
   {
     "phind": {
       "modelPath": "~/llama.cpp/models/phind-codellama-34b-v2.Q4_K_M.gguf",
       "llamaPath": "~/llama.cpp/build/bin/llama-simple-chat"
     }
   }
   ```

4. **Make executable**:
   ```bash
   chmod +x index.js
   ```

## Usage

### Start the application:
```bash
npm start
```

Or use directly:
```bash
qa
```

### Commands

- **Default**: Interactive chat mode
- **\\help**: Show available commands
- **\\exit** or **\\quit**: Exit the application
- **\\clear**: Clear conversation history
- **\\save**: Save conversation to file
- **\\status**: Show connection status

### In Chat Mode

- Type your coding questions and get AI responses
- The model maintains context across your conversation
- Responses are cleaned of metadata for a snappy experience
- Conversation history is automatically saved to `current.md`

## Configuration

The application uses `config.json` for configuration:

```json
{
  "phind": {
    "modelPath": "~/llama.cpp/models/phind-codellama-34b-v2.Q4_K_M.gguf",
    "llamaPath": "~/llama.cpp/build/bin/llama-simple-chat",
    "gpuLayers": 99,
    "contextSize": 8192,
    "temperature": 0.7,
    "maxTokens": 2048
  },
  "interface": {
    "maxContextMessages": 50,
    "showTimestamps": false,
    "streamResponses": true
  },
  "coding": {
    "enabled": true,
    "projectContextFile": "ai.md",
    "currentContextFile": "current.md",
    "autoSaveContext": true
  }
}
```

## Model Specifications

- **Model**: phind-codellama-34b-v2.Q4_K_M.gguf
- **Parameters**: 34B (quantized for efficiency)
- **Context**: 8192 tokens for deep, multi-turn coding tasks
- **Optimisation**: Q4_K_M quantization for memory efficiency
- **Specialisation**: Fine-tuned for code understanding and generation

## Runtime Backend

- **Framework**: llama.cpp compiled with CUDA support
- **GPU Acceleration**: Full GPU offload with 99 layers
- **Context Management**: 8192 token context window
- **Interface**: Direct subprocess communication

## Global Installation

To install globally:
```bash
npm install -g .
```

Then use `qa` from anywhere.

## Development

For development with auto-restart:
```bash
npm run dev
```

## Troubleshooting

### Connection Issues
- Ensure Phind-34B is running on your cloud VM
- Check model path in `config.json`
- Verify llama.cpp is compiled with CUDA support

### Performance Issues
- Ensure A100 GPU is available and CUDA is working
- Check GPU memory usage
- Consider reducing `gpuLayers` if memory is constrained

### Model Issues
- Verify model file exists and is not corrupted
- Check model path in configuration
- Ensure sufficient disk space for model loading

## Dependencies

### Core Dependencies
- **chalk**: Terminal styling
- **figlet**: ASCII art logos
- **gradient-string**: Gradient text effects
- **ora**: Terminal spinners
- **commander**: CLI framework
- **inquirer**: Interactive prompts
- **dotenv**: Environment variable management

### Multi-User Dependencies (fundamental-changes branch)
- All core dependencies
- **Unix domain sockets**: For secure local communication

### vLLM Dependencies (vLLM branch)
- All core dependencies
- **node-fetch**: For REST API communication
- **vLLM**: Python package for model serving
- **Unix domain sockets**: For secure local communication

## Architecture

### Single User (master branch)
```
QAterm (Single User)
├── Core Interface (index.js)
├── Phind Client (phindClient.js)
├── Context Manager (built-in)
├── Terminal UI (built-in)
└── Configuration (config.json)
```

### Multi-User (fundamental-changes branch)
```
QAterm (Multi-User)
├── Model Server (modelServer.js)
├── Socket Client (phindSocketClient.js)
├── Multi-User Interface (index-multi.js)
├── Unix Socket Communication
└── Shared Model Instance
```

### vLLM Multi-User (vLLM branch) ⭐
```
QAterm (vLLM Multi-User)
├── vLLM Server (vllmServer.js)
├── REST API (port 8000)
├── Socket Client (phindSocketClient.js)
├── Multi-User Interface (index-multi.js)
├── Dynamic Request Batching
└── Enterprise-Grade Performance
```

## Security & Privacy

- **Local Processing**: All AI processing happens on your infrastructure
- **No External APIs**: No data sent to third-party services
- **Air-gapped**: Can run in completely isolated environments
- **Model Control**: Full control over model parameters and configuration

## Performance

- **Fast Inference**: CUDA-accelerated with full GPU offload
- **Efficient Memory**: Q4 quantization reduces memory requirements
- **Context Management**: Smart context truncation to maintain performance
- **Streaming**: Real-time response streaming for better UX

## Future Enhancements

- **Database Integration**: User management and conversation history
- **Smart Menus**: Interactive conversation management
- **Vector Search**: Semantic search across conversations
- **WebSocket API**: HTTP server mode for IDE integration
- **Code Analysis**: Advanced code understanding and refactoring
- **Project Templates**: Automated project setup and scaffolding
- **Multi-file Context**: Understanding across entire codebases

## Branch Overview

### `master` - Single User (Current)
- Direct llama.cpp integration
- Simple, single-user setup
- Good for personal use

### `fundamental-changes` - Multi-User (llama.cpp)
- Shared model server via Unix sockets
- Manual request queuing
- Basic multi-user support
- Good for small teams

### `vLLM` - Multi-User (vLLM) ⭐ **Recommended**
- Enterprise-grade vLLM integration
- Dynamic request batching
- REST API with built-in concurrency
- Production-ready for large teams
- Superior GPU utilization
