import { getAllMappings, upsertMapping, deleteMapping } from '../db/database';
import { logger } from '../utils/logger';

export interface UserMapping {
  discordId: string;
  discordUsername: string;
  jibblePersonId: string;
  jibbleEmail: string;
  jibbleName: string;
}

class UserMappingService {
  private cache = new Map<string, UserMapping>();

  loadAll(): void {
    this.cache.clear();
    for (const row of getAllMappings()) {
      this.cache.set(row.discord_id, {
        discordId: row.discord_id,
        discordUsername: row.discord_username,
        jibblePersonId: row.jibble_person_id,
        jibbleEmail: row.jibble_email,
        jibbleName: row.jibble_name,
      });
    }
    logger.info(`Loaded ${this.cache.size} user mappings from database`);
  }

  get(discordId: string): UserMapping | undefined {
    return this.cache.get(discordId);
  }

  register(mapping: UserMapping): void {
    upsertMapping({
      discord_id: mapping.discordId,
      discord_username: mapping.discordUsername,
      jibble_person_id: mapping.jibblePersonId,
      jibble_email: mapping.jibbleEmail,
      jibble_name: mapping.jibbleName,
    });
    this.cache.set(mapping.discordId, mapping);
    logger.info(`Registered: ${mapping.discordUsername} -> ${mapping.jibbleName} (${mapping.jibbleEmail})`);
  }

  unregister(discordId: string): boolean {
    if (!this.cache.has(discordId)) return false;
    deleteMapping(discordId);
    this.cache.delete(discordId);
    logger.info(`Removed mapping for Discord ID: ${discordId}`);
    return true;
  }

  getAll(): UserMapping[] {
    return Array.from(this.cache.values());
  }

  count(): number {
    return this.cache.size;
  }
}

export const userMappingService = new UserMappingService();
