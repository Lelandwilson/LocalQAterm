#!/usr/bin/env node

// QAterm vLLM Model Server
// Uses vLLM for better multi-user parallelism and performance

import { spawn } from 'child_process';
import { createServer } from 'net';
import { unlink, existsSync } from 'fs';
import { EventEmitter } from 'events';
import chalk from 'chalk';
import ora from 'ora';
import fetch from 'node-fetch';

class VLLMServer extends EventEmitter {
  constructor(config = {}) {
    super();
    this.config = {
      modelPath: config.modelPath || "/home/phind-container/models/phind-codellama-34b-v2.Q4_K_M.gguf",
      vllmPath: config.vllmPath || "vllm",
      contextSize: config.contextSize || 16384,
      temperature: config.temperature || 0.7,
      maxTokens: config.maxTokens || 1024,
      maxConcurrentRequests: config.maxConcurrentRequests || 10,
      tensorParallelSize: config.tensorParallelSize || 1,
      socketPath: config.socketPath || "/tmp/qa-vllm-server.sock",
      apiPort: config.apiPort || 8000,
      ...config
    };

    this.process = null;
    this.isConnected = false;
    this.clients = new Map(); // Map of client connections
    this.requestQueue = []; // Queue for pending requests
    this.currentRequest = null;
    this.server = null;
    this.apiUrl = `http://localhost:${this.config.apiPort}`;
  }

  async start() {
    console.log(chalk.blue('🚀 Starting QAterm vLLM Model Server...'));
    
    // Clean up existing socket if it exists
    if (existsSync(this.config.socketPath)) {
      unlink(this.config.socketPath, (err) => {
        if (err && err.code !== 'ENOENT') {
          console.error('Error removing existing socket:', err);
        }
      });
    }

    // Start the vLLM server
    await this.startVLLMServer();
    
    // Wait for vLLM to be ready
    await this.waitForVLLMReady();
    
    // Start the Unix domain socket server
    await this.startSocketServer();
    
    console.log(chalk.green('✅ vLLM Model Server ready for connections'));
    console.log(chalk.gray(`Socket: ${this.config.socketPath}`));
    console.log(chalk.gray(`API: ${this.apiUrl}`));
  }

  async startVLLMServer() {
    return new Promise((resolve, reject) => {
      const spinner = ora('Starting vLLM server...').start();
      
      const args = [
        'serve',
        this.config.modelPath,
        '--host', '0.0.0.0',
        '--port', this.config.apiPort.toString(),
        '--max-model-len', this.config.contextSize.toString(),
        '--max-num-batched-tokens', '4096',
        '--max-num-seqs', this.config.maxConcurrentRequests.toString(),
        '--tensor-parallel-size', this.config.tensorParallelSize.toString(),
        '--trust-remote-code'
      ];

      console.log(`Executing: ${this.config.vllmPath} ${args.join(' ')}`);

      this.process = spawn(this.config.vllmPath, args, {
        stdio: ['pipe', 'pipe', 'pipe']
      });

      let buffer = '';
      let isReady = false;

      this.process.stdout.on('data', (data) => {
        const chunk = data.toString();
        buffer += chunk;
        
        // Check for vLLM ready indicators
        if (!isReady && (
          buffer.includes('Uvicorn running') ||
          buffer.includes('INFO:     Started server process') ||
          buffer.includes('INFO:     Application startup complete') ||
          buffer.includes('vLLM engine is ready')
        )) {
          isReady = true;
          this.isConnected = true;
          spinner.succeed('vLLM server started successfully');
          resolve();
        }
      });

      this.process.stderr.on('data', (data) => {
        const chunk = data.toString();
        // Log stderr for debugging
        console.error('STDERR:', chunk);
      });

      this.process.on('error', (error) => {
        spinner.fail('Failed to start vLLM server');
        reject(error);
      });

      this.process.on('close', (code) => {
        console.error(`vLLM process closed with code: ${code}`);
        this.isConnected = false;
        this.emit('disconnected', code);
      });

      // Timeout after 120 seconds (vLLM takes longer to start)
      setTimeout(() => {
        if (!isReady) {
          spinner.fail('vLLM server startup timeout');
          reject(new Error('vLLM server startup timeout'));
        }
      }, 120000);
    });
  }

  async waitForVLLMReady() {
    const spinner = ora('Waiting for vLLM API to be ready...').start();
    
    // Poll the vLLM API until it's ready
    for (let i = 0; i < 60; i++) {
      try {
        const response = await fetch(`${this.apiUrl}/health`);
        if (response.ok) {
          spinner.succeed('vLLM API is ready');
          return;
        }
      } catch (error) {
        // API not ready yet, continue polling
      }
      
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    spinner.fail('vLLM API failed to become ready');
    throw new Error('vLLM API failed to become ready');
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
      message: 'Connected to QAterm vLLM Model Server',
      serverInfo: {
        modelPath: this.config.modelPath,
        contextSize: this.config.contextSize,
        maxTokens: this.config.maxTokens,
        maxConcurrentRequests: this.config.maxConcurrentRequests
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
      const response = await this.sendToVLLM(message);
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

  async sendToVLLM(message) {
    if (!this.isConnected) {
      throw new Error('vLLM server not connected');
    }

    try {
      const response = await fetch(`${this.apiUrl}/v1/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'phind-codellama-34b-v2',
          prompt: message,
          max_tokens: this.config.maxTokens,
          temperature: this.config.temperature,
          stop: ['<|im_end|>', 'User:', 'Assistant:'],
          stream: false
        })
      });

      if (!response.ok) {
        throw new Error(`vLLM API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      
      if (data.choices && data.choices.length > 0) {
        return data.choices[0].text.trim();
      } else {
        throw new Error('No response from vLLM');
      }
    } catch (error) {
      console.error('vLLM API error:', error);
      throw error;
    }
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
      currentRequest: this.currentRequest ? this.currentRequest.clientId : null,
      apiUrl: this.apiUrl
    });
  }

  sendToClient(clientId, message) {
    const client = this.clients.get(clientId);
    if (client && client.socket) {
      client.socket.write(JSON.stringify(message) + '\n');
    }
  }

  async stop() {
    console.log(chalk.yellow('🛑 Stopping vLLM Model Server...'));
    
    // Close all client connections
    for (const [clientId, client] of this.clients) {
      client.socket.destroy();
    }
    this.clients.clear();

    // Stop socket server
    if (this.server) {
      this.server.close();
    }

    // Stop vLLM process
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

    console.log(chalk.green('✅ vLLM Model Server stopped'));
  }
}

// Start the server if run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const config = {
    modelPath: process.env.MODEL_PATH || "/home/phind-container/models/phind-codellama-34b-v2.Q4_K_M.gguf",
    vllmPath: process.env.VLLM_PATH || "vllm",
    socketPath: process.env.SOCKET_PATH || "/tmp/qa-vllm-server.sock",
    apiPort: parseInt(process.env.API_PORT) || 8000,
    contextSize: parseInt(process.env.CONTEXT_SIZE) || 16384,
    maxTokens: parseInt(process.env.MAX_TOKENS) || 1024,
    maxConcurrentRequests: parseInt(process.env.MAX_CONCURRENT_REQUESTS) || 10,
    tensorParallelSize: parseInt(process.env.TENSOR_PARALLEL_SIZE) || 1
  };

  const server = new VLLMServer(config);
  
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
    console.error(chalk.red('Failed to start vLLM Model Server:'), error.message);
    process.exit(1);
  });
}

export default VLLMServer; 