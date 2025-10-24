import { getPublicKey as $, finalizeEvent as v, generateSecretKey as N, verifyEvent as R } from "nostr-tools/pure";
import { finalizeEvent as te, generateSecretKey as se, getPublicKey as re, verifyEvent as ie } from "nostr-tools/pure";
import * as g from "nostr-tools/nip04";
import { SimplePool as P, useWebSocketImplementation as D } from "nostr-tools/pool";
import { SimplePool as ne, useWebSocketImplementation as ae } from "nostr-tools/pool";
import * as _ from "nostr-tools/nip19";
import { hexToBytes as H, bytesToHex as k } from "@noble/hashes/utils";
import { bytesToHex as le, hexToBytes as ue } from "@noble/hashes/utils";
import { EventEmitter as z } from "events";
function x(r) {
  return typeof r == "string" && r.startsWith("nsec1");
}
function W(r) {
  return typeof r == "string" && r.startsWith("npub1");
}
function I(r) {
  if (!x(r))
    throw new Error("Invalid nsec key");
  return _.decode(r).data;
}
function T(r) {
  if (r instanceof Uint8Array)
    return r;
  if (Buffer.isBuffer(r))
    return Uint8Array.from(r);
  if (typeof r == "string") {
    if (x(r))
      return I(r);
    if (M(r))
      return H(r);
  }
  throw new Error("Unsupported secret key format");
}
function C(r) {
  const e = T(r);
  return k(e);
}
function B(r) {
  const e = T(r);
  return _.nsecEncode(e);
}
function L(r) {
  const e = T(r);
  return $(e);
}
function U(r) {
  if (!W(r))
    throw new Error("Invalid npub key");
  return _.decode(r).data.toLowerCase();
}
function J(r) {
  const e = q(r);
  return _.npubEncode(e);
}
function q(r) {
  if (r instanceof Uint8Array)
    return k(r);
  if (Buffer.isBuffer(r))
    return Buffer.from(r).toString("hex");
  if (typeof r == "string") {
    if (W(r))
      return U(r);
    if (M(r))
      return r.toLowerCase();
  }
  throw new Error("Unsupported public key format");
}
function M(r) {
  return typeof r == "string" && /^[0-9a-fA-F]{64}$/.test(r);
}
const h = {
  isNsecKey: x,
  isNpubKey: W,
  decodeNsecToBytes: I,
  normalizeSecretKey: T,
  secretToHex: C,
  encodeSecretToNsec: B,
  derivePubkeyFromSecret: L,
  decodeNpubToHex: U,
  encodePubkeyToNpub: J,
  publicToHex: q,
  isHex64: M
};
class O {
  constructor(e = {}) {
    this.relayUrls = e.relays || ["wss://dev-relay.lnfi.network"], this.pool = new P({ enablePing: !0, enableReconnect: !0 }), this.privateKey = e.privateKey ? h.normalizeSecretKey(e.privateKey) : void 0, this.publicKey = e.publicKey ? h.publicToHex(e.publicKey) : void 0, this.serverPublicKey = e.serverPublicKey ? h.publicToHex(e.serverPublicKey) : void 0, this.timeout = e.timeout || 3e4;
  }
  /**
   * Initialize connection (SimplePool manages connections automatically)
   */
  async connect() {
    console.log(`Client ready to use relays: ${this.relayUrls.join(", ")}`);
  }
  /**
   * Send RPC request
   */
  async call(e, s = {}) {
    return new Promise(async (t, i) => {
      const o = `${Date.now()}-${Math.random()}`, n = { method: e, params: s, id: o };
      let a, c, d = !1;
      const E = () => {
        c && (clearTimeout(c), c = null), a && (a.close(), a = null);
      }, y = (l, m) => {
        d || (d = !0, E(), l ? i(l) : t(m));
      };
      try {
        const l = JSON.stringify(n), m = await g.encrypt(
          this.privateKey,
          this.serverPublicKey,
          l
        ), w = {
          kind: 4,
          pubkey: this.publicKey,
          created_at: Math.floor(Date.now() / 1e3),
          tags: [["p", this.serverPublicKey]],
          content: m
        }, K = v(w, this.privateKey);
        c = setTimeout(() => {
          y(new Error(`Request timeout after ${this.timeout}ms`));
        }, this.timeout), a = this.pool.subscribe(
          this.relayUrls,
          { kinds: [4], "#p": [this.publicKey], authors: [this.serverPublicKey] },
          {
            onevent: async (b) => {
              if (d) return;
              const u = b.tags.find((p) => p[0] === "p");
              if (!(!u || u[1] !== this.publicKey || b.pubkey !== this.serverPublicKey))
                try {
                  const p = await g.decrypt(
                    this.privateKey,
                    this.serverPublicKey,
                    b.content
                  ), f = JSON.parse(p);
                  f.id === o && (f.error ? y(new Error(f.error)) : y(null, f.result));
                } catch (p) {
                  console.error("Error decrypting reply:", p.message);
                }
            }
          }
        ), await Promise.any(this.pool.publish(this.relayUrls, K)), console.log(`Sent ${e}`);
      } catch (l) {
        y(l);
      }
    });
  }
  /**
   * Send plain text direct message and wait for reply
   */
  async sendMessage(e, s, t = !1) {
    const i = h.publicToHex(s);
    return new Promise(async (o, n) => {
      let a, c, d = !1;
      const E = () => {
        c && (clearTimeout(c), c = null), a && (a.close(), a = null);
      }, y = (l, m) => {
        d || (d = !0, E(), l ? n(l) : o(m));
      };
      try {
        const l = await g.encrypt(
          this.privateKey,
          i,
          e
        ), m = {
          kind: 4,
          pubkey: this.publicKey,
          created_at: Math.floor(Date.now() / 1e3),
          tags: [["p", i]],
          content: l
        }, w = v(m, this.privateKey), K = w.id, b = m.created_at;
        if (!t) {
          await Promise.any(this.pool.publish(this.relayUrls, w)), console.log(`Message sent to ${i.slice(0, 8)}`), y(null, { success: !0, timestamp: b, eventId: K });
          return;
        }
        c = setTimeout(() => {
          y(new Error(`Reply timeout after ${this.timeout}ms`));
        }, this.timeout), a = this.pool.subscribe(
          this.relayUrls,
          { kinds: [4], "#p": [this.publicKey], authors: [i], since: b },
          {
            onevent: async (u) => {
              if (!d) {
                console.log(`[Client] Received reply event ${u.id.slice(0, 8)} from ${u.pubkey.slice(0, 8)}`), console.log("[Client] Event tags:", u.tags), console.log("[Client] Event content:", u);
                try {
                  const p = u.tags.find((S) => S[0] === "p"), f = u.tags.find((S) => S[0] === "e");
                  if (!p || p[1] !== this.publicKey || u.pubkey !== i) {
                    console.log("[Client] Skipping: p or author mismatch");
                    return;
                  }
                  if (f && f[1] !== K) {
                    console.log(`[Client] Skipping: e tag mismatch (expected ${K.slice(0, 8)}, got ${f[1].slice(0, 8)})`);
                    return;
                  }
                  f || console.log("[Client] Warning: Reply has no e tag, accepting anyway");
                  const A = await g.decrypt(
                    this.privateKey,
                    i,
                    u.content
                  );
                  y(null, {
                    success: !0,
                    reply: A,
                    sender: i,
                    timestamp: u.created_at,
                    eventId: u.id
                  });
                } catch (p) {
                  console.error("Error decrypting reply:", p.message);
                }
              }
            }
          }
        ), await Promise.any(this.pool.publish(this.relayUrls, w)), console.log(`Message sent to ${i.slice(0, 8)}, waiting for reply...`);
      } catch (l) {
        console.error("Error sending message:", l.message), y(l);
      }
    });
  }
  /**
   * Listen for plain text direct messages from a specific sender
   */
  listenForMessages(e, s, t) {
    const i = h.publicToHex(e);
    return this.pool.subscribe(
      this.relayUrls,
      { kinds: [4], "#p": [this.publicKey], authors: [i] },
      {
        onevent: async (n) => {
          try {
            const a = n.tags.find((d) => d[0] === "p");
            if (!a || a[1] !== this.publicKey || n.pubkey !== e)
              return;
            const c = await g.decrypt(
              this.privateKey,
              i,
              n.content
            );
            s({
              text: c,
              sender: e,
              timestamp: n.created_at,
              eventId: n.id
            });
          } catch (a) {
            console.error("Error decrypting message:", a.message), t && t(a);
          }
        }
      }
    );
  }
  /**
   * Close connections
   */
  close() {
    this.pool.close(this.relayUrls);
  }
}
function Q() {
  const r = [];
  let e = 0;
  return {
    async enqueue(s) {
      const t = `mem_${Date.now()}_${e++}`;
      return r.push({ storageId: t, event: s }), t;
    },
    async dequeueBatch(s) {
      return r.splice(0, s);
    },
    async ack(s, t) {
    },
    async size() {
      return r.length;
    }
  };
}
class F extends z {
  constructor(e = {}) {
    super(), this.relayUrls = e.relays || ["wss://dev-relay.lnfi.network"], this.pool = new P({ enablePing: !0, enableReconnect: !0 }), this.privateKey = e.privateKey ? h.normalizeSecretKey(e.privateKey) : void 0, this.publicKey = e.publicKey ? h.publicToHex(e.publicKey) : void 0, this.processingMode = e.processingMode || "immediate", this.eventStorage = e.eventStorage || Q(), this.processingRate = Math.min(e.processingRate || 3, 3), this.eventTimeout = e.eventTimeout || 3e4, this._authorWhitelist = Array.isArray(e.allowedAuthors) ? e.allowedAuthors.map(h.publicToHex) : [], this._customGetAuthorWhitelist = e.getAuthorWhitelist, this.methodRegistry = /* @__PURE__ */ new Map(), this.isListening = !1, this.subscription = null, this.queueTimer = null, this._isProcessing = !1;
  }
  /**
   * Register business methods with optional auth configuration
   * @param {string} method - Method name
   * @param {Function} handler - Handler function
   * @param {Object} authConfig - Optional auth config { authMode, whitelist, authHandler }
   */
  registerMethod(e, s, t = {}) {
    if (typeof s != "function")
      throw new Error(`Handler for method "${e}" must be a function`);
    this.methodRegistry.set(e, {
      handler: s,
      authConfig: {
        authMode: t.authMode || "public",
        whitelist: t.whitelist || null,
        authHandler: t.authHandler || null
      }
    });
  }
  /**
   * Get current author whitelist (supports custom implementation)
   * @returns {Promise<string[]|null>} Whitelist array or null (no restriction)
   */
  async getAuthorWhitelist() {
    if (this._customGetAuthorWhitelist) {
      const e = this._customGetAuthorWhitelist();
      return e instanceof Promise ? await e : e;
    }
    return this._authorWhitelist.length > 0 ? this._authorWhitelist : null;
  }
  /**
   * Add pubkeys to internal whitelist
   */
  addToWhitelist(...e) {
    const s = e.map(h.publicToHex);
    this._authorWhitelist.push(...s.filter((t) => !this._authorWhitelist.includes(t)));
  }
  /**
   * Remove pubkeys from internal whitelist
   */
  removeFromWhitelist(...e) {
    const s = e.map(h.publicToHex);
    this._authorWhitelist = this._authorWhitelist.filter((t) => !s.includes(t));
  }
  /**
   * Clear internal whitelist
   */
  clearWhitelist() {
    this._authorWhitelist = [];
  }
  /**
   * Check if pubkey is in current whitelist
   */
  async isInWhitelist(e) {
    const s = await this.getAuthorWhitelist();
    return !s || s.length === 0 ? !0 : s.includes(h.publicToHex(e));
  }
  /**
   * Start listening
   */
  async start() {
    if (this.isListening) {
      console.log("Already listening for messages");
      return;
    }
    if (!this.privateKey || !this.publicKey)
      throw new Error("privateKey and publicKey are required");
    this.isListening = !0, console.log(`Starting Nostr SDK on relays: ${this.relayUrls.join(", ")}`);
    const e = {
      kinds: [4],
      since: Math.floor(Date.now() / 1e3),
      "#p": [this.publicKey]
    };
    this.subscription = this.pool.subscribe(
      this.relayUrls,
      e,
      {
        onevent: (s) => this._handleEvent(s)
      }
    ), this.processingMode === "queued" && this._startQueueProcessor(), console.log(`Subscribed to all relays (mode: ${this.processingMode})`), this.emit("started");
  }
  /**
   * Start queue processor timer
   */
  _startQueueProcessor() {
    const e = Math.floor(1e3 / this.processingRate);
    this.queueTimer = setInterval(() => this._processQueue(), e);
  }
  /**
   * Process queued events in batches with timeout and parallel execution
   */
  async _processQueue() {
    var e;
    if (!this._isProcessing) {
      this._isProcessing = !0;
      try {
        const s = Math.max(1, this.processingRate), t = await this.eventStorage.dequeueBatch(s);
        if (t.length === 0) return;
        const i = await Promise.allSettled(
          t.map((o) => this._processWithTimeout(o))
        );
        for (let o = 0; o < t.length; o++) {
          const n = t[o], a = i[o];
          if (a.status === "fulfilled")
            await this.eventStorage.ack(n.storageId, { status: "success" });
          else {
            const c = ((e = a.reason) == null ? void 0 : e.message) || "Unknown error";
            console.error(`Error processing ${n.storageId}:`, c), await this.eventStorage.ack(n.storageId, {
              status: "failed",
              error: c
            });
          }
        }
      } catch (s) {
        console.error("Error in queue processor:", s.message);
      } finally {
        this._isProcessing = !1;
      }
    }
  }
  /**
   * Process event with timeout wrapper
   */
  async _processWithTimeout(e) {
    let s;
    const t = new Promise((i, o) => {
      s = setTimeout(
        () => o(new Error("Event processing timeout")),
        this.eventTimeout
      );
    });
    try {
      return await Promise.race([
        this._processStoredEvent(e),
        t
      ]);
    } finally {
      s && clearTimeout(s);
    }
  }
  /**
   * Process a single stored event from queue
   */
  async _processStoredEvent(e) {
    const { event: s } = e, t = await this.getAuthorWhitelist();
    if (t && t.length > 0 && !t.includes(s.pubkey))
      throw new Error("sender_not_allowed");
    await this._processDecryptedEvent(s);
  }
  /**
   * Handle received events (entry point)
   */
  async _handleEvent(e) {
    try {
      const s = e.tags.find((i) => i[0] === "p");
      if (!s || s[1] !== this.publicKey)
        return;
      const t = await this.getAuthorWhitelist();
      if (t && t.length > 0 && !t.includes(e.pubkey)) {
        console.log(`[SDK] Sender ${e.pubkey.slice(0, 8)} not in whitelist`);
        return;
      }
      this.processingMode === "immediate" ? await this._processDecryptedEvent(e) : await this._storeEvent(e);
    } catch (s) {
      console.error("Error in _handleEvent:", s.message);
    }
  }
  /**
   * Store event to queue (queued mode only)
   */
  async _storeEvent(e) {
    var s;
    try {
      const t = await this.eventStorage.enqueue(e);
      console.log(`[SDK] Event ${(s = e.id) == null ? void 0 : s.slice(0, 8)} queued as ${t}`);
    } catch (t) {
      console.error("Error storing event:", t.message);
    }
  }
  /**
   * Process decrypted event (shared by immediate and queued modes)
   */
  async _processDecryptedEvent(e) {
    try {
      const s = await g.decrypt(this.privateKey, e.pubkey, e.content);
      let t;
      try {
        t = JSON.parse(s);
      } catch {
        await this._replyError(e.pubkey, "Invalid JSON format", null);
        return;
      }
      if (!t.method) {
        await this._replyError(e.pubkey, "Missing method field", null);
        return;
      }
      const i = this.methodRegistry.get(t.method);
      if (!i) {
        await this._replyError(e.pubkey, `Method not found: ${t.method}`, t.id);
        return;
      }
      if (!await this._checkPermission(t.method, e.pubkey, i.authConfig)) {
        await this._replyError(e.pubkey, `Permission denied for method: ${t.method}`, t.id);
        return;
      }
      const n = await i.handler(
        t.params || {},
        e,
        e.id,
        e.pubkey
      );
      await this._reply(e.pubkey, {
        id: t.id,
        result: n,
        error: null
      });
    } catch (s) {
      console.error("Error processing decrypted event:", s.message);
    }
  }
  /**
   * Check method-level permissions
   */
  async _checkPermission(e, s, t) {
    const { authMode: i, whitelist: o, authHandler: n } = t;
    return i === "public" ? !0 : i === "whitelist" ? o && o.length > 0 ? o.includes(s) : await this.isInWhitelist(s) : i === "custom" && n ? await n(s) : !1;
  }
  /**
   * Send direct message reply
   */
  async _reply(e, s) {
    try {
      const t = JSON.stringify(s), i = await g.encrypt(this.privateKey, e, t), o = {
        kind: 4,
        pubkey: this.publicKey,
        created_at: Math.floor(Date.now() / 1e3),
        tags: [["p", e]],
        content: i
      }, n = v(o, this.privateKey);
      await Promise.any(this.pool.publish(this.relayUrls, n)), console.log(`Replied to ${e.slice(0, 8)}`);
    } catch (t) {
      console.error("Error sending reply:", t.message), this.emit("error", t);
    }
  }
  /**
   * Send error reply
   */
  async _replyError(e, s, t) {
    await this._reply(e, {
      id: t,
      result: null,
      error: s
    });
  }
  /**
   * Stop listening and cleanup resources
   */
  stop() {
    this.isListening = !1, this.queueTimer && (clearInterval(this.queueTimer), this.queueTimer = null), this.subscription && (this.subscription.close(), this.subscription = null), this.pool.close(this.relayUrls), console.log("SDK stopped"), this.emit("stopped");
  }
}
const Y = {
  NostrClient: O,
  NostrSdk: F,
  nip04: g,
  nip19: _,
  SimplePool: P,
  useWebSocketImplementation: D,
  finalizeEvent: v,
  verifyEvent: R,
  generateSecretKey: N,
  getPublicKey: $,
  bytesToHex: k,
  hexToBytes: H,
  keyUtils: h
};
export {
  O as NostrClient,
  F as NostrSdk,
  ne as SimplePool,
  le as bytesToHex,
  Y as default,
  te as finalizeEvent,
  se as generateSecretKey,
  re as getPublicKey,
  ue as hexToBytes,
  h as keyUtils,
  g as nip04,
  _ as nip19,
  ae as useWebSocketImplementation,
  ie as verifyEvent
};
//# sourceMappingURL=index.mjs.map
