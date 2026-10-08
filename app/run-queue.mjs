import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';

export class RunQueue {
  constructor(state, save, execute, busy, before) {
    this.state = state; this.save = save; this.execute = execute; this.busy = busy; this.before = before; this.pumping = false; this.stopping = false;
    state.runs ||= [];
    for (const run of state.runs) if (run.status === 'running') { run.status = 'interrupted'; run.phase = 'Server restarted. Continue from saved project files.'; run.finishedAt = new Date().toISOString(); }
    this.save();
  }
  enqueue(input) {
    if (this.stopping) throw new Error('The app is stopping. Relaunch it before adding a request.');
    if (this.state.runs.filter(r => r.status === 'queued').length >= 20) throw new Error('The queue has 20 requests. Wait or cancel one.');
    const run = { id: randomUUID(), ...input, status: 'queued', phase: 'Queued', output: '', events: [], createdAt: new Date().toISOString() };
    this.state.runs.push(run); this.save(); setTimeout(() => void this.pump(), 0); return run;
  }
  event(run, value) {
    if (value.type === 'phase') run.phase = value.phase;
    if (value.type === 'terminal') run.output = (run.output + value.output).slice(-40_000);
    if (!['delta', 'terminal', 'start'].includes(value.type)) { run.events.push({ ...(value.type === 'done' ? {type:'done'} : value), at: new Date().toISOString() }); run.events = run.events.slice(-100); }
    if (value.type === 'done') {
      const assistant = value.chat.messages.at(-1); run.status = assistant.status === 'complete' || assistant.status === 'length' ? 'complete' : assistant.status;
      run.error = assistant.error; run.messageId = assistant.id; run.phase = run.status === 'complete' ? 'Finished' : run.status;
    }
    if (!run.savedAt || Date.now() - run.savedAt > 750 || value.type === 'done') { run.savedAt = Date.now(); this.save(); }
  }
  async pump() {
    if (this.pumping || this.stopping || this.busy()) return;
    const run = this.state.runs.find(r => r.status === 'queued'); if (!run) return;
    this.pumping = true; run.status = 'running'; run.startedAt = new Date().toISOString(); this.save();
    const req = new EventEmitter(), res = new EventEmitter();
    res.destroyed = false; res.writableEnded = false; res.headersSent = false;
    res.writeHead = () => { res.headersSent = true; };
    res.write = text => { for (const line of String(text).trim().split('\n')) if (line) this.event(run, JSON.parse(line)); return true; };
    res.end = () => { res.writableEnded = true; };
    try { if (this.before) await this.before(run); await this.execute(req, res, { ...run, runId: run.id }); if (run.status === 'running') run.status = 'error'; }
    catch (error) { run.status = 'error'; run.phase = 'Failed to start'; run.error = error.message; }
    finally { run.finishedAt = new Date().toISOString(); this.save(); this.pumping = false; if (!this.stopping) setTimeout(() => void this.pump(), 25); }
  }
  cancelQueued(id) {
    const run = this.state.runs.find(r => r.id === id); if (!run) throw new Error('Run not found.');
    if (run.status === 'queued') { run.status = 'stopped'; run.finishedAt = new Date().toISOString(); this.save(); }
    return run;
  }
  close() { this.stopping = true; }
}
