const { finalizeEvent } = require('nostr-tools/pure');
const nip04 = require('nostr-tools/nip04');
const { SimplePool } = require('nostr-tools/pool');
const { EventEmitter } = require('events');
const keyUtils = require('./keyUtils');

/**
 * Nostr SDK - Backend server
 * Listen for direct messages, parse JSON-RPC style requests, call business methods, and return results
 */
class NostrSdk extends EventEmitter {
  constructor(options = {}) {
    super();
    this.relayUrls = options.relays || ['wss://dev-relay.lnfi.network'];
    this.pool = new SimplePool({ enablePing: true, enableReconnect: true });
    this.privateKey = options.privateKey
      ? keyUtils.normalizeSecretKey(options.privateKey)
      : undefined;
    this.publicKey = options.publicKey
      ? keyUtils.publicToHex(options.publicKey)
      : undefined;
    this.authorWhitelist = Array.isArray(options.allowedAuthors)
      ? options.allowedAuthors.map(keyUtils.publicToHex)
      : [];
    this.methodRegistry = new Map();
    this.isListening = false;
    this.subscription = null;
  }

  /**
   * Register business methods
   */
  registerMethod(method, handler) {
    if (typeof handler !== 'function') {
      throw new Error(`Handler for method "${method}" must be a function`);
    }
    this.methodRegistry.set(method, handler);
  }

  /**
   * Start listening
   */
  async start() {
    if (this.isListening) {
      console.log('Already listening for messages');
      return;
    }

    if (!this.privateKey || !this.publicKey) {
      throw new Error('privateKey and publicKey are required');
    }

    this.isListening = true;
    console.log(`Starting Nostr SDK on relays: ${this.relayUrls.join(', ')}`);

    // Use SimplePool to subscribe to direct message events (kind 4)
    // Use since to only get new messages, not load history
    const filter = {
      kinds: [4],
      since: Math.floor(Date.now() / 1000),
      '#p': [this.publicKey],
    };

    if (this.authorWhitelist.length > 0) {
      filter.authors = this.authorWhitelist;
    }

    this.subscription = this.pool.subscribe(
      this.relayUrls,
      filter,
      {
        onevent: (event) => this._handleEvent(event),
      }
    );

    console.log(`Subscribed to all relays`);
    this.emit('started');
  }

  /**
   * Handle received events
   */
  async _handleEvent(event) {
    try {
      console.log(`[SDK] Received event from ${event.pubkey.slice(0, 8)}`);
      
      // Check if this message is for us
      const pTag = event.tags.find(t => t[0] === 'p');
      if (!pTag || pTag[1] !== this.publicKey) {
        console.log(`[SDK] Message not for us (expected ${this.publicKey.slice(0, 8)})`);
        return; // Not a message for us
      }
      
      console.log(`[SDK] Processing message for us`);

      // Decrypt direct message content
      const decrypted = await nip04.decrypt(this.privateKey, event.pubkey, event.content);

      // Try to parse JSON
      let request;
      try {
        request = JSON.parse(decrypted);
      } catch (e) {
        await this._replyError(event.pubkey, 'Invalid JSON format', null);
        return;
      }

      // Validate request format
      if (!request.method) {
        await this._replyError(event.pubkey, 'Missing method field', null);
        return;
      }

      // Call business method
      const handler = this.methodRegistry.get(request.method);
      if (!handler) {
        await this._replyError(event.pubkey, `Method not found: ${request.method}`, request.id);
        return;
      }

      const result = await handler(request.params || {}, event);

      // Return result
      await this._reply(event.pubkey, {
        id: request.id,
        result,
        error: null,
      });
    } catch (error) {
      console.error('Error processing event:', error.message);
    }
  }

  /**
   * Send direct message reply
   */
  async _reply(recipientPubkey, data) {
    try {
      const plaintext = JSON.stringify(data);
      const encrypted = await nip04.encrypt(this.privateKey, recipientPubkey, plaintext);

      const event = {
        kind: 4,
        pubkey: this.publicKey,
        created_at: Math.floor(Date.now() / 1000),
        tags: [['p', recipientPubkey]],
        content: encrypted,
      };

      const signed = finalizeEvent(event, this.privateKey);

      // Use SimplePool to publish to all relays
      await Promise.any(this.pool.publish(this.relayUrls, signed));

      console.log(`Replied to ${recipientPubkey.slice(0, 8)}`);
    } catch (error) {
      console.error('Error sending reply:', error.message);
      this.emit('error', error);
    }
  }

  /**
   * Send error reply
   */
  async _replyError(recipientPubkey, message, requestId) {
    await this._reply(recipientPubkey, {
      id: requestId,
      result: null,
      error: message,
    });
  }

  /**
   * Stop listening
   */
  stop() {
    this.isListening = false;

    // Close subscription
    if (this.subscription) {
      this.subscription.close();
      this.subscription = null;
    }

    // Close SimplePool
    this.pool.close(this.relayUrls);

    console.log('SDK stopped');
    this.emit('stopped');
  }
}

module.exports = NostrSdk;