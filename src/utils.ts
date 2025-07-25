// Utility functions for analytics

import { customAlphabet } from 'nanoid';

// Create ULID generator for time-ordered IDs
const alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const nanoid = customAlphabet(alphabet, 26);

export function generateULID(): string {
  const timestamp = Date.now().toString(36).padStart(10, '0');
  const randomPart = nanoid(16);
  return `${timestamp}${randomPart}`;
}

export function parsePeriod(period: string): { start: number; end: number } {
  const now = Date.now();
  const periodMap: Record<string, number> = {
    '1h': 60 * 60 * 1000,
    '24h': 24 * 60 * 60 * 1000,
    '7d': 7 * 24 * 60 * 60 * 1000,
    '30d': 30 * 24 * 60 * 60 * 1000,
  };

  const duration = periodMap[period] || periodMap['24h'];
  return { start: now - duration, end: now };
}

export function getHourBucket(timestamp: number): number {
  return Math.floor(timestamp / (1000 * 60 * 60)) * (60 * 60);
}

export function calculateCost(model: string, tokensPrompt: number, tokensCompletion: number): number {
  // Rough cost estimates per 1M tokens (update as needed)
  const costPerMillion: Record<string, { prompt: number; completion: number }> = {
    'gemini-2.5-flash': { prompt: 0.10, completion: 0.30 },
    'gemini-2.5-flash-lite-preview-06-17': { prompt: 0.05, completion: 0.15 },
    'gemini-flash-thinking': { prompt: 0.10, completion: 0.30 },
    'gpt-4': { prompt: 30, completion: 60 },
    'gpt-3.5-turbo': { prompt: 0.5, completion: 1.5 },
  };

  const costs = costPerMillion[model] || { prompt: 0.1, completion: 0.3 };
  return (tokensPrompt * costs.prompt + tokensCompletion * costs.completion) / 1_000_000;
}

export class Logger {
  constructor(private level: string = 'info') {}

  private shouldLog(level: string): boolean {
    const levels = ['debug', 'info', 'warn', 'error'];
    const currentLevel = levels.indexOf(this.level);
    const messageLevel = levels.indexOf(level);
    return messageLevel >= currentLevel;
  }

  debug(message: string, data?: any) {
    if (this.shouldLog('debug')) {
      console.log(`[DEBUG] ${message}`, data || '');
    }
  }

  info(message: string, data?: any) {
    if (this.shouldLog('info')) {
      console.log(`[INFO] ${message}`, data || '');
    }
  }

  warn(message: string, data?: any) {
    if (this.shouldLog('warn')) {
      console.warn(`[WARN] ${message}`, data || '');
    }
  }

  error(message: string, error?: any) {
    if (this.shouldLog('error')) {
      console.error(`[ERROR] ${message}`, error || '');
    }
  }
}