import axios from 'axios';
import { config } from '../config';
import { logger } from '../utils/logger';

interface TokenCache {
  accessToken: string;
  expiresAt: number;
}

export interface JibblePerson {
  id: string;
  name: string;
  email: string;
}

export interface TimeEntry {
  id: string;
  personId: string;
  type: 'In' | 'Out' | 'StartBreak';
  time: string;
  belongsToDate: string; // YYYY-MM-DD
}

export interface DayStats {
  date: string;
  clockIn: Date | null;
  clockOut: Date | null;
  workedMinutes: number;
  breakMinutes: number;
}

export interface Report {
  personName: string;
  label: string; // e.g. "March 2026" or "25 Mar – 25 Apr 2026"
  startDate: string;
  endDate: string;
  totalWorkingDays: number;
  daysPresent: number;
  daysAbsent: number;
  totalWorkedMinutes: number;
  totalBreakMinutes: number;
  days: DayStats[];
}

export type JibbleState = 'clocked-in' | 'on-break' | 'clocked-out';

const PLATFORM_INFO = {
  clientVersion: '1.0',
  os: 'Linux',
  deviceModel: 'Server',
  deviceName: 'DiscordBot',
};

const PKT_TZ = 'Asia/Karachi';

// Returns YYYY-MM-DD in Pakistan time, with optional day offset
function pktDate(offsetDays = 0): string {
  const d = new Date();
  if (offsetDays) d.setDate(d.getDate() + offsetDays);
  return d.toLocaleDateString('en-CA', { timeZone: PKT_TZ }); // en-CA gives YYYY-MM-DD
}

function parseEntries(raw: unknown): TimeEntry[] {
  if (Array.isArray(raw)) return raw as TimeEntry[];
  if (raw && typeof raw === 'object') {
    const obj = raw as Record<string, unknown>;
    if (Array.isArray(obj['value'])) return obj['value'] as TimeEntry[];
  }
  return [];
}

function calcDayStats(entries: TimeEntry[], countOpenTime = false): Omit<DayStats, 'date'> {
  const sorted = entries.slice().sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());

  let clockIn: Date | null = null;
  let clockOut: Date | null = null;
  let workedMinutes = 0;
  let breakMinutes = 0;
  let lastInTime: Date | null = null;
  let lastBreakStart: Date | null = null;

  for (const e of sorted) {
    const t = new Date(e.time);
    if (e.type === 'In') {
      if (!clockIn) clockIn = t;
      if (lastBreakStart) {
        breakMinutes += (t.getTime() - lastBreakStart.getTime()) / 60000;
        lastBreakStart = null;
      }
      lastInTime = t;
    } else if (e.type === 'StartBreak') {
      // Close the current work segment before the break starts
      if (lastInTime) {
        workedMinutes += (t.getTime() - lastInTime.getTime()) / 60000;
        lastInTime = null;
      }
      lastBreakStart = t;
    } else if (e.type === 'Out') {
      // Only count Out entries that have a matching In in this day's data.
      // An Out with no preceding In is a cross-midnight leftover from the
      // previous shift (e.g. 4:14 AM clock-out from last night's shift that
      // Jibble tags to today's PKT date). Ignore it.
      if (lastInTime) {
        clockOut = t;
        workedMinutes += (t.getTime() - lastInTime.getTime()) / 60000;
        lastInTime = null;
      }
    }
  }

  // Still clocked in (no Out yet) — count time up to now
  if (countOpenTime && lastInTime && !lastBreakStart) {
    workedMinutes += (Date.now() - lastInTime.getTime()) / 60000;
  }

  // Work segments already exclude break time — no further subtraction needed
  return { clockIn, clockOut, workedMinutes: Math.round(Math.max(0, workedMinutes)), breakMinutes: Math.round(breakMinutes) };
}

class JibbleService {
  private tokenCache: TokenCache | null = null;
  private peopleCache: { data: JibblePerson[]; expiresAt: number } | null = null;

  private async getToken(): Promise<string> {
    const now = Date.now();
    if (this.tokenCache && this.tokenCache.expiresAt > now) return this.tokenCache.accessToken;

    logger.info('Fetching new Jibble access token...');
    const params = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: config.jibble.clientId,
      client_secret: config.jibble.clientSecret,
    });

    const response = await axios.post(
      `${config.jibble.identityUrl}/connect/token`,
      params.toString(),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );

    const { access_token, expires_in } = response.data as { access_token: string; expires_in: number };
    this.tokenCache = { accessToken: access_token, expiresAt: now + (expires_in - 60) * 1000 };
    logger.info('Jibble access token acquired');
    return access_token;
  }

  private async request<T>(method: 'get' | 'post', url: string, data?: object, retry = true): Promise<T> {
    const token = await this.getToken();
    try {
      const response = await axios.request<T>({
        method, url, data,
        headers: {
          Authorization: `Bearer ${token}`,
          ...(method === 'post' && { 'Content-Type': 'application/json' }),
        },
      });
      return response.data;
    } catch (error: unknown) {
      if (axios.isAxiosError(error)) {
        if (retry && error.response?.status === 401) {
          logger.warn('Got 401 from Jibble, refreshing token and retrying...');
          this.tokenCache = null;
          return this.request<T>(method, url, data, false);
        }
        const errData = error.response?.data;
        logger.error(`Jibble API error [${error.response?.status}] ${url}:`, JSON.stringify(errData ?? error.message));
        const msg =
          (typeof errData === 'object' && errData !== null && 'message' in errData
            ? String((errData as Record<string, unknown>).message) : null) ??
          (typeof errData === 'string' ? errData : null) ??
          error.message;
        throw new Error(msg);
      }
      throw error;
    }
  }

  async getPeople(): Promise<JibblePerson[]> {
    const now = Date.now();
    if (this.peopleCache && this.peopleCache.expiresAt > now) return this.peopleCache.data;

    logger.info('Fetching Jibble people list...');
    const raw = await this.request<unknown>('get', `${config.jibble.workspaceUrl}/v1/People`);

    let people: Record<string, unknown>[];
    if (Array.isArray(raw)) {
      people = raw as Record<string, unknown>[];
    } else if (raw && typeof raw === 'object') {
      const obj = raw as Record<string, unknown>;
      people = (Array.isArray(obj['value']) ? obj['value'] : Array.isArray(obj['data']) ? obj['data'] : []) as Record<string, unknown>[];
    } else {
      people = [];
    }

    const normalized = people.map((p: Record<string, unknown>) => ({
      id: (p['id'] ?? p['personId'] ?? '') as string,
      email: (p['email'] ?? '') as string,
      name: (p['name'] ?? p['fullName'] ?? p['displayName'] ??
        (p['firstName'] && p['lastName'] ? `${p['firstName']} ${p['lastName']}` : null) ??
        p['firstName'] ?? p['lastName'] ?? 'Unknown') as string,
    }));

    this.peopleCache = { data: normalized, expiresAt: now + 5 * 60 * 1000 };
    logger.info(`Fetched ${normalized.length} Jibble people`);
    return normalized;
  }

  async findPersonByEmail(email: string): Promise<JibblePerson | null> {
    const people = await this.getPeople();
    return people.find(p => p.email?.toLowerCase() === email.toLowerCase()) ?? null;
  }

  invalidatePeopleCache(): void { this.peopleCache = null; }

  private body(personId: string, type: string) {
    return { personId, type, clientType: 'Web', platform: PLATFORM_INFO };
  }

  async clockIn(personId: string): Promise<void> {
    await this.request('post', `${config.jibble.timeTrackingUrl}/v1/TimeEntries`, this.body(personId, 'In'));
  }

  async clockOut(personId: string): Promise<void> {
    await this.request('post', `${config.jibble.timeTrackingUrl}/v1/TimeEntries`, this.body(personId, 'Out'));
  }

  async startBreak(personId: string): Promise<void> {
    await this.request('post', `${config.jibble.timeTrackingUrl}/v1/TimeEntries`, this.body(personId, 'StartBreak'));
  }

  async endBreak(personId: string): Promise<void> {
    await this.request('post', `${config.jibble.timeTrackingUrl}/v1/TimeEntries/EndBreak`, {
      model: this.body(personId, 'In'),
    });
  }

  // Returns current state based on most recent time entry across last 2 days
  async getCurrentState(personId: string): Promise<JibbleState> {
    const sinceDate = pktDate(-1); // yesterday in PKT

    const filter = `personId eq ${personId} and belongsToDate ge ${sinceDate}`;
    const url = `${config.jibble.timeTrackingUrl}/v1/TimeEntries?$filter=${encodeURIComponent(filter)}&$orderby=time desc&$top=10`;

    const raw = await this.request<unknown>('get', url);
    const entries = parseEntries(raw);
    if (entries.length === 0) return 'clocked-out';

    // Sort descending to get latest first
    entries.sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());
    const last = entries[0];
    if (last.type === 'In') return 'clocked-in';
    if (last.type === 'StartBreak') return 'on-break';
    return 'clocked-out';
  }

  async getTodayStats(personId: string): Promise<DayStats> {
    const dateStr = pktDate(); // today in PKT

    const filter = `personId eq ${personId} and belongsToDate eq ${dateStr}`;
    const url = `${config.jibble.timeTrackingUrl}/v1/TimeEntries?$filter=${encodeURIComponent(filter)}&$orderby=time asc&$top=100`;

    const raw = await this.request<unknown>('get', url);
    const entries = parseEntries(raw);
    return { date: dateStr, ...calcDayStats(entries, true) };
  }

  async getReport(personId: string, personName: string, startDate: string, endDate: string, label: string): Promise<Report> {
    const filter = `personId eq ${personId} and belongsToDate ge ${startDate} and belongsToDate le ${endDate}`;
    const url = `${config.jibble.timeTrackingUrl}/v1/TimeEntries?$filter=${encodeURIComponent(filter)}&$orderby=time asc&$top=500`;

    const raw = await this.request<unknown>('get', url);
    const entries = parseEntries(raw);

    // Group by date
    const byDate = new Map<string, TimeEntry[]>();
    for (const entry of entries) {
      if (!byDate.has(entry.belongsToDate)) byDate.set(entry.belongsToDate, []);
      byDate.get(entry.belongsToDate)!.push(entry);
    }

    // Count working days (Mon–Fri) in the range
    let totalWorkingDays = 0;
    const start = new Date(startDate + 'T00:00:00');
    const end = new Date(endDate + 'T00:00:00');
    for (const d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const dow = d.getDay();
      if (dow !== 0) totalWorkingDays++; // Mon–Sat; Sunday is the only off day
    }

    const days: DayStats[] = [];
    for (const [date, dayEntries] of byDate.entries()) {
      days.push({ date, ...calcDayStats(dayEntries, false) });
    }
    days.sort((a, b) => a.date.localeCompare(b.date));

    const daysPresent = days.filter(d => d.clockIn !== null).length;
    const totalWorkedMinutes = days.reduce((s, d) => s + d.workedMinutes, 0);
    const totalBreakMinutes = days.reduce((s, d) => s + d.breakMinutes, 0);

    return {
      personName, label, startDate, endDate,
      totalWorkingDays,
      daysPresent,
      daysAbsent: Math.max(0, totalWorkingDays - daysPresent),
      totalWorkedMinutes,
      totalBreakMinutes,
      days,
    };
  }
}

export const jibbleService = new JibbleService();
