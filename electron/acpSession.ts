/** Milu's main-process wrapper around an ACP (Agent Client Protocol)
 *  session. Each instance owns one subprocess (the ACP-speaking agent
 *  binary, e.g. claude-code-acp), the JSON-RPC connection running
 *  over its stdin/stdout, and the IPC channel back to the renderer.
 *
 *  Architecture:
 *  - Renderer creates a session via `acp:start` with a stable reqId.
 *  - All session events flow back on a single channel
 *    `acp:event:${reqId}` as `{ event, payload }` envelopes — keeps
 *    listener wiring identical to the existing AI-chat pattern.
 *  - Renderer sends prompts/cancels via per-method IPC handlers that
 *    look up the AcpSession by reqId. */

import { spawn, type ChildProcess } from 'node:child_process';
import { Writable, Readable } from 'node:stream';
import { promises as fs } from 'node:fs';
import type { WebContents } from 'electron';
import * as acp from '@agentclientprotocol/sdk';
import { reviewRegistry } from './acpReview.js';

export interface AcpAgent {
  id: string;
  name: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
}

interface PendingPermission {
  resolve: (r: acp.RequestPermissionResponse) => void;
}

export class AcpSession {
  readonly reqId: string;
  private webContents: WebContents;
  private cwd: string;
  private proc: ChildProcess | null = null;
  private conn: acp.ClientSideConnection | null = null;
  private sessionId: string | null = null;
  /** Pending permission prompts the agent has asked us about. The
   *  renderer's response (via `acp:permission-resolve`) finds and
   *  resolves the matching promise here. */
  private pendingPermissions = new Map<string, PendingPermission>();
  private nextPermId = 0;
  /** Set after `dispose()` so any in-flight async handlers don't try
   *  to write back to a destroyed WebContents or a killed subprocess. */
  private disposed = false;

  constructor(reqId: string, webContents: WebContents, cwd: string) {
    this.reqId = reqId;
    this.webContents = webContents;
    this.cwd = cwd;
  }

  /** Spawns the agent subprocess, runs the ACP `initialize` handshake,
   *  creates a fresh conversation session, and reports the session id
   *  back to the renderer. Failures bubble up via the return value;
   *  the agent's own log lines (auth_required errors, etc.) come
   *  through the `stderr` event. */
  async start(agent: AcpAgent): Promise<{ ok: boolean; sessionId?: string; error?: string }> {
    try {
      this.proc = spawn(agent.command, agent.args, {
        cwd: this.cwd,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, ...(agent.env ?? {}) },
      });
      this.proc.stderr?.setEncoding('utf8');
      this.proc.stderr?.on('data', (d) => this.send('stderr', String(d)));
      this.proc.on('exit', (code, signal) => {
        this.send('exit', { code, signal });
      });
      this.proc.on('error', (err) => this.send('error', err.message));
      // CRITICAL: when the subprocess dies mid-stream, writes to its
      // stdin emit `error` events (EPIPE / ECONNRESET). Without an
      // explicit listener Node treats this as fatal and crashes the
      // *entire* main process, taking Milu down with it. The same
      // applies to stdout reads after FD close. We swallow both —
      // disposal already ran (or is about to).
      this.proc.stdin?.on('error', (err) => this.send('stderr', `[stdin] ${err.message}`));
      this.proc.stdout?.on('error', (err) => this.send('stderr', `[stdout] ${err.message}`));

      // Web stream adapters — the SDK speaks newline-delimited JSON
      // over WHATWG streams. Node's classic streams adapt cleanly.
      const input = Writable.toWeb(this.proc.stdin!);
      const output = Readable.toWeb(this.proc.stdout!);
      const stream = acp.ndJsonStream(input, output);

      this.conn = new acp.ClientSideConnection(
        () => ({
          requestPermission: (p) => this.handlePermission(p),
          sessionUpdate: async (p) => {
            this.send('update', p);
          },
          readTextFile: (p) => this.handleReadFile(p),
          writeTextFile: (p) => this.handleWriteFile(p),
        }),
        stream,
      );

      const init = await this.conn.initialize({
        protocolVersion: acp.PROTOCOL_VERSION,
        clientCapabilities: {
          fs: { readTextFile: true, writeTextFile: true },
        },
      });
      this.send('initialized', {
        agentCapabilities: init.agentCapabilities,
        authMethods: init.authMethods ?? [],
      });

      const newSession = await this.conn.newSession({
        cwd: this.cwd,
        mcpServers: [],
      });
      this.sessionId = newSession.sessionId;
      return { ok: true, sessionId: newSession.sessionId };
    } catch (e) {
      this.dispose();
      return { ok: false, error: (e as Error).message };
    }
  }

  /** Sends a single user message. Resolves with the stop reason once
   *  the agent declares the turn complete (or the user cancels). */
  async prompt(text: string): Promise<{ ok: boolean; stopReason?: string; error?: string }> {
    if (!this.conn || !this.sessionId) return { ok: false, error: 'session not started' };
    try {
      const res = await this.conn.prompt({
        sessionId: this.sessionId,
        prompt: [{ type: 'text', text }],
      });
      return { ok: true, stopReason: res.stopReason };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  }

  /** Best-effort cancel — sends `session/cancel` to the agent so it
   *  aborts its current LLM call / tool execution. The in-flight
   *  `prompt()` promise resolves with `stopReason: "cancelled"`. */
  async cancel(): Promise<void> {
    if (!this.conn || !this.sessionId) return;
    try {
      await this.conn.cancel({ sessionId: this.sessionId });
    } catch {
      // notification — best effort
    }
  }

  /** Renderer's response to a permission prompt. */
  resolvePermission(permId: string, response: acp.RequestPermissionResponse): void {
    const p = this.pendingPermissions.get(permId);
    if (!p) return;
    this.pendingPermissions.delete(permId);
    p.resolve(response);
  }

  /** Tear down: kill the subprocess, drop pending state, mark
   *  disposed so straggler handlers no-op. Idempotent. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    // Anyone awaiting our permission decisions: tell the agent the
    // user cancelled so it unwinds rather than hanging.
    for (const p of this.pendingPermissions.values()) {
      p.resolve({ outcome: { outcome: 'cancelled' } });
    }
    this.pendingPermissions.clear();
    // Drop any in-flight write reviews — agent gets errors for
    // unresolved writeTextFile calls, which lets it surface "review
    // abandoned" in the next prompt response.
    reviewRegistry.abandonSession(this.reqId);
    if (this.proc && this.proc.exitCode == null) {
      this.proc.kill();
    }
    this.proc = null;
    this.conn = null;
    this.sessionId = null;
  }

  // ---------- Client-side method handlers ----------

  private handlePermission(
    params: acp.RequestPermissionRequest,
  ): Promise<acp.RequestPermissionResponse> {
    return new Promise((resolve) => {
      const permId = `p${++this.nextPermId}`;
      this.pendingPermissions.set(permId, { resolve });
      this.send('permission-request', { permId, params });
    });
  }

  /** Plain disk read for now. Task 21 will route this through the
   *  renderer's open-buffer cache so the agent sees uncommitted edits. */
  private async handleReadFile(
    p: acp.ReadTextFileRequest,
  ): Promise<acp.ReadTextFileResponse> {
    const content = await fs.readFile(p.path, 'utf8');
    if (p.line == null && p.limit == null) return { content };
    const lines = content.split('\n');
    const start = (p.line ?? 1) - 1;
    const end = p.limit != null ? start + p.limit : lines.length;
    return { content: lines.slice(start, end).join('\n') };
  }

  /** Cursor-style review gate. Instead of clobbering disk, we stage
   *  the proposed write as a pending change in the review registry,
   *  notify the renderer so it can show the inline diff, then await
   *  the user's decision. Once they accept-all / reject-all / decide
   *  per-hunk, the registry writes the merged content to disk and
   *  resolves our promise — that's what unblocks the agent. */
  private handleWriteFile(
    p: acp.WriteTextFileRequest,
  ): Promise<acp.WriteTextFileResponse> {
    return new Promise((resolve, reject) => {
      void (async () => {
        try {
          const change = await reviewRegistry.create(this.reqId, p.path, p.content);
          reviewRegistry.setResolver(change.id, {
            resolve: () => {
              this.send('file-written', { path: p.path });
              resolve({});
            },
            reject: (err) => reject(err),
          });
          // Tell the renderer a new review is up — the editor pane
          // will switch into review mode the next time the path's
          // tab renders.
          this.send('review-created', {
            id: change.id,
            path: change.path,
            unifiedDiff: change.unifiedDiff,
            hunkCount: change.hunks.length,
          });
        } catch (err) {
          reject(err as Error);
        }
      })();
    });
  }

  private send(event: string, payload?: unknown): void {
    if (this.disposed) return;
    if (this.webContents.isDestroyed()) return;
    try {
      this.webContents.send(`acp:event:${this.reqId}`, { event, payload });
    } catch {
      // BrowserWindow can be in a transitional state (closing, page
      // navigation, devtools dock change) where send throws despite
      // !isDestroyed. Swallow — the renderer either reconnects or
      // the tab is going away anyway.
    }
  }
}

/** Live registry — main.ts uses this to look up sessions by reqId
 *  when handling per-session IPC calls (prompt/cancel/resolve/dispose). */
export const acpSessions = new Map<string, AcpSession>();
