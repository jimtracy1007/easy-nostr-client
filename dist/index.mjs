import { getPublicKey as _, finalizeEvent as x, generateSecretKey as D, verifyEvent as A } from "nostr-tools/pure";
import { finalizeEvent as ee, generateSecretKey as te, getPublicKey as re, verifyEvent as se } from "nostr-tools/pure";
import * as m from "nostr-tools/nip04";
import { SimplePool as P, useWebSocketImplementation as B } from "nostr-tools/pool";
import { SimplePool as oe, useWebSocketImplementation as ne } from "nostr-tools/pool";
import * as v from "nostr-tools/nip19";
import { hexToBytes as M, bytesToHex as E } from "@noble/hashes/utils";
import { bytesToHex as le, hexToBytes as ae } from "@noble/hashes/utils";
import { EventEmitter as W } from "events";
function U(t) {
  return typeof t == "string" && t.startsWith("nsec1");
}
function $(t) {
  return typeof t == "string" && t.startsWith("npub1");
}
function N(t) {
  if (!U(t))
    throw new Error("Invalid nsec key");
  return v.decode(t).data;
}
function S(t) {
  if (t instanceof Uint8Array)
    return t;
  if (Buffer.isBuffer(t))
    return Uint8Array.from(t);
  if (typeof t == "string") {
    if (U(t))
      return N(t);
    if (H(t))
      return M(t);
  }
  throw new Error("Unsupported secret key format");
}
function z(t) {
  const e = S(t);
  return E(e);
}
function L(t) {
  const e = S(t);
  return v.nsecEncode(e);
}
function q(t) {
  const e = S(t);
  return _(e);
}
function I(t) {
  if (!$(t))
    throw new Error("Invalid npub key");
  return v.decode(t).data.toLowerCase();
}
function J(t) {
  const e = R(t);
  return v.npubEncode(e);
}
function R(t) {
  if (t instanceof Uint8Array)
    return E(t);
  if (Buffer.isBuffer(t))
    return Buffer.from(t).toString("hex");
  if (typeof t == "string") {
    if ($(t))
      return I(t);
    if (H(t))
      return t.toLowerCase();
  }
  throw new Error("Unsupported public key format");
}
function H(t) {
  return typeof t == "string" && /^[0-9a-fA-F]{64}$/.test(t);
}
const f = {
  isNsecKey: U,
  isNpubKey: $,
  decodeNsecToBytes: N,
  normalizeSecretKey: S,
  secretToHex: z,
  encodeSecretToNsec: L,
  derivePubkeyFromSecret: q,
  decodeNpubToHex: I,
  encodePubkeyToNpub: J,
  publicToHex: R,
  isHex64: H
};
class O {
  constructor(e = {}) {
    this.relayUrls = e.relays || ["wss://dev-relay.lnfi.network"], this.pool = new P({ enablePing: !0, enableReconnect: !0 }), this.privateKey = e.privateKey ? f.normalizeSecretKey(e.privateKey) : void 0, this.publicKey = e.publicKey ? f.publicToHex(e.publicKey) : void 0, this.serverPublicKey = e.serverPublicKey ? f.publicToHex(e.serverPublicKey) : void 0, this.timeout = e.timeout || 3e4;
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
    return new Promise(async (o, r) => {
      const u = `${Date.now()}-${Math.random()}`, c = { method: e, params: s, id: u };
      let i, a, y = !1;
      const T = () => {
        a && (clearTimeout(a), a = null), i && (i.close(), i = null);
      }, h = (n, g) => {
        y || (y = !0, T(), n ? r(n) : o(g));
      };
      try {
        const n = JSON.stringify(c), g = await m.encrypt(
          this.privateKey,
          this.serverPublicKey,
          n
        ), K = {
          kind: 4,
          pubkey: this.publicKey,
          created_at: Math.floor(Date.now() / 1e3),
          tags: [["p", this.serverPublicKey]],
          content: g
        }, w = x(K, this.privateKey);
        a = setTimeout(() => {
          h(new Error(`Request timeout after ${this.timeout}ms`));
        }, this.timeout), i = this.pool.subscribe(
          this.relayUrls,
          { kinds: [4], "#p": [this.publicKey], authors: [this.serverPublicKey] },
          {
            onevent: async (b) => {
              if (y) return;
              const l = b.tags.find((p) => p[0] === "p");
              if (!(!l || l[1] !== this.publicKey || b.pubkey !== this.serverPublicKey))
                try {
                  const p = await m.decrypt(
                    this.privateKey,
                    this.serverPublicKey,
                    b.content
                  ), d = JSON.parse(p);
                  d.id === u && (d.error ? h(new Error(d.error)) : h(null, d.result));
                } catch (p) {
                  console.error("Error decrypting reply:", p.message);
                }
            }
          }
        ), await Promise.any(this.pool.publish(this.relayUrls, w)), console.log(`Sent ${e}`);
      } catch (n) {
        h(n);
      }
    });
  }
  /**
   * Send plain text direct message and wait for reply
   */
  async sendMessage(e, s, o = !1) {
    const r = f.publicToHex(s);
    return new Promise(async (u, c) => {
      let i, a, y = !1;
      const T = () => {
        a && (clearTimeout(a), a = null), i && (i.close(), i = null);
      }, h = (n, g) => {
        y || (y = !0, T(), n ? c(n) : u(g));
      };
      try {
        const n = await m.encrypt(
          this.privateKey,
          r,
          e
        ), g = {
          kind: 4,
          pubkey: this.publicKey,
          created_at: Math.floor(Date.now() / 1e3),
          tags: [["p", r]],
          content: n
        }, K = x(g, this.privateKey), w = K.id, b = g.created_at;
        if (!o) {
          await Promise.any(this.pool.publish(this.relayUrls, K)), console.log(`Message sent to ${r.slice(0, 8)}`), h(null, { success: !0, timestamp: b, eventId: w });
          return;
        }
        a = setTimeout(() => {
          h(new Error(`Reply timeout after ${this.timeout}ms`));
        }, this.timeout), i = this.pool.subscribe(
          this.relayUrls,
          { kinds: [4], "#p": [this.publicKey], authors: [r], since: b },
          {
            onevent: async (l) => {
              if (!y) {
                console.log(`[Client] Received reply event ${l.id.slice(0, 8)} from ${l.pubkey.slice(0, 8)}`), console.log("[Client] Event tags:", l.tags), console.log("[Client] Event content:", l);
                try {
                  const p = l.tags.find((k) => k[0] === "p"), d = l.tags.find((k) => k[0] === "e");
                  if (!p || p[1] !== this.publicKey || l.pubkey !== r) {
                    console.log("[Client] Skipping: p or author mismatch");
                    return;
                  }
                  if (d && d[1] !== w) {
                    console.log(`[Client] Skipping: e tag mismatch (expected ${w.slice(0, 8)}, got ${d[1].slice(0, 8)})`);
                    return;
                  }
                  d || console.log("[Client] Warning: Reply has no e tag, accepting anyway");
                  const C = await m.decrypt(
                    this.privateKey,
                    r,
                    l.content
                  );
                  h(null, {
                    success: !0,
                    reply: C,
                    sender: r,
                    timestamp: l.created_at,
                    eventId: l.id
                  });
                } catch (p) {
                  console.error("Error decrypting reply:", p.message);
                }
              }
            }
          }
        ), await Promise.any(this.pool.publish(this.relayUrls, K)), console.log(`Message sent to ${r.slice(0, 8)}, waiting for reply...`);
      } catch (n) {
        console.error("Error sending message:", n.message), h(n);
      }
    });
  }
  /**
   * Listen for plain text direct messages from a specific sender
   */
  listenForMessages(e, s, o) {
    const r = f.publicToHex(e);
    return this.pool.subscribe(
      this.relayUrls,
      { kinds: [4], "#p": [this.publicKey], authors: [r] },
      {
        onevent: async (c) => {
          try {
            const i = c.tags.find((y) => y[0] === "p");
            if (!i || i[1] !== this.publicKey || c.pubkey !== e)
              return;
            const a = await m.decrypt(
              this.privateKey,
              r,
              c.content
            );
            s({
              text: a,
              sender: e,
              timestamp: c.created_at,
              eventId: c.id
            });
          } catch (i) {
            console.error("Error decrypting message:", i.message), o && o(i);
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
class F extends W {
  constructor(e = {}) {
    super(), this.relayUrls = e.relays || ["wss://dev-relay.lnfi.network"], this.pool = new P({ enablePing: !0, enableReconnect: !0 }), this.privateKey = e.privateKey ? f.normalizeSecretKey(e.privateKey) : void 0, this.publicKey = e.publicKey ? f.publicToHex(e.publicKey) : void 0, this.authorWhitelist = Array.isArray(e.allowedAuthors) ? e.allowedAuthors.map(f.publicToHex) : [], this.methodRegistry = /* @__PURE__ */ new Map(), this.isListening = !1, this.subscription = null;
  }
  /**
   * Register business methods
   */
  registerMethod(e, s) {
    if (typeof s != "function")
      throw new Error(`Handler for method "${e}" must be a function`);
    this.methodRegistry.set(e, s);
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
    this.authorWhitelist.length > 0 && (e.authors = this.authorWhitelist), this.subscription = this.pool.subscribe(
      this.relayUrls,
      e,
      {
        onevent: (s) => this._handleEvent(s)
      }
    ), console.log("Subscribed to all relays"), this.emit("started");
  }
  /**
   * Handle received events
   */
  async _handleEvent(e) {
    try {
      console.log(`[SDK] Received event from ${e.pubkey.slice(0, 8)}`);
      const s = e.tags.find((i) => i[0] === "p");
      if (!s || s[1] !== this.publicKey) {
        console.log(`[SDK] Message not for us (expected ${this.publicKey.slice(0, 8)})`);
        return;
      }
      console.log("[SDK] Processing message for us");
      const o = await m.decrypt(this.privateKey, e.pubkey, e.content);
      let r;
      try {
        r = JSON.parse(o);
      } catch {
        await this._replyError(e.pubkey, "Invalid JSON format", null);
        return;
      }
      if (!r.method) {
        await this._replyError(e.pubkey, "Missing method field", null);
        return;
      }
      const u = this.methodRegistry.get(r.method);
      if (!u) {
        await this._replyError(e.pubkey, `Method not found: ${r.method}`, r.id);
        return;
      }
      const c = await u(r.params || {}, e);
      await this._reply(e.pubkey, {
        id: r.id,
        result: c,
        error: null
      });
    } catch (s) {
      console.error("Error processing event:", s.message);
    }
  }
  /**
   * Send direct message reply
   */
  async _reply(e, s) {
    try {
      const o = JSON.stringify(s), r = await m.encrypt(this.privateKey, e, o), u = {
        kind: 4,
        pubkey: this.publicKey,
        created_at: Math.floor(Date.now() / 1e3),
        tags: [["p", e]],
        content: r
      }, c = x(u, this.privateKey);
      await Promise.any(this.pool.publish(this.relayUrls, c)), console.log(`Replied to ${e.slice(0, 8)}`);
    } catch (o) {
      console.error("Error sending reply:", o.message), this.emit("error", o);
    }
  }
  /**
   * Send error reply
   */
  async _replyError(e, s, o) {
    await this._reply(e, {
      id: o,
      result: null,
      error: s
    });
  }
  /**
   * Stop listening
   */
  stop() {
    this.isListening = !1, this.subscription && (this.subscription.close(), this.subscription = null), this.pool.close(this.relayUrls), console.log("SDK stopped"), this.emit("stopped");
  }
}
const X = {
  NostrClient: O,
  NostrSdk: F,
  nip04: m,
  nip19: v,
  SimplePool: P,
  useWebSocketImplementation: B,
  finalizeEvent: x,
  verifyEvent: A,
  generateSecretKey: D,
  getPublicKey: _,
  bytesToHex: E,
  hexToBytes: M,
  keyUtils: f
};
export {
  O as NostrClient,
  F as NostrSdk,
  oe as SimplePool,
  le as bytesToHex,
  X as default,
  ee as finalizeEvent,
  te as generateSecretKey,
  re as getPublicKey,
  ae as hexToBytes,
  f as keyUtils,
  m as nip04,
  v as nip19,
  ne as useWebSocketImplementation,
  se as verifyEvent
};
//# sourceMappingURL=index.mjs.map
