import fs from 'fs';
import path from 'path';
import pg from 'pg';
import * as Baileys from '@whiskeysockets/baileys';

const { Pool } = pg;
const { useMultiFileAuthState, BufferJSON, initAuthCreds } = Baileys;

const AUTH_DIR = path.resolve(process.cwd(), '.baileys_auth');
const ENGINE_CONFIG_PATH = path.resolve(process.cwd(), '.engine_config.json');

export const pgPool = process.env.DATABASE_URL
  ? new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
      max: 10,
      idleTimeoutMillis: 30000,
    })
  : null;

let dbInitialized = false;
let configWatcherStarted = false;
let lastSavedConfigRaw = '';

async function ensureDatabaseTable() {
  if (!pgPool || dbInitialized) return;
  try {
    await pgPool.query(`
      CREATE TABLE IF NOT EXISTS session_auth (
        id VARCHAR(255) PRIMARY KEY,
        data JSONB NOT NULL
      );
    `);
    dbInitialized = true;
  } catch (err) {
    console.error('Erro ao iniciar tabela no Supabase:', err);
  }
}

async function dbSaveJson(key: string, payload: any) {
  if (!pgPool) return;
  try {
    await ensureDatabaseTable();
    const serialized = JSON.stringify(payload, BufferJSON?.replacer);
    await pgPool.query(
      `INSERT INTO session_auth (id, data)
       VALUES ($1, $2::jsonb)
       ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data`,
      [key, serialized]
    );
  } catch {}
}

async function dbLoadJson<T = any>(key: string): Promise<T | null> {
  if (!pgPool) return null;
  try {
    await ensureDatabaseTable();
    const res = await pgPool.query('SELECT data FROM session_auth WHERE id = $1', [key]);
    if (!res.rows[0] || res.rows[0].data === undefined) return null;
    const rawStr =
      typeof res.rows[0].data === 'string'
        ? res.rows[0].data
        : JSON.stringify(res.rows[0].data);
    return JSON.parse(rawStr, BufferJSON?.reviver) as T;
  } catch {
    return null;
  }
}

async function dbRemoveKey(key: string) {
  if (!pgPool) return;
  try {
    await ensureDatabaseTable();
    await pgPool.query('DELETE FROM session_auth WHERE id = $1', [key]);
  } catch {}
}

export async function clearPostgresWhatsAppAuth() {
  if (!pgPool) return;
  try {
    await ensureDatabaseTable();
    await pgPool.query(
      `DELETE FROM session_auth WHERE id != '__app_engine_config__'`
    );
  } catch {}
}

async function setupConfigSync(engineConfigRef?: any) {
  if (!pgPool || configWatcherStarted) return;
  configWatcherStarted = true;

  try {
    const savedConfig = await dbLoadJson<any>('__app_engine_config__');
    if (savedConfig && typeof savedConfig === 'object') {
      if (engineConfigRef && typeof engineConfigRef === 'object') {
        Object.assign(engineConfigRef, savedConfig);
      }
      const str = JSON.stringify(savedConfig, null, 2);
      lastSavedConfigRaw = str;
      fs.writeFileSync(ENGINE_CONFIG_PATH, str, 'utf-8');
    } else if (engineConfigRef) {
      await dbSaveJson('__app_engine_config__', engineConfigRef);
    }
  } catch {}

  setInterval(() => {
    try {
      if (fs.existsSync(ENGINE_CONFIG_PATH)) {
        const currentRaw = fs.readFileSync(ENGINE_CONFIG_PATH, 'utf-8');
        if (currentRaw && currentRaw !== lastSavedConfigRaw) {
          lastSavedConfigRaw = currentRaw;
          const parsed = JSON.parse(currentRaw);
          void dbSaveJson('__app_engine_config__', parsed);
        }
      }
    } catch {}
  }, 4000);
}

export async function usePostgresAuthState(engineConfigRef?: any, forceReset = false) {
  if (!pgPool) {
    return useMultiFileAuthState(AUTH_DIR);
  }

  await ensureDatabaseTable();
  await setupConfigSync(engineConfigRef);

  if (forceReset) {
    await clearPostgresWhatsAppAuth();
  }

  const mirrorCredsToDisk = (credsObj: any) => {
    try {
      if (!fs.existsSync(AUTH_DIR)) {
        fs.mkdirSync(AUTH_DIR, { recursive: true });
      }
      fs.writeFileSync(
        path.join(AUTH_DIR, 'creds.json'),
        JSON.stringify(credsObj, BufferJSON?.replacer, 2),
        'utf-8'
      );
    } catch {}
  };

  let creds = await dbLoadJson<any>('creds');
  if (!creds) {
    creds = initAuthCreds();
  } else {
    mirrorCredsToDisk(creds);
  }

  return {
    state: {
      creds,
      keys: {
        get: async (type: string, ids: string[]) => {
          const data: { [key: string]: any } = {};
          if (!ids.length) return data;
          try {
            const dbKeys = ids.map((id) => `${type}-${id}`);
            const res = await pgPool.query(
              'SELECT id, data FROM session_auth WHERE id = ANY($1::text[])',
              [dbKeys]
            );
            for (const row of res.rows) {
              const rawId = String(row.id).slice(type.length + 1);
              const rawStr =
                typeof row.data === 'string' ? row.data : JSON.stringify(row.data);
              let parsed = JSON.parse(rawStr, BufferJSON?.reviver);
              if (
                type === 'app-state-sync-key' &&
                parsed &&
                Baileys.proto?.Message?.AppStateSyncKeyData
              ) {
                parsed = Baileys.proto.Message.AppStateSyncKeyData.fromObject(parsed);
              }
              data[rawId] = parsed;
            }
          } catch {}
          return data;
        },
        set: async (data: any) => {
          const tasks: Promise<any>[] = [];
          for (const category in data) {
            for (const id in data[category]) {
              const value = data[category][id];
              const key = `${category}-${id}`;
              if (value) {
                tasks.push(dbSaveJson(key, value));
              } else {
                tasks.push(dbRemoveKey(key));
              }
            }
          }
          await Promise.all(tasks);
        },
      },
    },
    saveCreds: async () => {
      mirrorCredsToDisk(creds);
      await dbSaveJson('creds', creds);
    },
  };
}
