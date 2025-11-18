import { finalizeEvent } from 'nostr-tools/pure';
import * as nip04 from 'nostr-tools/nip04';
import { SimplePool } from 'nostr-tools/pool';
import { EventEmitter } from 'events';
import keyUtils from './keyUtils.js';

/**
 * Create default memory-based event storage adapter
 */
function createMemoryQueue() {
  const queue = [];
  let idCounter = 0;

  return {
    async enqueue(event) {
      const storageId = `mem_${Date.now()}_${idCounter++}`;
      queue.push({ storageId, event });
      return storageId;
    },
    async dequeueBatch(limit) {
      return queue.splice(0, limit);
    },
    async ack(storageId, meta) {
      // Memory queue auto-removes on dequeue, no-op for ack
    },
    async size() {
      return queue.length;
    },
  };
}

/**
 * Nostr SDK - Backend server
 * Listen for direct messages, parse JSON-RPC style requests, call business methods, and return results
 * Supports immediate and queued processing modes with dynamic whitelist management
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

    // Processing mode: 'immediate' or 'queued'
    this.processingMode = options.processingMode || 'immediate';
    
    // Event storage adapter (default: memory queue)
    this.eventStorage = options.eventStorage || createMemoryQueue();
    
    // Processing rate (events per second, max 3 due to relay limits)
    this.processingRate = Math.min(options.processingRate || 3, 3);
    
    // Event processing timeout (default 30 seconds)
    this.eventTimeout = options.eventTimeout || 30000;
    
    // Internal whitelist array (initialized from allowedAuthors)
    this._authorWhitelist = Array.isArray(options.allowedAuthors)
      ? options.allowedAuthors.map(keyUtils.publicToHex)
      : [];
    
    // Custom whitelist getter (takes precedence over internal array)
    this._customGetAuthorWhitelist = options.getAuthorWhitelist;
    
    // Method registry: Map<methodName, { handler, authConfig }>
    this.methodRegistry = new Map();
    
    this.isListening = false;
    this.subscription = null;
    this.queueTimer = null;
    this._isProcessing = false;
  }

  /**
   * Register business methods with optional auth configuration
   * @param {string} method - Method name
   * @param {Function} handler - Handler function
   * @param {Object} authConfig - Optional auth config { authMode, whitelist, authHandler }
   */
  registerMethod(method, handler, authConfig = {}) {
    if (typeof handler !== 'function') {
      throw new Error(`Handler for method "${method}" must be a function`);
    }
    this.methodRegistry.set(method, {
      handler,
      authConfig: {
        authMode: authConfig.authMode || 'public',
        whitelist: authConfig.whitelist || null,
        authHandler: authConfig.authHandler || null,
      },
    });
  }

  /**
   * Get current author whitelist (supports custom implementation)
   * @returns {Promise<string[]|null>} Whitelist array or null (no restriction)
   */
  async getAuthorWhitelist() {
    if (this._customGetAuthorWhitelist) {
      const result = this._customGetAuthorWhitelist();
      return result instanceof Promise ? await result : result;
    }
    return this._authorWhitelist.length > 0 ? this._authorWhitelist : null;
  }

  /**
   * Add pubkeys to internal whitelist
   */
  addToWhitelist(...pubkeys) {
    const normalized = pubkeys.map(keyUtils.publicToHex);
    this._authorWhitelist.push(...normalized.filter(pk => !this._authorWhitelist.includes(pk)));
  }

  /**
   * Remove pubkeys from internal whitelist
   */
  removeFromWhitelist(...pubkeys) {
    const normalized = pubkeys.map(keyUtils.publicToHex);
    this._authorWhitelist = this._authorWhitelist.filter(pk => !normalized.includes(pk));
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
  async isInWhitelist(pubkey) {
    const whitelist = await this.getAuthorWhitelist();
    if (!whitelist || whitelist.length === 0) return true;
    return whitelist.includes(keyUtils.publicToHex(pubkey));
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

    // Subscribe to direct message events (kind 4)
    // Note: No filter.authors - dynamic whitelist check in _handleEvent
    const filter = {
      kinds: [4],
      since: Math.floor(Date.now() / 1000),
      '#p': [this.publicKey],
    };

    this.subscription = this.pool.subscribe(
      this.relayUrls,
      filter,
      {
        onevent: (event) => this._handleEvent(event),
      }
    );

    // Start queue processor for queued mode
    if (this.processingMode === 'queued') {
      this._startQueueProcessor();
    }

    console.log(`Subscribed to all relays (mode: ${this.processingMode})`);
    this.emit('started');
  }

  /**
   * Start queue processor timer
   */
  _startQueueProcessor() {
    const intervalMs = Math.floor(1000 / this.processingRate);
    this.queueTimer = setInterval(() => this._processQueue(), intervalMs);
  }

  /**
   * Process queued events in batches with timeout and parallel execution
   */
  async _processQueue() {
    // Prevent concurrent batch processing
    if (this._isProcessing) return;
    
    this._isProcessing = true;
    try {
      const batchSize = Math.max(1, this.processingRate);
      const items = await this.eventStorage.dequeueBatch(batchSize);

      if (items.length === 0) return;

      // Process items in parallel with timeout
      const results = await Promise.allSettled(
        items.map(item => this._processWithTimeout(item))
      );

      // Ack based on results
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const result = results[i];
        
        if (result.status === 'fulfilled') {
          await this.eventStorage.ack(item.storageId, { status: 'success' });
        } else {
          const error = result.reason?.message || 'Unknown error';
          console.error(`Error processing ${item.storageId}:`, error);
          await this.eventStorage.ack(item.storageId, { 
            status: 'failed', 
            error 
          });
        }
      }
    } catch (error) {
      console.error('Error in queue processor:', error.message);
    } finally {
      this._isProcessing = false;
    }
  }

  /**
   * Process event with timeout wrapper
   */
  async _processWithTimeout(item) {
    let timeoutHandle;
    
    const timeoutPromise = new Promise((_, reject) => {
      timeoutHandle = setTimeout(
        () => reject(new Error('Event processing timeout')), 
        this.eventTimeout
      );
    });
    
    try {
      const result = await Promise.race([
        this._processStoredEvent(item),
        timeoutPromise
      ]);
      return result;
    } finally {
      // Clear timeout to prevent memory leak
      if (timeoutHandle) clearTimeout(timeoutHandle);
    }
  }

  /**
   * Process a single stored event from queue
   */
  async _processStoredEvent(item) {
    const { event } = item;

    // Re-check global whitelist (may have changed since enqueue)
    const whitelist = await this.getAuthorWhitelist();
    if (whitelist && whitelist.length > 0 && !whitelist.includes(event.pubkey)) {
      // Throw error to prevent outer ack from overwriting failure status
      throw new Error('sender_not_allowed');
    }

    // Decrypt and process (same as immediate mode)
    await this._processDecryptedEvent(event);
  }

  /**
   * Handle received events (entry point)
   */
  async _handleEvent(event) {
    try {
      // 1. Check if message is for us (p-tag validation)
      const pTag = event.tags.find(t => t[0] === 'p');
      if (!pTag || pTag[1] !== this.publicKey) {
        return;
      }

      // 2. Global whitelist pre-filter
      const whitelist = await this.getAuthorWhitelist();
      if (whitelist && whitelist.length > 0 && !whitelist.includes(event.pubkey)) {
        console.log(`[SDK] Sender ${event.pubkey.slice(0, 8)} not in whitelist`);
        return;
      }

      // 3. Route based on processing mode
      if (this.processingMode === 'immediate') {
        await this._processDecryptedEvent(event);
      } else {
        // Queued mode: store event for later processing
        await this._storeEvent(event);
      }
    } catch (error) {
      console.error('Error in _handleEvent:', error.message);
    }
  }

  /**
   * Store event to queue (queued mode only)
   */
  async _storeEvent(event) {
    try {
      const storageId = await this.eventStorage.enqueue(event);
      console.log(`[SDK] Event ${event.id?.slice(0, 8)} queued as ${storageId}`);
    } catch (error) {
      console.error('Error storing event:', error.message);
    }
  }

  /**
   * Process decrypted event (shared by immediate and queued modes)
   */
  async _processDecryptedEvent(event) {
    try {
      // Decrypt direct message content
      const decrypted = await nip04.decrypt(this.privateKey, event.pubkey, event.content);

      // Parse JSON request
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

      // Get method handler and auth config
      const methodEntry = this.methodRegistry.get(request.method);
      if (!methodEntry) {
        await this._replyError(event.pubkey, `Method not found: ${request.method}`, request.id);
        return;
      }

      // Check method-level permissions
      const hasPermission = await this._checkPermission(request.method, event.pubkey, methodEntry.authConfig);
      if (!hasPermission) {
        await this._replyError(event.pubkey, `Permission denied for method: ${request.method}`, request.id);
        return;
      }

      // Call handler with enhanced parameters
      const result = await methodEntry.handler(
        request.params || {}, 
        event, 
        event.id, 
        event.pubkey
      );

      // Return result
      await this._reply(event.pubkey, {
        id: request.id,
        result,
        error: null,
      });
    } catch (error) {
      console.error('Error processing decrypted event:', error.message);
    }
  }

  /**
   * Check method-level permissions
   */
  async _checkPermission(methodName, senderPubkey, authConfig) {
    const { authMode, whitelist, authHandler } = authConfig;

    // Public mode: always allow
    if (authMode === 'public') {
      return true;
    }

    // Whitelist mode: check method-level or global whitelist
    if (authMode === 'whitelist') {
      if (whitelist && whitelist.length > 0) {
        return whitelist.includes(senderPubkey);
      }
      // Fallback to global whitelist
      return await this.isInWhitelist(senderPubkey);
    }

    // Custom mode: call custom auth handler
    if (authMode === 'custom' && authHandler) {
      return await authHandler(senderPubkey);
    }

    return false;
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
      try {
        await Promise.any(this.pool.publish(this.relayUrls, signed));
      } catch (err) {
        console.warn(
          `[NostrSdk] Publish failed on all relays when replying to ${recipientPubkey.slice(0, 8)}:`,
          err instanceof AggregateError && Array.isArray(err.errors)
            ? err.errors.map(e => e && e.message)
            : err && err.message
        );
      }

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
   * Stop listening and cleanup resources
   */
  stop() {
    this.isListening = false;

    // Clear queue processor timer
    if (this.queueTimer) {
      clearInterval(this.queueTimer);
      this.queueTimer = null;
    }

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

export default NostrSdk;