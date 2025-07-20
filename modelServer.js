#!/usr/bin/env node

// QAterm Model Server
// Handles multiple client connections to a single loaded model instance

import { spawn } from 'child_process';
import { createServer } from 'net';
import { unlink, existsSync } from 'fs';
import { EventEmitter } from 'events';
import chalk from 'chalk';
import ora from 'ora';

class ModelServer extends EventEmitter {
  constructor(config = {}) {
    super();
    this.config = {
      modelPath: config.modelPath || "/home/phind-container/models/phind-codellama-34b-v2.Q4_K_M.gguf",
      llamaPath: config.llamaPath || "/home/llama.cpp/build/bin/llama-simple-chat",
      gpuLayers: config.gpuLayers || 99,
      contextSize: config.contextSize || 16384,
      temperature: config.temperature || 0.7,
      maxTokens: config.maxTokens || 1024,
      socketPath: config.socketPath || "/tmp/qa-model-server.sock",
      maxConcurrentUsers: config.maxConcurrentUsers || 10,
      ...config
    };

    this.process = null;
    this.isConnected = false;
    this.clients = new Map(); // Map of client connections
    this.requestQueue = []; // Queue for pending requests
    this.currentRequest = null;
    this.server = null;
  }

  async start() {
    console.log(chalk.blue('🚀 Starting QAterm Model Server...'));
    
    // Clean up existing socket if it exists
    if (existsSync(this.config.socketPath)) {
      unlink(this.config.socketPath, (err) => {
        if (err && err.code !== 'ENOENT') {
          console.error('Error removing existing socket:', err);
        }
      });
    }

    // Start the model process
    await this.connectToModel();
    
    // Start the Unix domain socket server
    await this.startSocketServer();
    
    console.log(chalk.green('✅ Model Server ready for connections'));
    console.log(chalk.gray(`Socket: ${this.config.socketPath}`));
  }

  async connectToModel() {
    return new Promise((resolve, reject) => {
      const spinner = ora('Loading model...').start();
      
      const args = [
        '-m', this.config.modelPath,
        '-ngl', this.config.gpuLayers.toString(),
        '-c', this.config.contextSize.toString()
      ];

      this.process = spawn(this.config.llamaPath, args, {
        stdio: ['pipe', 'pipe', 'pipe']
      });

      let buffer = '';
      let isReady = false;

      this.process.stdout.on('data', (data) => {
        const chunk = data.toString();
        buffer += chunk;
        
        // Check for ready indicators
        if (!isReady && (
          buffer.includes('llama_simple_chat') || 
          buffer.includes('>') ||
          buffer.includes('User:') ||
          buffer.includes('Assistant:') ||
          buffer.includes('main:') ||
          buffer.includes('ggml') ||
          buffer.includes('model loaded') ||
          buffer.includes('ready') ||
          buffer.includes('prompt:') ||
          buffer.includes('system:')
        )) {
          isReady = true;
          this.isConnected = true;
          spinner.succeed('Model loaded successfully');
          resolve();
        }
      });

      this.process.stderr.on('data', (data) => {
        const chunk = data.toString();
        if (!chunk.match(/^\.+$/)) {
          console.error('STDERR:', chunk);
        }
      });

      this.process.on('error', (error) => {
        spinner.fail('Failed to start model process');
        reject(error);
      });

      this.process.on('close', (code) => {
        console.error(`Model process closed with code: ${code}`);
        this.isConnected = false;
        this.emit('disconnected', code);
      });

      // Timeout after 60 seconds
      setTimeout(() => {
        if (!isReady) {
          spinner.fail('Model loading timeout');
          reject(new Error('Model loading timeout'));
        }
      }, 60000);
    });
  }

  async startSocketServer() {
    return new Promise((resolve) => {
      this.server = createServer((socket) => {
        this.handleClientConnection(socket);
      });

      this.server.listen(this.config.socketPath, () => {
        console.log(chalk.green(`✅ Socket server listening on ${this.config.socketPath}`));
        resolve();
      });

      this.server.on('error', (error) => {
        console.error('Socket server error:', error);
      });
    });
  }

  handleClientConnection(socket) {
    const clientId = `${socket.remoteAddress}-${Date.now()}`;
    console.log(chalk.cyan(`🔌 New client connected: ${clientId}`));
    
    this.clients.set(clientId, {
      socket,
      userId: null,
      username: null,
      context: [],
      currentTokenCount: 0
    });

    socket.on('data', (data) => {
      try {
        const message = JSON.parse(data.toString());
        this.handleClientMessage(clientId, message);
      } catch (error) {
        console.error('Error parsing client message:', error);
        this.sendToClient(clientId, { type: 'error', message: 'Invalid message format' });
      }
    });

    socket.on('close', () => {
      console.log(chalk.yellow(`🔌 Client disconnected: ${clientId}`));
      this.clients.delete(clientId);
    });

    socket.on('error', (error) => {
      console.error(`Client ${clientId} error:`, error);
      this.clients.delete(clientId);
    });

    // Send welcome message
    this.sendToClient(clientId, { 
      type: 'connected', 
      message: 'Connected to QAterm Model Server',
      serverInfo: {
        modelPath: this.config.modelPath,
        contextSize: this.config.contextSize,
        maxTokens: this.config.maxTokens
      }
    });
  }

  handleClientMessage(clientId, message) {
    const client = this.clients.get(clientId);
    if (!client) return;

    switch (message.type) {
      case 'authenticate':
        this.authenticateClient(clientId, message);
        break;
      case 'sendMessage':
        this.handleSendMessage(clientId, message);
        break;
      case 'clearContext':
        this.clearClientContext(clientId);
        break;
      case 'getStatus':
        this.sendStatus(clientId);
        break;
      default:
        this.sendToClient(clientId, { type: 'error', message: 'Unknown message type' });
    }
  }

  authenticateClient(clientId, message) {
    const client = this.clients.get(clientId);
    if (!client) return;

    // Simple authentication - in production, you'd want proper auth
    client.userId = message.userId || process.getuid();
    client.username = message.username || process.env.USER || 'unknown';
    
    console.log(chalk.green(`👤 Client authenticated: ${client.username} (${client.userId})`));
    
    this.sendToClient(clientId, { 
      type: 'authenticated', 
      userId: client.userId,
      username: client.username
    });
  }

  async handleSendMessage(clientId, message) {
    const client = this.clients.get(clientId);
    if (!client) return;

    // Add to request queue
    this.requestQueue.push({
      clientId,
      message: message.content,
      resolve: (response) => {
        this.sendToClient(clientId, { 
          type: 'response', 
          content: response,
          messageId: message.messageId
        });
      },
      reject: (error) => {
        this.sendToClient(clientId, { 
          type: 'error', 
          message: error.message,
          messageId: message.messageId
        });
      }
    });

    // Process queue if not currently processing
    if (!this.currentRequest) {
      this.processQueue();
    }
  }

  async processQueue() {
    if (this.requestQueue.length === 0) return;

    this.currentRequest = this.requestQueue.shift();
    const { clientId, message, resolve, reject } = this.currentRequest;

    try {
      const response = await this.sendToModel(message);
      resolve(response);
    } catch (error) {
      reject(error);
    } finally {
      this.currentRequest = null;
      
      // Process next request if any
      if (this.requestQueue.length > 0) {
        this.processQueue();
      }
    }
  }

  async sendToModel(message) {
    if (!this.isConnected || !this.process) {
      throw new Error('Model not connected');
    }

    return new Promise((resolve, reject) => {
      let responseBuffer = '';
      let isComplete = false;
      const timeout = 60000;

      const timeoutId = setTimeout(() => {
        if (!isComplete) {
          reject(new Error('Response timeout'));
        }
      }, timeout);

      const dataHandler = (data) => {
        const chunk = data.toString();
        responseBuffer += chunk;

        // Check for completion patterns
        if (chunk.includes('<|im_end|>') || 
            chunk.includes('>') || 
            chunk.includes('User:') ||
            chunk.includes('Assistant:')) {
          isComplete = true;
          clearTimeout(timeoutId);
          
          this.process.stdout.removeListener('data', dataHandler);
          
          const cleanedResponse = this.cleanResponse(responseBuffer);
          resolve(cleanedResponse);
        }
      };

      this.process.stdout.on('data', dataHandler);
      this.process.stdin.write(message + '\n');
    });
  }

  cleanResponse(response) {
    // Remove metadata and system messages
    let cleaned = response
      .replace(/<\|im_start\|>system.*?<\|im_end\|>/gs, '')
      .replace(/<\|im_start\|>user.*?<\|im_end\|>/gs, '')
      .replace(/<\|im_start\|>assistant.*?<\|im_end\|>/gs, '')
      .replace(/llama_simple_chat.*?>/g, '')
      .replace(/User:.*?>/g, '')
      .replace(/Assistant:.*?>/g, '')
      .replace(/<\|im_end\|>/g, '')
      .trim();

    // Remove any trailing system messages
    const lines = cleaned.split('\n');
    const userLines = [];
    let foundUserContent = false;

    for (const line of lines) {
      if (line.trim() && !line.includes('llama_simple_chat') && !line.includes('User:') && !line.includes('Assistant:')) {
        userLines.push(line);
        foundUserContent = true;
      } else if (foundUserContent && line.trim()) {
        break;
      }
    }

    return userLines.join('\n').trim();
  }

  clearClientContext(clientId) {
    const client = this.clients.get(clientId);
    if (client) {
      client.context = [];
      client.currentTokenCount = 0;
      this.sendToClient(clientId, { type: 'contextCleared' });
    }
  }

  sendStatus(clientId) {
    const client = this.clients.get(clientId);
    if (!client) return;

    this.sendToClient(clientId, {
      type: 'status',
      connected: this.isConnected,
      activeClients: this.clients.size,
      queueLength: this.requestQueue.length,
      currentRequest: this.currentRequest ? this.currentRequest.clientId : null
    });
  }

  sendToClient(clientId, message) {
    const client = this.clients.get(clientId);
    if (client && client.socket) {
      client.socket.write(JSON.stringify(message) + '\n');
    }
  }

  async stop() {
    console.log(chalk.yellow('🛑 Stopping Model Server...'));
    
    // Close all client connections
    for (const [clientId, client] of this.clients) {
      client.socket.destroy();
    }
    this.clients.clear();

    // Stop socket server
    if (this.server) {
      this.server.close();
    }

    // Stop model process
    if (this.process) {
      this.process.stdin.write('\x03'); // Send Ctrl+C
      this.process.kill();
    }

    // Clean up socket file
    if (existsSync(this.config.socketPath)) {
      unlink(this.config.socketPath, (err) => {
        if (err) console.error('Error removing socket file:', err);
      });
    }

    console.log(chalk.green('✅ Model Server stopped'));
  }
}

// Start the server if run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const config = {
    modelPath: process.env.MODEL_PATH || "/home/phind-container/models/phind-codellama-34b-v2.Q4_K_M.gguf",
    llamaPath: process.env.LLAMA_PATH || "/home/llama.cpp/build/bin/llama-simple-chat",
    socketPath: process.env.SOCKET_PATH || "/tmp/qa-model-server.sock",
    gpuLayers: parseInt(process.env.GPU_LAYERS) || 99,
    contextSize: parseInt(process.env.CONTEXT_SIZE) || 16384,
    maxTokens: parseInt(process.env.MAX_TOKENS) || 1024,
    maxConcurrentUsers: parseInt(process.env.MAX_USERS) || 10
  };

  const server = new ModelServer(config);
  
  // Handle graceful shutdown
  process.on('SIGINT', async () => {
    await server.stop();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    await server.stop();
    process.exit(0);
  });

  server.start().catch((error) => {
    console.error(chalk.red('Failed to start Model Server:'), error.message);
    process.exit(1);
  });
}

export default ModelServer; 