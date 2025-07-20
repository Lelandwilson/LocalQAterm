#!/usr/bin/env node

// QAterm - Local Phind-34B Coding Assistant (Multi-User Version)
// A streamlined terminal application for local AI coding assistance

import dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { Command } from 'commander';
import inquirer from 'inquirer';
import chalk from 'chalk';
import figlet from 'figlet';
import gradient from 'gradient-string';
import boxen from 'boxen';
import ora from 'ora';
import readline from 'readline';
import PhindClient from './phindClient.js';
import PhindSocketClient from './phindSocketClient.js';

// Setup __dirname equivalent for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load configuration
let config;
try {
  config = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));
} catch (error) {
  console.error('Error loading config:', error.message);
  process.exit(1);
}

// Global variables
let phindClient = null;
let conversationHistory = [];
let isConnected = false;
let useSocketClient = false;

// Display logo
function displayLogo() {
  const logo = figlet.textSync('BF-QAterm', { font: 'Standard' });
  const gradientLogo = gradient.pastel.multiline(logo);
  console.log(gradientLogo);
  console.log(chalk.blue('Local Phind-34B Coding Assistant (Multi-User)\n'));
}

// Load conversation history
function loadConversationHistory() {
  const historyFile = path.join(process.cwd(), config.coding.currentContextFile);
  if (fs.existsSync(historyFile)) {
    try {
      const content = fs.readFileSync(historyFile, 'utf8');
      // Parse conversation from markdown format
      const lines = content.split('\n');
      let currentMessage = '';
      let currentRole = '';
      
      for (const line of lines) {
        if (line.startsWith('## User')) {
          if (currentMessage && currentRole) {
            conversationHistory.push({ role: currentRole, content: currentMessage.trim() });
          }
          currentRole = 'user';
          currentMessage = '';
        } else if (line.startsWith('## Assistant')) {
          if (currentMessage && currentRole) {
            conversationHistory.push({ role: currentRole, content: currentMessage.trim() });
          }
          currentRole = 'assistant';
          currentMessage = '';
        } else if (line.trim() && currentRole) {
          currentMessage += line + '\n';
        }
      }
      
      if (currentMessage && currentRole) {
        conversationHistory.push({ role: currentRole, content: currentMessage.trim() });
      }
    } catch (error) {
      console.error('Error loading conversation history:', error.message);
    }
  }
}

// Save conversation history
function saveConversationHistory() {
  const historyFile = path.join(process.cwd(), config.coding.currentContextFile);
  let content = `# Current Conversation\n\nStarted: ${new Date().toISOString()}\n\n`;
  
  for (const message of conversationHistory) {
    content += `## ${message.role === 'user' ? 'User' : 'Assistant'}\n${message.content}\n\n`;
  }
  
  try {
    fs.writeFileSync(historyFile, content);
  } catch (error) {
    console.error('Error saving conversation history:', error.message);
  }
}

// Check if model server is running
async function checkModelServer() {
  const { existsSync } = await import('fs');
  return existsSync(config.server.socketPath);
}

// Connect to Phind (supports both direct and socket modes)
async function connectToPhind() {
  const spinner = ora('Checking connection mode...').start();
  
  try {
    // Check if model server is available
    const serverRunning = await checkModelServer();
    
    if (serverRunning && config.server.enabled) {
      // Use socket client
      useSocketClient = true;
      spinner.text = 'Connecting to shared model server...';
      
      phindClient = new PhindSocketClient({
        socketPath: config.server.socketPath,
        userId: process.getuid(),
        username: process.env.USER || 'unknown'
      });
      
      phindClient.on('ready', () => {
        spinner.succeed('Connected to shared model server');
        isConnected = true;
      });
      
      phindClient.on('disconnected', () => {
        console.log(chalk.yellow('Disconnected from model server'));
        isConnected = false;
      });
      
      await phindClient.connect();
      
    } else {
      // Use direct process client
      useSocketClient = false;
      spinner.text = 'Connecting to Phind-34B (direct mode)...';
      
      phindClient = new PhindClient(config.phind);
      
      phindClient.on('ready', () => {
        spinner.succeed('Connected to Phind-34B (direct mode)');
        isConnected = true;
      });
      
      phindClient.on('disconnected', (code) => {
        console.log(chalk.yellow(`Phind disconnected with code: ${code}`));
        isConnected = false;
      });
      
      await phindClient.connect();
    }
    
    // Load conversation history
    loadConversationHistory();
    
  } catch (error) {
    spinner.fail(`Failed to connect: ${error.message}`);
    
    if (useSocketClient) {
      console.error(chalk.red('Make sure the model server is running:'));
      console.error(chalk.gray('Run: node modelServer.js'));
    } else {
      console.error(chalk.red('Make sure Phind-34B is running on your cloud VM'));
      console.error(chalk.gray('Expected path: ~/llama.cpp/build/bin/llama-simple-chat'));
    }
    process.exit(1);
  }
}

// Send message to Phind
async function sendMessage(message) {
  if (!isConnected || !phindClient) {
    throw new Error('Not connected to Phind');
  }
  
  const spinner = ora('Thinking...').start();
  
  try {
    // Add user message to history
    conversationHistory.push({ role: 'user', content: message });
    
    // Send to Phind
    const response = await phindClient.sendMessage(message);
    
    // Add assistant response to history
    conversationHistory.push({ role: 'assistant', content: response });
    
    // Keep history within limits
    if (conversationHistory.length > config.interface.maxContextMessages * 2) {
      conversationHistory = conversationHistory.slice(-config.interface.maxContextMessages * 2);
    }
    
    spinner.stop();
    return response;
    
  } catch (error) {
    spinner.fail(`Error: ${error.message}`);
    throw error;
  }
}

// Format response for display
function formatResponse(response) {
  return chalk.green(response);
}

// Process special commands
async function processSpecialCommand(command) {
  const parts = command.split(' ');
  const cmd = parts[0].toLowerCase();
  const args = parts.slice(1);
  
  switch (cmd) {
    case '\\exit':
    case '\\quit':
      console.log(chalk.blue('Goodbye!'));
      if (phindClient) {
        await phindClient.disconnect();
      }
      process.exit(0);
      break;
      
    case '\\clear':
      conversationHistory = [];
      if (phindClient) {
        phindClient.clearContext();
      }
      console.log(chalk.blue('Conversation history cleared'));
      break;
      
    case '\\save':
      saveConversationHistory();
      console.log(chalk.blue('Conversation saved'));
      break;
      
    case '\\help':
      console.log(chalk.cyan('\nAvailable commands:'));
      console.log(chalk.gray('  \\exit, \\quit    - Exit the application'));
      console.log(chalk.gray('  \\clear          - Clear conversation history'));
      console.log(chalk.gray('  \\save           - Save conversation to file'));
      console.log(chalk.gray('  \\help           - Show this help'));
      console.log(chalk.gray('  \\status         - Show connection status'));
      console.log(chalk.gray('  \\context        - Show context usage'));
      console.log(chalk.gray('  \\mode           - Show connection mode'));
      console.log('');
      break;
      
    case '\\status':
      console.log(chalk.cyan(`\nStatus: ${isConnected ? 'Connected' : 'Disconnected'}`));
      console.log(chalk.gray(`Mode: ${useSocketClient ? 'Shared Model Server' : 'Direct Process'}`));
      if (useSocketClient) {
        console.log(chalk.gray(`Socket: ${config.server.socketPath}`));
      } else {
        console.log(chalk.gray(`Model: ${config.phind.modelPath}`));
      }
      console.log(chalk.gray(`Context size: ${config.phind.contextSize}`));
      console.log(chalk.gray(`Max tokens: ${config.phind.maxTokens}`));
      console.log(chalk.gray(`History: ${conversationHistory.length} messages`));
      console.log('');
      break;

    case '\\context':
      if (phindClient && isConnected) {
        const contextInfo = phindClient.getContextInfo();
        console.log(chalk.cyan('\nContext Usage:'));
        console.log(chalk.gray(`  Tokens used: ${contextInfo.current}/${contextInfo.max}`));
        console.log(chalk.gray(`  Available: ${contextInfo.available} tokens`));
        console.log(chalk.gray(`  Usage: ${contextInfo.usagePercent}%`));
        console.log(chalk.gray(`  Messages: ${contextInfo.contextMessages}`));
        
        // Colour-coded usage indicator
        if (contextInfo.usagePercent > 80) {
          console.log(chalk.red(`  ⚠️  High usage - consider clearing history`));
        } else if (contextInfo.usagePercent > 60) {
          console.log(chalk.yellow(`  ⚠️  Moderate usage`));
        } else {
          console.log(chalk.green(`  ✅ Good usage`));
        }
        console.log('');
      } else {
        console.log(chalk.red('Not connected to Phind'));
      }
      break;

    case '\\mode':
      console.log(chalk.cyan('\nConnection Mode:'));
      if (useSocketClient) {
        console.log(chalk.green('  ✅ Shared Model Server Mode'));
        console.log(chalk.gray('  Multiple users can connect to the same model instance'));
        console.log(chalk.gray(`  Socket: ${config.server.socketPath}`));
      } else {
        console.log(chalk.yellow('  🔄 Direct Process Mode'));
        console.log(chalk.gray('  Single user with dedicated model process'));
        console.log(chalk.gray(`  Model: ${config.phind.modelPath}`));
      }
      console.log('');
      break;
      
    default:
      return false; // Not a special command
  }
  
  return true; // Handled as special command
}

// Start chat mode
async function startChatMode() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: config.terminal.prompt
  });
  
  console.log(chalk.blue('\nType your questions or code requests. Use \\help for commands.\n'));
  
  rl.prompt();
  
  rl.on('line', async (line) => {
    const input = line.trim();
    
    if (!input) {
      rl.prompt();
      return;
    }
    
    // Check for special commands
    if (input.startsWith('\\')) {
      const handled = await processSpecialCommand(input);
      if (handled) {
        rl.prompt();
        return;
      }
    }
    
    try {
      // Temporarily pause readline to avoid interference
      rl.pause();
      
      const response = await sendMessage(input);
      console.log('\n' + formatResponse(response) + '\n');
      
      // Auto-save if enabled
      if (config.coding.autoSaveContext) {
        saveConversationHistory();
      }
      
    } catch (error) {
      console.error(chalk.red(`Error: ${error.message}`));
    } finally {
      // Resume readline
      rl.resume();
      rl.prompt();
    }
  });
  
  rl.on('close', async () => {
    console.log(chalk.blue('\nGoodbye!'));
    if (phindClient) {
      await phindClient.disconnect();
    }
    process.exit(0);
  });
}

// Main application
async function main() {
  // Load environment variables
  dotenv.config();
  
  // Display logo
  displayLogo();
  
  // Setup CLI
  const program = new Command();
  program
    .name('qa-multi')
    .description('Local Phind-34B Coding Assistant (Multi-User)')
    .version('2.1.0');
  
  program.parse();
  
  // Connect to Phind
  await connectToPhind();
  
  // Start chat mode
  await startChatMode();
}

// Handle graceful shutdown
process.on('SIGINT', async () => {
  console.log(chalk.blue('\nShutting down...'));
  if (phindClient) {
    await phindClient.disconnect();
  }
  process.exit(0);
});

// Start the application
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(chalk.red('Fatal error:'), error.message);
    process.exit(1);
  });
} 