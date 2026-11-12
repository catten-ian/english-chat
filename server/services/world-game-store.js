'use strict';

const crypto = require('node:crypto');
const WORLD = require('./world-game');

const SPAWN = Object.freeze({ x: 1.2, z: -10.5 });
const RETRY_DELAYS = [1000, 2000, 4000, 8000, 16000];
const MAX_ATTEMPTS = RETRY_DELAYS.length + 1;
const LEASE_MS = 5 * 60 * 1000;
const parse = (value, fallback) => { try { return JSON.parse(value); } catch (_) { return fallback; } };

/** All mutable game data lives in the app database, included in its normal snapshots.
 * Separate tables keep a client-written user_data payload from forging progress.
 * Additive schema is safe for existing deployments and rollback to older game code.
 */
function createWorldGameStore(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS world_game_journeys (
      user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      stage_id TEXT NOT NULL, last_npc_id TEXT, updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS world_game_positions (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      stage_id TEXT NOT NULL, x REAL NOT NULL, z REAL NOT NULL, updated_at INTEGER NOT NULL,
      PRIMARY KEY(user_id, stage_id)
    );
    CREATE TABLE IF NOT EXISTS world_game_turns (
      id TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      client_id TEXT NOT NULL, stage_id TEXT NOT NULL, npc_id TEXT NOT NULL,
      user_text TEXT NOT NULL, assistant_text TEXT, status TEXT NOT NULL,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
      UNIQUE(user_id, client_id)
    );
    CREATE INDEX IF NOT EXISTS idx_world_game_turn_scope ON world_game_turns(user_id,stage_id,npc_id,created_at);
    CREATE TABLE IF NOT EXISTS world_game_locks (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      stage_id TEXT NOT NULL, npc_id TEXT NOT NULL, owner TEXT NOT NULL, expires_at INTEGER NOT NULL,
      PRIMARY KEY(user_id, stage_id, npc_id)
    );
    CREATE TABLE IF NOT EXISTS world_game_quizzes (
      id TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      stage_id TEXT NOT NULL, items TEXT NOT NULL, answers TEXT NOT NULL DEFAULT '[]',
      settled INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_world_game_quiz_scope ON world_game_quizzes(user_id,stage_id,settled,created_at);
    CREATE TABLE IF NOT EXISTS world_game_settlements (
      id TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      stage_id TEXT NOT NULL, complete INTEGER NOT NULL, summary TEXT NOT NULL,
      score INTEGER NOT NULL, total INTEGER NOT NULL, created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_world_game_settlement_scope ON world_game_settlements(user_id,stage_id,complete);
    CREATE TABLE IF NOT EXISTS world_game_jobs (
      id TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      stage_id TEXT NOT NULL, npc_id TEXT, kind TEXT NOT NULL, source_id TEXT NOT NULL,
      provider TEXT NOT NULL, model TEXT, input TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0,
      next_at INTEGER NOT NULL, lease_owner TEXT, lease_until INTEGER,
      result TEXT, error TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
      UNIQUE(user_id, kind, source_id)
    );
    CREATE INDEX IF NOT EXISTS idx_world_game_job_queue ON world_game_jobs(status,next_at,lease_until);
    CREATE INDEX IF NOT EXISTS idx_world_game_job_user ON world_game_jobs(user_id,stage_id,kind,created_at);
  `);

  const transaction = fn => {
    db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); db.exec('COMMIT'); return result; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  };
  const ensureJourney = uid => {
    db.prepare('INSERT OR IGNORE INTO world_game_journeys(user_id,stage_id,updated_at) VALUES(?,?,?)').run(uid, WORLD.stages[0].id, Date.now());
    return db.prepare('SELECT * FROM world_game_journeys WHERE user_id=?').get(uid);
  };
  const getPosition = (uid, stageId) => db.prepare('SELECT x,z,updated_at FROM world_game_positions WHERE user_id=? AND stage_id=?').get(uid, stageId) || { ...SPAWN, updated_at: Date.now() - 5000 };
  const completedStages = uid => db.prepare('SELECT DISTINCT stage_id FROM world_game_settlements WHERE user_id=? AND complete=1').all(uid).map(row => row.stage_id);
  const unlocked = uid => {
    const completed = new Set(completedStages(uid));
    const stages = [WORLD.stages[0].id];
    for (let index = 0; index < WORLD.stages.length - 1 && completed.has(WORLD.stages[index].id); index++) stages.push(WORLD.stages[index + 1].id);
    return stages;
  };
  const getQuiz = (uid, id) => {
    const row = db.prepare('SELECT * FROM world_game_quizzes WHERE user_id=? AND id=?').get(uid, id);
    return row ? { ...row, items: parse(row.items, []), answers: parse(row.answers, []) } : null;
  };
  const currentQuiz = (uid, stageId) => {
    const row = db.prepare('SELECT id FROM world_game_quizzes WHERE user_id=? AND stage_id=? AND settled=0 ORDER BY created_at DESC,rowid DESC LIMIT 1').get(uid, stageId);
    return row ? getQuiz(uid, row.id) : null;
  };
  const publicQuiz = row => row ? { quizId: row.id, stageId: row.stage_id, questions: row.items.map(({ q, options }) => ({ q, options })), answers: row.answers } : undefined;
  const visited = (uid, stageId) => db.prepare("SELECT DISTINCT npc_id FROM world_game_turns WHERE user_id=? AND stage_id=? AND status='complete'").all(uid, stageId).map(row => row.npc_id);
  const putJob = (uid, stageId, kind, sourceId, input, settings, npcId = null) => {
    const now = Date.now();
    db.prepare(`INSERT OR IGNORE INTO world_game_jobs(id,user_id,stage_id,npc_id,kind,source_id,provider,model,input,next_at,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(crypto.randomUUID(), uid, stageId, npcId, kind, sourceId, settings.provider, settings.model || null, JSON.stringify(input), now, now, now);
    return db.prepare('SELECT * FROM world_game_jobs WHERE user_id=? AND kind=? AND source_id=?').get(uid, kind, sourceId);
  };
  const publicJob = row => ({
    id: row.id, stageId: row.stage_id, npcId: row.npc_id,
    npcName: WORLD.npcs[row.npc_id]?.name || 'Field notes', text: parse(row.input, {}).text || '',
    createdAt: row.created_at, status: row.status === 'running' ? 'pending' : row.status,
    attempts: row.attempts, ...(row.result ? { feedback: row.result } : {}),
    ...(row.error ? { error: row.error } : {}), ...(row.status === 'retry' ? { nextAttemptAt: row.next_at } : {})
  });
  const jobSources = (uid, ids) => ids.map(id => db.prepare('SELECT * FROM world_game_jobs WHERE user_id=? AND id=?').get(uid, id));
  const feedbackSnapshot = uid => {
    const records = db.prepare("SELECT * FROM world_game_jobs WHERE user_id=? AND kind='feedback' ORDER BY created_at,rowid").all(uid).map(publicJob);
    const summaries = db.prepare("SELECT * FROM world_game_jobs WHERE user_id=? AND kind='summary' ORDER BY created_at,rowid").all(uid).map(row => {
      const source = parse(row.input, {});
      const parts = jobSources(uid, source.childIds || []);
      return { id: row.id, stageId: row.stage_id, createdAt: row.created_at, status: row.status === 'running' ? 'pending' : row.status,
        ...(row.result ? { text: row.result } : {}), ...(row.error ? { error: row.error } : {}),
        totalReplies: source.count || 0, pendingCount: parts.filter(part => part && !['ready', 'failed'].includes(part.status)).length };
    });
    return { records, summaries };
  };
  const enqueueSummary = (uid, stageId, settlementId, settings) => {
    const jobs = db.prepare("SELECT id FROM world_game_jobs WHERE user_id=? AND stage_id=? AND kind='feedback' ORDER BY created_at,rowid").all(uid, stageId);
    const childIds = [];
    for (let index = 0; index < jobs.length; index += 12) {
      const sourceIds = jobs.slice(index, index + 12).map(row => row.id);
      childIds.push(putJob(uid, stageId, 'summary_chunk', `${settlementId}:${index / 12}`, { sourceIds }, settings).id);
    }
    return putJob(uid, stageId, 'summary', settlementId, { childIds, count: jobs.length }, settings);
  };

  return {
    db, transaction, ensureJourney, getPosition, completedStages, unlocked, visited,
    getQuiz, currentQuiz, publicQuiz, feedbackSnapshot, publicJob,
    state(uid) {
      const journey = ensureJourney(uid);
      const byStage = Object.fromEntries(WORLD.stages.map(stage => [stage.id, visited(uid, stage.id)]));
      const pos = getPosition(uid, journey.stage_id);
      return {
        stageId: journey.stage_id, position: { x: pos.x, z: pos.z },
        unlockedStageIds: unlocked(uid), completedStageIds: completedStages(uid),
        stages: WORLD.stages.map(({ id, title, name, objective, publicFacts, npcs }) => ({ id, title, name,
          objective: id === journey.stage_id ? objective : '',
          publicFacts: id === journey.stage_id ? publicFacts : [],
          npcs: id === journey.stage_id ? npcs : [] })),
        visitedNpcIds: byStage[journey.stage_id], visitedByStage: byStage, lastNpcId: journey.last_npc_id,
        evidence: db.prepare("SELECT id,stage_id,npc_id,assistant_text,created_at FROM world_game_turns WHERE user_id=? AND status='complete' ORDER BY created_at,rowid").all(uid)
          .map(row => ({ id: row.id, stageId: row.stage_id, source: row.npc_id, text: row.assistant_text, createdAt: row.created_at })),
        quiz: publicQuiz(currentQuiz(uid, journey.stage_id)),
        settlements: db.prepare('SELECT id,stage_id,complete,summary,score,total,created_at FROM world_game_settlements WHERE user_id=? ORDER BY created_at,rowid').all(uid)
          .map(row => ({ id: row.id, stageId: row.stage_id, complete: !!row.complete, summary: row.summary, score: row.score, total: row.total, completedAt: row.created_at })),
        feedback: feedbackSnapshot(uid)
      };
    },
    changeStage(uid, stageId) {
      ensureJourney(uid);
      if (!unlocked(uid).includes(stageId)) return false;
      db.prepare('UPDATE world_game_journeys SET stage_id=?,last_npc_id=NULL,updated_at=? WHERE user_id=?').run(stageId, Date.now(), uid);
      return true;
    },
    move(uid, stageId, position) {
      db.prepare(`INSERT INTO world_game_positions(user_id,stage_id,x,z,updated_at) VALUES(?,?,?,?,?)
        ON CONFLICT(user_id,stage_id) DO UPDATE SET x=excluded.x,z=excluded.z,updated_at=excluded.updated_at`).run(uid, stageId, position.x, position.z, Date.now());
    },
    history(uid, stageId, npcId) {
      const rows = db.prepare("SELECT user_text,assistant_text FROM world_game_turns WHERE user_id=? AND stage_id=? AND npc_id=? AND status='complete' ORDER BY created_at DESC,rowid DESC LIMIT 4").all(uid, stageId, npcId).reverse();
      return rows.flatMap(row => [{ role: 'user', content: row.user_text }, { role: 'assistant', content: row.assistant_text }]);
    },
    beginTurn(uid, stageId, npcId, text, clientId, settings) {
      return transaction(() => {
        const existing = db.prepare('SELECT id,status FROM world_game_turns WHERE user_id=? AND client_id=?').get(uid, clientId);
        if (existing) return { duplicate: true, ...existing };
        const now = Date.now(), id = crypto.randomUUID();
        const lock = db.prepare(`INSERT INTO world_game_locks(user_id,stage_id,npc_id,owner,expires_at) VALUES(?,?,?,?,?)
          ON CONFLICT(user_id,stage_id,npc_id) DO UPDATE SET owner=excluded.owner,expires_at=excluded.expires_at WHERE world_game_locks.expires_at<=?`)
          .run(uid, stageId, npcId, id, now + LEASE_MS, now);
        if (!lock.changes) return { locked: true };
        db.prepare("INSERT INTO world_game_turns(id,user_id,client_id,stage_id,npc_id,user_text,status,created_at,updated_at) VALUES(?,?,?,?,?,?,'running',?,?)").run(id, uid, clientId, stageId, npcId, text, now, now);
        putJob(uid, stageId, 'feedback', clientId, { text }, settings, npcId);
        return { id };
      });
    },
    finishTurn(uid, id, answer) {
      transaction(() => {
        const row = db.prepare('SELECT stage_id,npc_id FROM world_game_turns WHERE user_id=? AND id=?').get(uid, id);
        if (!row) return;
        db.prepare('UPDATE world_game_turns SET assistant_text=?,status=?,updated_at=? WHERE user_id=? AND id=?').run(answer || null, answer ? 'complete' : 'failed', Date.now(), uid, id);
        if (answer) db.prepare('UPDATE world_game_journeys SET last_npc_id=?,updated_at=? WHERE user_id=? AND stage_id=?').run(row.npc_id, Date.now(), uid, row.stage_id);
        db.prepare('DELETE FROM world_game_locks WHERE user_id=? AND stage_id=? AND npc_id=? AND owner=?').run(uid, row.stage_id, row.npc_id, id);
      });
    },
    createQuiz(uid, stageId, items) {
      return transaction(() => {
        const existing = currentQuiz(uid, stageId);
        if (existing) return existing;
        const id = crypto.randomBytes(24).toString('base64url'), now = Date.now();
        db.prepare('INSERT INTO world_game_quizzes(id,user_id,stage_id,items,created_at,updated_at) VALUES(?,?,?,?,?,?)').run(id, uid, stageId, JSON.stringify(items), now, now);
        return getQuiz(uid, id);
      });
    },
    answer(uid, quizId, index, choice) {
      return transaction(() => {
        const quiz = getQuiz(uid, quizId);
        if (!quiz || quiz.settled || !Number.isInteger(index) || !quiz.items[index] || !Number.isInteger(choice) || choice < 0 || choice > 3) return { error: 'invalid answer', status: 400 };
        if (quiz.answers[index]) return { error: 'already answered', status: 409 };
        const item = quiz.items[index];
        const result = { correct: choice === item.answer, explanation: String(item.why || ''), selected: choice };
        quiz.answers[index] = result;
        db.prepare('UPDATE world_game_quizzes SET answers=?,updated_at=? WHERE user_id=? AND id=?').run(JSON.stringify(quiz.answers), Date.now(), uid, quizId);
        return result;
      });
    },
    settle(uid, quizId, settlement, settings) {
      return transaction(() => {
        const quiz = getQuiz(uid, quizId);
        if (!quiz || quiz.settled) return null;
        const now = Date.now();
        db.prepare('INSERT INTO world_game_settlements(id,user_id,stage_id,complete,summary,score,total,created_at) VALUES(?,?,?,?,?,?,?,?)')
          .run(quizId, uid, quiz.stage_id, settlement.complete ? 1 : 0, settlement.summary, settlement.score, settlement.total, now);
        db.prepare('UPDATE world_game_quizzes SET settled=1,updated_at=? WHERE user_id=? AND id=?').run(now, uid, quizId);
        const summary = settlement.complete ? enqueueSummary(uid, quiz.stage_id, quizId, settings) : null;
        return summary;
      });
    },
    enqueueFeedback(uid, stageId, npcId, text, clientId, settings) {
      return publicJob(putJob(uid, stageId, 'feedback', clientId, { text }, settings, npcId));
    },
    retry(uid, id) {
      return transaction(() => {
        const row = db.prepare('SELECT * FROM world_game_jobs WHERE user_id=? AND id=?').get(uid, id);
        if (!row || row.status !== 'failed') return false;
        const ids = row.kind === 'summary' ? [...(parse(row.input, {}).childIds || []), id] : [id];
        for (const jobId of ids) db.prepare("UPDATE world_game_jobs SET status='pending',attempts=0,next_at=?,error=NULL,lease_owner=NULL,lease_until=NULL,updated_at=? WHERE user_id=? AND id=? AND status='failed'").run(Date.now(), Date.now(), uid, jobId);
        return true;
      });
    },
    claimJob(owner) {
      return transaction(() => {
        const now = Date.now();
        db.prepare("UPDATE world_game_jobs SET status=CASE WHEN attempts>=? THEN 'failed' ELSE 'retry' END,error='The previous feedback worker was interrupted.',next_at=?,lease_owner=NULL,lease_until=NULL WHERE status='running' AND lease_until<=?").run(MAX_ATTEMPTS, now, now);
        const row = db.prepare("SELECT * FROM world_game_jobs WHERE status IN ('pending','retry') AND next_at<=? ORDER BY CASE kind WHEN 'feedback' THEN 0 WHEN 'summary_chunk' THEN 1 ELSE 2 END,created_at,rowid LIMIT 1").get(now);
        if (!row) return null;
        const input = parse(row.input, {});
        const dependencies = jobSources(row.user_id, row.kind === 'summary' ? input.childIds || [] : row.kind === 'summary_chunk' ? input.sourceIds || [] : []);
        if (dependencies.some(part => !part)) {
          db.prepare("UPDATE world_game_jobs SET status='failed',error='A source for this chapter report is missing. Contact support before retrying.',updated_at=? WHERE id=?").run(now, row.id);
          return { waiting: true };
        }
        if (dependencies.some(part => !['ready', 'failed'].includes(part.status))) {
          db.prepare('UPDATE world_game_jobs SET next_at=? WHERE id=?').run(now + 1000, row.id); return { waiting: true };
        }
        if (row.kind === 'summary' && dependencies.some(part => part?.status === 'failed')) {
          db.prepare("UPDATE world_game_jobs SET status='failed',error='A chapter feedback section failed. Retry the chapter report to recover all sections.',updated_at=? WHERE id=?").run(now, row.id); return { waiting: true };
        }
        if (row.attempts >= MAX_ATTEMPTS) {
          db.prepare("UPDATE world_game_jobs SET status='failed',error='Feedback retry limit reached.',updated_at=? WHERE id=?").run(now, row.id); return { waiting: true };
        }
        db.prepare("UPDATE world_game_jobs SET status='running',attempts=attempts+1,lease_owner=?,lease_until=?,updated_at=? WHERE id=?").run(owner, now + LEASE_MS, now, row.id);
        return { ...row, attempts: row.attempts + 1, input, dependencies, lease_owner: owner };
      });
    },
    completeJob(id, owner, result) {
      return db.prepare("UPDATE world_game_jobs SET status='ready',result=?,error=NULL,lease_owner=NULL,lease_until=NULL,updated_at=? WHERE id=? AND lease_owner=? AND status='running'").run(result, Date.now(), id, owner).changes > 0;
    },
    failJob(job, owner, error, retryable) {
      const delay = RETRY_DELAYS[job.attempts - 1];
      const retry = retryable && delay !== undefined;
      return db.prepare("UPDATE world_game_jobs SET status=?,error=?,next_at=?,lease_owner=NULL,lease_until=NULL,updated_at=? WHERE id=? AND lease_owner=? AND status='running'")
        .run(retry ? 'retry' : 'failed', String(error).slice(0, 300), Date.now() + (delay || 0), Date.now(), job.id, owner).changes > 0;
    }
  };
}

let defaultStore;
function getDefaultStore() {
  if (!defaultStore) defaultStore = createWorldGameStore(require('../db').db);
  return defaultStore;
}

module.exports = { createWorldGameStore, getDefaultStore, SPAWN, RETRY_DELAYS, MAX_ATTEMPTS, LEASE_MS };
