import fs from 'fs';
import path from 'path';
import { config } from '../config';
import { logger } from '../utils/logger';

interface MappingRow {
  discord_id: string;
  discord_username: string;
  jibble_person_id: string;
  jibble_email: string;
  jibble_name: string;
  created_at: string;
}

interface DbData {
  user_mappings: Record<string, MappingRow>;
}

let dbPath: string;
let data: DbData = { user_mappings: {} };

export function initDatabase(): void {
  dbPath = path.resolve(config.db.path);
  const dbDir = path.dirname(dbPath);

  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  if (fs.existsSync(dbPath)) {
    try {
      data = JSON.parse(fs.readFileSync(dbPath, 'utf-8')) as DbData;
    } catch {
      logger.warn('Could not parse database file, starting fresh');
      data = { user_mappings: {} };
    }
  } else {
    persist();
  }

  logger.info(`Database initialized at ${dbPath}`);
}

function persist(): void {
  fs.writeFileSync(dbPath, JSON.stringify(data, null, 2), 'utf-8');
}

export function getAllMappings(): MappingRow[] {
  return Object.values(data.user_mappings);
}

export function upsertMapping(row: Omit<MappingRow, 'created_at'>): void {
  data.user_mappings[row.discord_id] = {
    ...row,
    created_at: data.user_mappings[row.discord_id]?.created_at ?? new Date().toISOString(),
  };
  persist();
}

export function deleteMapping(discordId: string): void {
  delete data.user_mappings[discordId];
  persist();
}

export function closeDatabase(): void {
  logger.info('Database closed');
}
