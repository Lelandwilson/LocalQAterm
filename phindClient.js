import { spawn } from 'child_process';
import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';

class PhindClient extends EventEmitter {
  constructor(config = {}) {
    super();
    this.config = {
      modelPath: config.modelPath || "/home/phind-container/models/phind-codellama-34b-v2.Q4_K_M.gguf",
      llamaPath: config.llamaPath || "/home/llama.cpp/build/bin/llama-simple-chat",
      gpuLayers: config.gpuLayers || 99,
      contextSize: config.contextSize || 8192,
      temperature: config.temperature || 0.7,
      maxTokens: config.maxTokens || 2048,
      ...config
    };
    console.log("\nModel: " + this.config.modelPath);
    console.log("Llama interface: " + this.config.llamaPath);
    console.log("Context window: " + this.config.contextSize);


    this.process = null;
    this.isConnected = false;
    this.context = [];
    this.tokenizer = null;
    this.currentTokenCount = 0;
    this.responsePromise = null;
    this.responseResolve = null;
    this.responseReject = null;
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
    const maxInputTokens = this.config.contextSize - this.config.maxTokens;
    
    return (currentTokens + messageTokens) > maxInputTokens;
  }

  // Get current context usage
  getContextUsage() {
    const maxInputTokens = this.config.contextSize - this.config.maxTokens;
    const usagePercent = (this.currentTokenCount / maxInputTokens) * 100;
    
    return {
      current: this.currentTokenCount,
      max: maxInputTokens,
      available: maxInputTokens - this.currentTokenCount,
      usagePercent: Math.round(usagePercent)
    };
  }

  async connect() {
    return new Promise((resolve, reject) => {
      const args = [
        '-m', this.config.modelPath,
        '-ngl', this.config.gpuLayers.toString(),
        '-c', this.config.contextSize.toString()
      ];

      console.log('Executing command:', this.config.llamaPath, args.join(' '));

      this.process = spawn(this.config.llamaPath, args, {
        stdio: ['pipe', 'pipe', 'pipe']
      });

      let buffer = '';
      let isReady = false;
      let stderrBuffer = '';

      this.process.stdout.on('data', (data) => {
        const chunk = data.toString();
        buffer += chunk;
        
        // Debug: log what we're receiving
        console.log('STDOUT chunk:', JSON.stringify(chunk));
        
        // Check for various ready indicators
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
          this.emit('ready');
          resolve();
        }
      });

      this.process.stderr.on('data', (data) => {
        const chunk = data.toString();
        stderrBuffer += chunk;
        // Log all stderr for debugging
        console.error('STDERR:', JSON.stringify(chunk));
      });

      this.process.on('error', (error) => {
        console.error('Process error:', error);
        this.isConnected = false;
        reject(error);
      });

      this.process.on('close', (code) => {
        console.error(`Process closed with code: ${code}`);
        this.isConnected = false;
        this.emit('disconnected', code);
      });

      // Timeout after 60 seconds
      setTimeout(() => {
        if (!isReady) {
          reject(new Error('Phind connection timeout'));
        }
      }, 60000);
    });
  }

  async sendMessage(message, options = {}) {
    if (!this.isConnected || !this.process) {
      throw new Error('Phind client not connected');
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
      
      let responseBuffer = '';
      let isComplete = false;
      const timeout = options.timeout || 60000;

      const timeoutId = setTimeout(() => {
        if (!isComplete) {
          this.responsePromise = null;
          this.responseResolve = null;
          this.responseReject = null;
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
          
          // Remove the data handler
          this.process.stdout.removeListener('data', dataHandler);
          
          // Clean the response
          const cleanedResponse = this.cleanResponse(responseBuffer);
          
          // Update token count
          this.currentTokenCount += this.estimateTokens(message) + this.estimateTokens(cleanedResponse);
          
          // Clear response state
          this.responsePromise = null;
          this.responseResolve = null;
          this.responseReject = null;
          
          resolve(cleanedResponse);
        }
      };

      this.process.stdout.on('data', dataHandler);

      // Send the message
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
      .replace(/<\|im_end\|>/g, '') // Remove end markers
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
        // Stop at first system message after user content
        break;
      }
    }

    return userLines.join('\n').trim();
  }

  async disconnect() {
    if (this.process) {
      this.process.stdin.write('\x03'); // Send Ctrl+C
      this.process.kill();
      this.process = null;
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
    if (this.context.length > this.config.contextSize / 100) {
      this.context = this.context.slice(-this.config.contextSize / 100);
    }
  }

  getContext() {
    return this.context;
  }

  clearContext() {
    this.context = [];
    this.currentTokenCount = 0;
  }

  // Get context usage information
  getContextInfo() {
    const usage = this.getContextUsage();
    return {
      ...usage,
      contextMessages: this.context.length,
      maxContextMessages: this.config.contextSize / 100
    };
  }
}

export default PhindClient; 