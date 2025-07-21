import { createConnection } from 'net';
import { EventEmitter } from 'events';
import { existsSync } from 'fs';

class PhindSocketClient extends EventEmitter {
  constructor(config = {}) {
    super();
    this.config = {
      socketPath: config.socketPath || "/tmp/qa-vllm-server.sock",
      userId: config.userId || process.getuid(),
      username: config.username || process.env.USER || 'unknown',
      ...config
    };

    this.socket = null;
    this.isConnected = false;
    this.context = [];
    this.currentTokenCount = 0;
    this.responsePromise = null;
    this.responseResolve = null;
    this.responseReject = null;
    this.messageId = 0;
  }

  async connect() {
    return new Promise((resolve, reject) => {
      // Check if socket exists
      if (!existsSync(this.config.socketPath)) {
        reject(new Error(`Model server not running. Socket not found: ${this.config.socketPath}`));
        return;
      }

      this.socket = createConnection(this.config.socketPath);

      this.socket.on('connect', () => {
        console.log('Connected to model server');
        this.isConnected = true;
        
        // Authenticate with the server
        this.authenticate();
        
        this.emit('ready');
        resolve();
      });

      this.socket.on('data', (data) => {
        this.handleServerMessage(data);
      });

      this.socket.on('close', () => {
        console.log('Disconnected from model server');
        this.isConnected = false;
        this.emit('disconnected');
      });

      this.socket.on('error', (error) => {
        console.error('Socket error:', error);
        this.isConnected = false;
        reject(error);
      });

      // Timeout after 10 seconds
      setTimeout(() => {
        if (!this.isConnected) {
          reject(new Error('Connection timeout'));
        }
      }, 10000);
    });
  }

  authenticate() {
    this.sendMessage({
      type: 'authenticate',
      userId: this.config.userId,
      username: this.config.username
    });
  }

  handleServerMessage(data) {
    try {
      const messages = data.toString().split('\n').filter(line => line.trim());
      
      for (const messageStr of messages) {
        const message = JSON.parse(messageStr);
        
        switch (message.type) {
          case 'connected':
            console.log('Connected to QAterm Model Server');
            break;
            
          case 'authenticated':
            console.log(`Authenticated as: ${message.username} (${message.userId})`);
            break;
            
          case 'response':
            this.handleResponse(message);
            break;
            
          case 'error':
            this.handleError(message);
            break;
            
          case 'status':
            console.log('Server status:', message);
            break;
            
          case 'contextCleared':
            this.context = [];
            this.currentTokenCount = 0;
            break;
            
          default:
            console.log('Unknown message type:', message.type);
        }
      }
    } catch (error) {
      console.error('Error parsing server message:', error);
    }
  }

  handleResponse(message) {
    if (this.responsePromise) {
      this.responseResolve(message.content);
      this.responsePromise = null;
      this.responseResolve = null;
      this.responseReject = null;
    }
  }

  handleError(message) {
    if (this.responsePromise) {
      this.responseReject(new Error(message.message));
      this.responsePromise = null;
      this.responseResolve = null;
      this.responseReject = null;
    }
  }

  sendMessage(message) {
    if (this.socket && this.isConnected) {
      this.socket.write(JSON.stringify(message) + '\n');
    } else {
      throw new Error('Not connected to model server');
    }
  }

  async sendMessage(message, options = {}) {
    if (!this.isConnected || !this.socket) {
      throw new Error('Not connected to model server');
    }

    if (this.responsePromise) {
      throw new Error('Already waiting for a response');
    }

    // Check context limits
    if (this.wouldExceedContext(message)) {
      const usage = this.getContextUsage();
      console.warn(`⚠️  Context usage high: ${usage.usagePercent}% (${usage.current}/${usage.max} tokens)`);
      
      if (usage.usagePercent > 90) {
        throw new Error(`Context limit exceeded. Usage: ${usage.usagePercent}%. Please clear history or use shorter input.`);
      }
    }

    return new Promise((resolve, reject) => {
      this.responsePromise = { resolve, reject };
      this.responseResolve = resolve;
      this.responseReject = reject;
      
      const messageId = ++this.messageId;
      
      this.sendMessage({
        type: 'sendMessage',
        content: message,
        messageId: messageId
      });

      // Add timeout
      const timeout = options.timeout || 60000;
      setTimeout(() => {
        if (this.responsePromise) {
          this.responsePromise = null;
          this.responseResolve = null;
          this.responseReject = null;
          reject(new Error('Response timeout'));
        }
      }, timeout);
    });
  }

  // Estimate token count (rough approximation)
  estimateTokens(text) {
    // Rough approximation: 1 token ≈ 4 characters for English/code
    return Math.ceil(text.length / 4);
  }

  // Check if adding message would exceed context
  wouldExceedContext(message) {
    const messageTokens = this.estimateTokens(message);
    const currentTokens = this.currentTokenCount;
    const maxInputTokens = 16384 - 1024; // Default context size - max tokens
    
    return (currentTokens + messageTokens) > maxInputTokens;
  }

  // Get current context usage
  getContextUsage() {
    const maxInputTokens = 16384 - 1024; // Default context size - max tokens
    const usagePercent = (this.currentTokenCount / maxInputTokens) * 100;
    
    return {
      current: this.currentTokenCount,
      max: maxInputTokens,
      available: maxInputTokens - this.currentTokenCount,
      usagePercent: Math.round(usagePercent)
    };
  }

  async disconnect() {
    if (this.socket) {
      this.socket.destroy();
      this.socket = null;
    }
    this.isConnected = false;
    this.responsePromise = null;
    this.responseResolve = null;
    this.responseReject = null;
  }

  // Context management
  addToContext(role, content) {
    this.context.push({ role, content, timestamp: Date.now() });
    
    // Keep context within limits
    if (this.context.length > 160) { // 16384 / 100
      this.context = this.context.slice(-160);
    }
  }

  getContext() {
    return this.context;
  }

  clearContext() {
    this.context = [];
    this.currentTokenCount = 0;
    
    // Notify server to clear context
    this.sendMessage({ type: 'clearContext' });
  }

  // Get context usage information
  getContextInfo() {
    const usage = this.getContextUsage();
    return {
      ...usage,
      contextMessages: this.context.length,
      maxContextMessages: 160
    };
  }

  // Get server status
  async getStatus() {
    this.sendMessage({ type: 'getStatus' });
  }
}

export default PhindSocketClient; 