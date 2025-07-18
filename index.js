#!/usr/bin/env node

// QAterm - Local Phind-34B Coding Assistant
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
import { exec } from 'child_process';
import { promisify } from 'util';
import PhindClient from './phindClient.js';

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
let projectContext = {};

// Initialize coding mode
function initializeCodingMode() {
  if (!config.coding.enabled) return;
  
  const projectContextFile = path.join(process.cwd(), config.coding.projectContextFile);
  const currentContextFile = path.join(process.cwd(), config.coding.currentContextFile);
  
  // Create ai.md if it doesn't exist
  if (!fs.existsSync(projectContextFile)) {
    const defaultContext = `# Project Context for ${path.basename(process.cwd())}

## Overview

This file contains important project information for AI assistance.

## Features

## Code Style and Conventions

## Important Files

## Dependencies

## Configuration

## Notes

`;
    fs.writeFileSync(projectContextFile, defaultContext);
  }
  
  // Load existing project context
  loadProjectContext();
  
  // Load conversation history
  loadConversationHistory();
}

// Load project context from ai.md
function loadProjectContext() {
  const projectContextFile = path.join(process.cwd(), config.coding.projectContextFile);
  if (fs.existsSync(projectContextFile)) {
    try {
      const content = fs.readFileSync(projectContextFile, 'utf8');
      // Parse the markdown content into structured data
      projectContext = {
        content: content,
        lastModified: fs.statSync(projectContextFile).mtime
      };
    } catch (error) {
      console.error('Error loading project context:', error.message);
    }
  }
}

// Load conversation history from current.md
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

// Save conversation history to current.md
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

// Update conversation with new message
function updateConversationFile(question, answer) {
  conversationHistory.push({ role: 'user', content: question });
  conversationHistory.push({ role: 'assistant', content: answer });
  
  // Keep history within limits
  if (conversationHistory.length > config.interface.maxContextMessages * 2) {
    conversationHistory = conversationHistory.slice(-config.interface.maxContextMessages * 2);
  }
  
  if (config.coding.autoSaveContext) {
    saveConversationHistory();
  }
}

// Compact conversation history
async function compactConversation() {
  if (conversationHistory.length < 10) {
    return 'Conversation history is short enough, no compaction needed.';
  }
  
  const spinner = ora('Compacting conversation history...').start();
  
  try {
    // Create a summary of the conversation
    const summaryPrompt = `Please provide a concise summary of this conversation, highlighting the key points, decisions made, and any important context that should be preserved for future reference. Focus on technical details, code changes, and project-specific information.

Conversation:
${conversationHistory.map(msg => `${msg.role}: ${msg.content}`).join('\n\n')}

Summary:`;
    
    const summary = await phindClient.sendMessage(summaryPrompt);
    
    // Replace conversation history with summary
    conversationHistory = [
      { role: 'user', content: 'Previous conversation (compacted)' },
      { role: 'assistant', content: summary }
    ];
    
    saveConversationHistory();
    
    spinner.succeed('Conversation history compacted successfully');
    return 'Conversation history has been compacted and summarized.';
    
  } catch (error) {
    spinner.fail('Failed to compact conversation history');
    throw error;
  }
}

// Update project context with new feature
function updateProjectContext(newFeature) {
  const projectContextFile = path.join(process.cwd(), config.coding.projectContextFile);
  
  try {
    let content = fs.readFileSync(projectContextFile, 'utf8');
    
    // Add new feature to the Features section
    if (content.includes('## Features')) {
      const featureEntry = `\n- ${newFeature}`;
      content = content.replace('## Features', `## Features${featureEntry}`);
    } else {
      content += `\n## Features\n- ${newFeature}\n`;
    }
    
    fs.writeFileSync(projectContextFile, content);
    projectContext = { content, lastModified: new Date() };
    
    return 'Project context updated successfully.';
  } catch (error) {
    console.error('Error updating project context:', error.message);
    return 'Failed to update project context.';
  }
}

// Execute terminal command
async function executeCommand(command) {
  const execAsync = promisify(exec);
  
  try {
    const { stdout, stderr } = await execAsync(command, { cwd: process.cwd() });
    return { success: true, output: stdout, error: stderr };
  } catch (error) {
    return { success: false, output: '', error: error.message };
  }
}

// Check if command is allowed
function isCommandAllowed(command) {
  const disallowedPatterns = [
    'rm -rf',
    'sudo',
    'chmod',
    'chown',
    'mv /',
    'cp /',
    'find /',
    '> /dev',
    'curl | bash',
    'wget | bash'
  ];
  
  return !disallowedPatterns.some(pattern => command.includes(pattern));
}

// Display logo
function displayLogo() {
  const logo = figlet.textSync('BF-QAterm', { font: 'Standard' });
  const gradientLogo = gradient.pastel.multiline(logo);
  console.log(gradientLogo);
  console.log(chalk.blue('Local Phind-34B Coding Assistant\n'));
}

// Connect to Phind
async function connectToPhind() {
  const spinner = ora('Connecting to Phind-34B...').start();
  
  try {
    phindClient = new PhindClient(config.phind);
    
    phindClient.on('ready', () => {
      spinner.succeed('Connected to Phind-34B');
      isConnected = true;
    });
    
    phindClient.on('disconnected', (code) => {
      console.log(chalk.yellow(`Phind disconnected with code: ${code}`));
      isConnected = false;
    });
    
    await phindClient.connect();
    
    // Initialize coding mode
    initializeCodingMode();
    
  } catch (error) {
    spinner.fail(`Failed to connect: ${error.message}`);
    console.error(chalk.red('Make sure Phind-34B is running on your cloud VM'));
    console.error(chalk.gray('Expected path: ~/llama.cpp/build/bin/llama-simple-chat'));
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
    // Add project context if available, but keep it reasonable
    let enhancedMessage = message;
    if (projectContext.content && config.coding.enabled) {
      // Limit context to first 1000 characters to prevent overflow
      const contextPreview = projectContext.content.substring(0, 1000);
      enhancedMessage = `Project Context:\n${contextPreview}\n\nUser Question: ${message}`;
    }
    
    // Send to Phind
    const response = await phindClient.sendMessage(enhancedMessage);
    
    // Update conversation history
    updateConversationFile(message, response);
    
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
      
    case '\\compact':
      try {
        const result = await compactConversation();
        console.log(chalk.blue(result));
      } catch (error) {
        console.error(chalk.red(`Error: ${error.message}`));
      }
      break;
      
    case '\\feature':
      if (args.length === 0) {
        console.log(chalk.red('Usage: \\feature <description>'));
        break;
      }
      const featureDesc = args.join(' ');
      const result = updateProjectContext(featureDesc);
      console.log(chalk.blue(result));
      break;
      
    case '\\exec':
      if (args.length === 0) {
        console.log(chalk.red('Usage: \\exec <command>'));
        break;
      }
      const command = args.join(' ');
      if (!isCommandAllowed(command)) {
        console.log(chalk.red('Command not allowed for security reasons.'));
        break;
      }
      const execResult = await executeCommand(command);
      if (execResult.success) {
        console.log(chalk.green('Command executed successfully:'));
        console.log(execResult.output);
      } else {
        console.log(chalk.red('Command failed:'));
        console.log(execResult.error);
      }
      break;
      
    case '\\help':
      console.log(chalk.cyan('\nAvailable commands:'));
      console.log(chalk.gray('  \\exit, \\quit    - Exit the application'));
      console.log(chalk.gray('  \\clear          - Clear conversation history'));
      console.log(chalk.gray('  \\save           - Save conversation to file'));
      console.log(chalk.gray('  \\compact        - Compact conversation history'));
      console.log(chalk.gray('  \\feature <desc> - Add feature to project context'));
      console.log(chalk.gray('  \\exec <cmd>     - Execute terminal command'));
      console.log(chalk.gray('  \\help           - Show this help'));
      console.log(chalk.gray('  \\status         - Show connection status'));
      console.log(chalk.gray('  \\context        - Show context usage'));
      console.log('');
      break;
      
    case '\\status':
      console.log(chalk.cyan(`\nStatus: ${isConnected ? 'Connected' : 'Disconnected'}`));
      console.log(chalk.gray(`Model: ${config.phind.modelPath}`));
      console.log(chalk.gray(`Context size: ${config.phind.contextSize}`));
      console.log(chalk.gray(`Max tokens: ${config.phind.maxTokens}`));
      console.log(chalk.gray(`History: ${conversationHistory.length} messages`));
      console.log(chalk.gray(`Project context: ${projectContext.content ? 'Loaded' : 'Not loaded'}`));
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
    .name('qa')
    .description('Local Phind-34B Coding Assistant')
    .version('2.0.0');
  
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
    try {
      await phindClient.disconnect();
    } catch (error) {
      console.error('Error disconnecting:', error.message);
    }
  }
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log(chalk.blue('\nShutting down...'));
  if (phindClient) {
    try {
      await phindClient.disconnect();
    } catch (error) {
      console.error('Error disconnecting:', error.message);
    }
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
