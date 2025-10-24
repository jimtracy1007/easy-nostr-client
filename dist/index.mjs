import { getPublicKey as $, finalizeEvent as E, generateSecretKey as q, verifyEvent as N } from "nostr-tools/pure";
import { finalizeEvent as re, generateSecretKey as se, getPublicKey as oe, verifyEvent as ne } from "nostr-tools/pure";
import * as g from "nostr-tools/nip04";
import { SimplePool as k, useWebSocketImplementation as D } from "nostr-tools/pool";
import { SimplePool as ae, useWebSocketImplementation as ce } from "nostr-tools/pool";
import * as T from "nostr-tools/nip19";
import { hexToBytes as I, bytesToHex as x } from "@noble/hashes/utils";
import { bytesToHex as he, hexToBytes as de } from "@noble/hashes/utils";
import { EventEmitter as z } from "events";
function W(r) {
  return typeof r == "string" && r.startsWith("nsec1");
}
function M(r) {
  return typeof r == "string" && r.startsWith("npub1");
}
function H(r) {
  if (!W(r))
    throw new Error("Invalid nsec key");
  return T.decode(r).data;
}
function S(r) {
  if (r instanceof Uint8Array)
    return r;
  if (Buffer.isBuffer(r))
    return Uint8Array.from(r);
  if (typeof r == "string") {
    if (W(r))
      return H(r);
    if (B(r))
      return I(r);
  }
  throw new Error("Unsupported secret key format");
}
function C(r) {
  const e = S(r);
  return x(e);
}
function L(r) {
  const e = S(r);
  return T.nsecEncode(e);
}
function J(r) {
  const e = S(r);
  return $(e);
}
function A(r) {
  if (!M(r))
    throw new Error("Invalid npub key");
  return T.decode(r).data.toLowerCase();
}
function O(r) {
  const e = U(r);
  return T.npubEncode(e);
}
function U(r) {
  if (r instanceof Uint8Array)
    return x(r);
  if (Buffer.isBuffer(r))
    return Buffer.from(r).toString("hex");
  if (typeof r == "string") {
    if (M(r))
      return A(r);
    if (B(r))
      return r.toLowerCase();
  }
  throw new Error("Unsupported public key format");
}
function B(r) {
  return typeof r == "string" && /^[0-9a-fA-F]{64}$/.test(r);
}
const d = {
  isNsecKey: W,
  isNpubKey: M,
  decodeNsecToBytes: H,
  normalizeSecretKey: S,
  secretToHex: C,
  encodeSecretToNsec: L,
  derivePubkeyFromSecret: J,
  decodeNpubToHex: A,
  encodePubkeyToNpub: O,
  publicToHex: U,
  isHex64: B
};
class Q {
  constructor(e = {}) {
    this.relayUrls = e.relays || ["wss://dev-relay.lnfi.network"], this.pool = new k({ enablePing: !0, enableReconnect: !0 }), this.privateKey = e.privateKey ? d.normalizeSecretKey(e.privateKey) : void 0, this.publicKey = e.publicKey ? d.publicToHex(e.publicKey) : void 0, this.serverPublicKey = e.serverPublicKey ? d.publicToHex(e.serverPublicKey) : void 0, this.additionalTags = Array.isArray(e.tags) ? e.tags : [], this.replyFilterBuilder = this._validateFilterBuilder(e.replyFilter), this.messageReplyFilterBuilder = this._validateFilterBuilder(
      e.messageReplyFilter || e.replyFilter
    ), this.incomingFilterBuilder = this._validateFilterBuilder(e.incomingFilter), this.timeout = e.timeout || 3e4;
  }
  setTags(e = []) {
    if (!Array.isArray(e))
      throw new Error("tags must be an array");
    this.additionalTags = e;
  }
  setReplyFilter(e) {
    this.replyFilterBuilder = this._validateFilterBuilder(e);
  }
  setMessageReplyFilter(e) {
    this.messageReplyFilterBuilder = this._validateFilterBuilder(e);
  }
  setIncomingFilter(e) {
    this.incomingFilterBuilder = this._validateFilterBuilder(e);
  }
  _validateFilterBuilder(e) {
    if (e == null)
      return null;
    if (typeof e != "function")
      throw new Error("Filter override must be a function accepting (baseFilter, context)");
    return e;
  }
  _buildFilter(e, i, t) {
    const s = { ...e };
    if (!i)
      return s;
    const o = i({ ...s }, t) || s;
    if (typeof o != "object" || o === null)
      throw new Error("Filter builder must return an object");
    return o;
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
  async call(e, i = {}) {
    return new Promise(async (t, s) => {
      const o = `${Date.now()}-${Math.random()}`, l = { method: e, params: i, id: o };
      let a, n, u = !1;
      const w = () => {
        n && (clearTimeout(n), n = null), a && (a.close(), a = null);
      }, y = (c, m) => {
        u || (u = !0, w(), c ? s(c) : t(m));
      };
      try {
        const c = JSON.stringify(l), m = await g.encrypt(
          this.privateKey,
          this.serverPublicKey,
          c
        ), _ = {
          kind: 4,
          pubkey: this.publicKey,
          created_at: Math.floor(Date.now() / 1e3),
          tags: [["p", this.serverPublicKey], ...this.additionalTags],
          content: m
        }, b = E(_, this.privateKey);
        n = setTimeout(() => {
          y(new Error(`Request timeout after ${this.timeout}ms`));
        }, this.timeout);
        const v = {
          kinds: [4],
          "#p": [this.publicKey],
          authors: [this.serverPublicKey]
        }, F = this._buildFilter(v, this.replyFilterBuilder, {
          method: e,
          params: i,
          requestId: o
        });
        a = this.pool.subscribe(
          this.relayUrls,
          F,
          {
            onevent: async (K) => {
              if (u) return;
              const h = K.tags.find((p) => p[0] === "p");
              if (!(!h || h[1] !== this.publicKey || K.pubkey !== this.serverPublicKey))
                try {
                  const p = await g.decrypt(
                    this.privateKey,
                    this.serverPublicKey,
                    K.content
                  ), f = JSON.parse(p);
                  f.id === o && (f.error ? y(new Error(f.error)) : y(null, f.result));
                } catch (p) {
                  console.error("Error decrypting reply:", p.message);
                }
            }
          }
        ), await Promise.any(this.pool.publish(this.relayUrls, b)), console.log(`Sent ${e}`);
      } catch (c) {
        y(c);
      }
    });
  }
  /**
   * Send plain text direct message and wait for reply
   */
  async sendMessage(e, i, t = !1) {
    const s = d.publicToHex(i);
    return new Promise(async (o, l) => {
      let a, n, u = !1;
      const w = () => {
        n && (clearTimeout(n), n = null), a && (a.close(), a = null);
      }, y = (c, m) => {
        u || (u = !0, w(), c ? l(c) : o(m));
      };
      try {
        const c = await g.encrypt(
          this.privateKey,
          s,
          e
        ), m = {
          kind: 4,
          pubkey: this.publicKey,
          created_at: Math.floor(Date.now() / 1e3),
          tags: [["p", s], ...this.additionalTags],
          content: c
        }, _ = E(m, this.privateKey), b = _.id, v = m.created_at;
        if (!t) {
          await Promise.any(this.pool.publish(this.relayUrls, _)), console.log(`Message sent to ${s.slice(0, 8)}`), y(null, { success: !0, timestamp: v, eventId: b });
          return;
        }
        n = setTimeout(() => {
          y(new Error(`Reply timeout after ${this.timeout}ms`));
        }, this.timeout);
        const F = {
          kinds: [4],
          "#p": [this.publicKey],
          authors: [s],
          since: v
        }, K = this._buildFilter(F, this.messageReplyFilterBuilder, {
          recipientPubkey: s,
          sentEventId: b,
          sentTimestamp: v
        });
        a = this.pool.subscribe(
          this.relayUrls,
          K,
          {
            onevent: async (h) => {
              if (!u) {
                console.log(`[Client] Received reply event ${h.id.slice(0, 8)} from ${h.pubkey.slice(0, 8)}`), console.log("[Client] Event tags:", h.tags), console.log("[Client] Event content:", h);
                try {
                  const p = h.tags.find((P) => P[0] === "p"), f = h.tags.find((P) => P[0] === "e");
                  if (!p || p[1] !== this.publicKey || h.pubkey !== s) {
                    console.log("[Client] Skipping: p or author mismatch");
                    return;
                  }
                  if (f && f[1] !== b) {
                    console.log(`[Client] Skipping: e tag mismatch (expected ${b.slice(0, 8)}, got ${f[1].slice(0, 8)})`);
                    return;
                  }
                  f || console.log("[Client] Warning: Reply has no e tag, accepting anyway");
                  const R = await g.decrypt(
                    this.privateKey,
                    s,
                    h.content
                  );
                  y(null, {
                    success: !0,
                    reply: R,
                    sender: s,
                    timestamp: h.created_at,
                    eventId: h.id
                  });
                } catch (p) {
                  console.error("Error decrypting reply:", p.message);
                }
              }
            }
          }
        ), await Promise.any(this.pool.publish(this.relayUrls, _)), console.log(`Message sent to ${s.slice(0, 8)}, waiting for reply...`);
      } catch (c) {
        console.error("Error sending message:", c.message), y(c);
      }
    });
  }
  /**
   * Listen for plain text direct messages from a specific sender
   */
  listenForMessages(e, i, t) {
    const s = d.publicToHex(e), o = {
      kinds: [4],
      "#p": [this.publicKey],
      authors: [s]
    }, l = this._buildFilter(o, this.incomingFilterBuilder, {
      senderPubkey: s
    });
    return this.pool.subscribe(
      this.relayUrls,
      l,
      {
        onevent: async (n) => {
          try {
            const u = n.tags.find((y) => y[0] === "p");
            if (!u || u[1] !== this.publicKey || n.pubkey !== e)
              return;
            const w = await g.decrypt(
              this.privateKey,
              s,
              n.content
            );
            i({
              text: w,
              sender: e,
              timestamp: n.created_at,
              eventId: n.id
            });
          } catch (u) {
            console.error("Error decrypting message:", u.message), t && t(u);
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
function j() {
  const r = [];
  let e = 0;
  return {
    async enqueue(i) {
      const t = `mem_${Date.now()}_${e++}`;
      return r.push({ storageId: t, event: i }), t;
    },
    async dequeueBatch(i) {
      return r.splice(0, i);
    },
    async ack(i, t) {
    },
    async size() {
      return r.length;
    }
  };
}
class G extends z {
  constructor(e = {}) {
    super(), this.relayUrls = e.relays || ["wss://dev-relay.lnfi.network"], this.pool = new k({ enablePing: !0, enableReconnect: !0 }), this.privateKey = e.privateKey ? d.normalizeSecretKey(e.privateKey) : void 0, this.publicKey = e.publicKey ? d.publicToHex(e.publicKey) : void 0, this.processingMode = e.processingMode || "immediate", this.eventStorage = e.eventStorage || j(), this.processingRate = Math.min(e.processingRate || 3, 3), this.eventTimeout = e.eventTimeout || 3e4, this._authorWhitelist = Array.isArray(e.allowedAuthors) ? e.allowedAuthors.map(d.publicToHex) : [], this._customGetAuthorWhitelist = e.getAuthorWhitelist, this.methodRegistry = /* @__PURE__ */ new Map(), this.isListening = !1, this.subscription = null, this.queueTimer = null, this._isProcessing = !1;
  }
  /**
   * Register business methods with optional auth configuration
   * @param {string} method - Method name
   * @param {Function} handler - Handler function
   * @param {Object} authConfig - Optional auth config { authMode, whitelist, authHandler }
   */
  registerMethod(e, i, t = {}) {
    if (typeof i != "function")
      throw new Error(`Handler for method "${e}" must be a function`);
    this.methodRegistry.set(e, {
      handler: i,
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
    const i = e.map(d.publicToHex);
    this._authorWhitelist.push(...i.filter((t) => !this._authorWhitelist.includes(t)));
  }
  /**
   * Remove pubkeys from internal whitelist
   */
  removeFromWhitelist(...e) {
    const i = e.map(d.publicToHex);
    this._authorWhitelist = this._authorWhitelist.filter((t) => !i.includes(t));
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
    const i = await this.getAuthorWhitelist();
    return !i || i.length === 0 ? !0 : i.includes(d.publicToHex(e));
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
        onevent: (i) => this._handleEvent(i)
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
        const i = Math.max(1, this.processingRate), t = await this.eventStorage.dequeueBatch(i);
        if (t.length === 0) return;
        const s = await Promise.allSettled(
          t.map((o) => this._processWithTimeout(o))
        );
        for (let o = 0; o < t.length; o++) {
          const l = t[o], a = s[o];
          if (a.status === "fulfilled")
            await this.eventStorage.ack(l.storageId, { status: "success" });
          else {
            const n = ((e = a.reason) == null ? void 0 : e.message) || "Unknown error";
            console.error(`Error processing ${l.storageId}:`, n), await this.eventStorage.ack(l.storageId, {
              status: "failed",
              error: n
            });
          }
        }
      } catch (i) {
        console.error("Error in queue processor:", i.message);
      } finally {
        this._isProcessing = !1;
      }
    }
  }
  /**
   * Process event with timeout wrapper
   */
  async _processWithTimeout(e) {
    let i;
    const t = new Promise((s, o) => {
      i = setTimeout(
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
      i && clearTimeout(i);
    }
  }
  /**
   * Process a single stored event from queue
   */
  async _processStoredEvent(e) {
    const { event: i } = e, t = await this.getAuthorWhitelist();
    if (t && t.length > 0 && !t.includes(i.pubkey))
      throw new Error("sender_not_allowed");
    await this._processDecryptedEvent(i);
  }
  /**
   * Handle received events (entry point)
   */
  async _handleEvent(e) {
    try {
      const i = e.tags.find((s) => s[0] === "p");
      if (!i || i[1] !== this.publicKey)
        return;
      const t = await this.getAuthorWhitelist();
      if (t && t.length > 0 && !t.includes(e.pubkey)) {
        console.log(`[SDK] Sender ${e.pubkey.slice(0, 8)} not in whitelist`);
        return;
      }
      this.processingMode === "immediate" ? await this._processDecryptedEvent(e) : await this._storeEvent(e);
    } catch (i) {
      console.error("Error in _handleEvent:", i.message);
    }
  }
  /**
   * Store event to queue (queued mode only)
   */
  async _storeEvent(e) {
    var i;
    try {
      const t = await this.eventStorage.enqueue(e);
      console.log(`[SDK] Event ${(i = e.id) == null ? void 0 : i.slice(0, 8)} queued as ${t}`);
    } catch (t) {
      console.error("Error storing event:", t.message);
    }
  }
  /**
   * Process decrypted event (shared by immediate and queued modes)
   */
  async _processDecryptedEvent(e) {
    try {
      const i = await g.decrypt(this.privateKey, e.pubkey, e.content);
      let t;
      try {
        t = JSON.parse(i);
      } catch {
        await this._replyError(e.pubkey, "Invalid JSON format", null);
        return;
      }
      if (!t.method) {
        await this._replyError(e.pubkey, "Missing method field", null);
        return;
      }
      const s = this.methodRegistry.get(t.method);
      if (!s) {
        await this._replyError(e.pubkey, `Method not found: ${t.method}`, t.id);
        return;
      }
      if (!await this._checkPermission(t.method, e.pubkey, s.authConfig)) {
        await this._replyError(e.pubkey, `Permission denied for method: ${t.method}`, t.id);
        return;
      }
      const l = await s.handler(
        t.params || {},
        e,
        e.id,
        e.pubkey
      );
      await this._reply(e.pubkey, {
        id: t.id,
        result: l,
        error: null
      });
    } catch (i) {
      console.error("Error processing decrypted event:", i.message);
    }
  }
  /**
   * Check method-level permissions
   */
  async _checkPermission(e, i, t) {
    const { authMode: s, whitelist: o, authHandler: l } = t;
    return s === "public" ? !0 : s === "whitelist" ? o && o.length > 0 ? o.includes(i) : await this.isInWhitelist(i) : s === "custom" && l ? await l(i) : !1;
  }
  /**
   * Send direct message reply
   */
  async _reply(e, i) {
    try {
      const t = JSON.stringify(i), s = await g.encrypt(this.privateKey, e, t), o = {
        kind: 4,
        pubkey: this.publicKey,
        created_at: Math.floor(Date.now() / 1e3),
        tags: [["p", e]],
        content: s
      }, l = E(o, this.privateKey);
      await Promise.any(this.pool.publish(this.relayUrls, l)), console.log(`Replied to ${e.slice(0, 8)}`);
    } catch (t) {
      console.error("Error sending reply:", t.message), this.emit("error", t);
    }
  }
  /**
   * Send error reply
   */
  async _replyError(e, i, t) {
    await this._reply(e, {
      id: t,
      result: null,
      error: i
    });
  }
  /**
   * Stop listening and cleanup resources
   */
  stop() {
    this.isListening = !1, this.queueTimer && (clearInterval(this.queueTimer), this.queueTimer = null), this.subscription && (this.subscription.close(), this.subscription = null), this.pool.close(this.relayUrls), console.log("SDK stopped"), this.emit("stopped");
  }
}
const ee = {
  NostrClient: Q,
  NostrSdk: G,
  nip04: g,
  nip19: T,
  SimplePool: k,
  useWebSocketImplementation: D,
  finalizeEvent: E,
  verifyEvent: N,
  generateSecretKey: q,
  getPublicKey: $,
  bytesToHex: x,
  hexToBytes: I,
  keyUtils: d
};
export {
  Q as NostrClient,
  G as NostrSdk,
  ae as SimplePool,
  he as bytesToHex,
  ee as default,
  re as finalizeEvent,
  se as generateSecretKey,
  oe as getPublicKey,
  de as hexToBytes,
  d as keyUtils,
  g as nip04,
  T as nip19,
  ce as useWebSocketImplementation,
  ne as verifyEvent
};
//# sourceMappingURL=index.mjs.map
