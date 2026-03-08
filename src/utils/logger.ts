const log = (level: string, message: string, ...args: unknown[]): void => {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] [${level}] ${message}`, ...args);
};

export const logger = {
  info: (message: string, ...args: unknown[]) => log('INFO ', message, ...args),
  warn: (message: string, ...args: unknown[]) => log('WARN ', message, ...args),
  error: (message: string, ...args: unknown[]) => log('ERROR', message, ...args),
  debug: (message: string, ...args: unknown[]) => log('DEBUG', message, ...args),
};
