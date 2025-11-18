import { finalizeEvent } from 'nostr-tools/pure';
import * as nip04 from 'nostr-tools/nip04';
import { SimplePool } from 'nostr-tools/pool';
import keyUtils from './keyUtils.js';

/**
 * Nostr Client - sends requests to the SDK backend
 */
class NostrClient {
  constructor(options = {}) {
    this.relayUrls = options.relays || ['wss://dev-relay.lnfi.network'];
    this.pool = new SimplePool({ enablePing: true, enableReconnect: true });
    this.privateKey = options.privateKey
      ? keyUtils.normalizeSecretKey(options.privateKey)
      : undefined;
   this.publicKey = options.publicKey
         ? keyUtils.publicToHex(options.publicKey)
         : undefined;
    this.serverPublicKey = options.serverPublicKey
         ? keyUtils.publicToHex(options.serverPublicKey)
         : undefined;
    this.additionalTags = Array.isArray(options.tags) ? options.tags : [];
    this.replyFilterBuilder = this._validateFilterBuilder(options.replyFilter);
    this.messageReplyFilterBuilder = this._validateFilterBuilder(
      options.messageReplyFilter || options.replyFilter
    );
    this.incomingFilterBuilder = this._validateFilterBuilder(options.incomingFilter);
    this.timeout = options.timeout || 30000;
  }

  setTags(tags = []) {
    if (!Array.isArray(tags)) {
      throw new Error('tags must be an array');
    }
    this.additionalTags = tags;
  }

  setReplyFilter(builder) {
    this.replyFilterBuilder = this._validateFilterBuilder(builder);
  }

  setMessageReplyFilter(builder) {
    this.messageReplyFilterBuilder = this._validateFilterBuilder(builder);
  }

  setIncomingFilter(builder) {
    this.incomingFilterBuilder = this._validateFilterBuilder(builder);
  }

  _validateFilterBuilder(builder) {
    if (builder == null) {
      return null;
    }
    if (typeof builder !== 'function') {
      throw new Error('Filter override must be a function accepting (baseFilter, context)');
    }
    return builder;
  }

  _buildFilter(baseFilter, builder, context) {
    const draft = { ...baseFilter };
    if (!builder) {
      return draft;
    }
    const result = builder({ ...draft }, context) || draft;
    if (typeof result !== 'object' || result === null) {
      throw new Error('Filter builder must return an object');
    }
    return result;
  }

  /**
   * Initialize connection (SimplePool manages connections automatically)
   */
  async connect() {
    // SimplePool connects automatically when subscribing; keep method for compatibility
    console.log(`Client ready to use relays: ${this.relayUrls.join(', ')}`);
  }

  /**
   * Send RPC request
   */
  async call(method, params = {}) {
    return new Promise(async (resolve, reject) => {
      const requestId = `${Date.now()}-${Math.random()}`;
      const request = { method, params, id: requestId };

      let subscription;
      let timeoutId;
      let settled = false;

      const cleanup = () => {
        if (timeoutId) {
          clearTimeout(timeoutId);
          timeoutId = null;
        }
        if (subscription) {
          subscription.close();
          subscription = null;
        }
      };

      const finalize = (error, result) => {
        if (settled) return;
        settled = true;
        cleanup();
        if (error) {
          reject(error);
        } else {
          resolve(result);
        }
      };

      try {
        const plaintext = JSON.stringify(request);
        const encrypted = await nip04.encrypt(
          this.privateKey,
          this.serverPublicKey,
          plaintext
        );

        const event = {
          kind: 4,
          pubkey: this.publicKey,
          created_at: Math.floor(Date.now() / 1000),
          tags: [['p', this.serverPublicKey], ...this.additionalTags],
          content: encrypted,
        };

        const signed = finalizeEvent(event, this.privateKey);

        // Publish first (like old version)
        const publishPromises = this.pool.publish(this.relayUrls, signed);
        Promise.any(publishPromises).catch(err => {
          const relayErrors =
            err instanceof AggregateError && Array.isArray(err.errors)
              ? err.errors.filter(Boolean)
              : err
                ? [err]
                : [];
          const onlyAckTimeouts =
            Array.isArray(relayErrors) && relayErrors.length > 0 && relayErrors.every(e => e.message === 'publish timed out');

          if (!onlyAckTimeouts) {
            console.warn(
              `[NostrClient] Publish failed on all relays for method ${method}:`,
              Array.isArray(relayErrors)
                ? relayErrors.map(e => e.message)
                : relayErrors
            );
          }
        });

        console.log(`Sent ${method}`);

        // Then subscribe to wait for reply (with since filter)
        const baseFilter = {
          kinds: [4],
          '#p': [this.publicKey],
          authors: [this.serverPublicKey],
          since: event.created_at - 5,
        };
        const filter = this._buildFilter(baseFilter, this.replyFilterBuilder, {
          method,
          params,
          requestId,
        });

        subscription = this.pool.subscribe(
          this.relayUrls,
          filter,
          {
            onevent: async (replyEvent) => {
              if (settled) return;

              const pTag = replyEvent.tags.find(t => t[0] === 'p');
              if (!pTag || pTag[1] !== this.publicKey || replyEvent.pubkey !== this.serverPublicKey) {
                return;
              }

              try {
                const decrypted = await nip04.decrypt(
                  this.privateKey,
                  this.serverPublicKey,
                  replyEvent.content
                );
                const response = JSON.parse(decrypted);

                if (response.id === requestId) {
                  if (response.error) {
                    finalize(new Error(response.error));
                  } else {
                    finalize(null, response.result);
                  }
                }
              } catch (err) {
                console.error('Error decrypting reply:', err.message);
              }
            },
          }
        );

        timeoutId = setTimeout(() => {
          finalize(new Error(`Request timeout after ${this.timeout}ms`));
        }, this.timeout);
      } catch (error) {
        finalize(error);
      }
    });
  }

  /**
   * Send plain text direct message and wait for reply
   */
  async sendMessage(text, recipientPubkey, waitForReply = false) {
    const recipientPubkeyHex = keyUtils.publicToHex(recipientPubkey);

    return new Promise(async (resolve, reject) => {
      let subscription;
      let timeoutId;
      let settled = false;

      const cleanup = () => {
        if (timeoutId) {
          clearTimeout(timeoutId);
          timeoutId = null;
        }
        if (subscription) {
          subscription.close();
          subscription = null;
        }
      };

      const finalize = (error, result) => {
        if (settled) return;
        settled = true;
        cleanup();
        if (error) {
          reject(error);
        } else {
          resolve(result);
        }
      };

      try {
        const encrypted = await nip04.encrypt(
          this.privateKey,
          recipientPubkeyHex,
          text
        );

        const event = {
          kind: 4,
          pubkey: this.publicKey,
          created_at: Math.floor(Date.now() / 1000),
          tags: [['p', recipientPubkeyHex], ...this.additionalTags],
          content: encrypted,
        };

        const signed = finalizeEvent(event, this.privateKey);
        const sentEventId = signed.id;
        const sentTimestamp = event.created_at;

        if (!waitForReply) {
          await Promise.any(this.pool.publish(this.relayUrls, signed));
          console.log(`Message sent to ${recipientPubkeyHex.slice(0, 8)}`);
          finalize(null, { success: true, timestamp: sentTimestamp, eventId: sentEventId });
          return;
        }

        timeoutId = setTimeout(() => {
          finalize(new Error(`Reply timeout after ${this.timeout}ms`));
        }, this.timeout);

        const baseFilter = {
          kinds: [4],
          '#p': [this.publicKey],
          authors: [recipientPubkeyHex],
          since: sentTimestamp,
        };
        const filter = this._buildFilter(baseFilter, this.messageReplyFilterBuilder, {
          recipientPubkey: recipientPubkeyHex,
          sentEventId,
          sentTimestamp,
        });

        subscription = this.pool.subscribe(
          this.relayUrls,
          filter,
          {
            onevent: async (replyEvent) => {
              if (settled) return;

              console.log(`[Client] Received reply event ${replyEvent.id.slice(0, 8)} from ${replyEvent.pubkey.slice(0, 8)}`);
              console.log(`[Client] Event tags:`, replyEvent.tags);
              console.log(`[Client] Event content:`, replyEvent);

              try {
                const pTag = replyEvent.tags.find(t => t[0] === 'p');
                const eTag = replyEvent.tags.find(t => t[0] === 'e');
                if (!pTag || pTag[1] !== this.publicKey || replyEvent.pubkey !== recipientPubkeyHex) {
                  console.log(`[Client] Skipping: p or author mismatch`);
                  return;
                }
                if (eTag && eTag[1] !== sentEventId) {
                  console.log(`[Client] Skipping: e tag mismatch (expected ${sentEventId.slice(0, 8)}, got ${eTag[1].slice(0, 8)})`);
                  return;
                }
                if (!eTag) {
                  console.log(`[Client] Warning: Reply has no e tag, accepting anyway`);
                }

                const decrypted = await nip04.decrypt(
                  this.privateKey,
                  recipientPubkeyHex,
                  replyEvent.content
                );

                finalize(null, {
                  success: true,
                  reply: decrypted,
                  sender: recipientPubkeyHex,
                  timestamp: replyEvent.created_at,
                  eventId: replyEvent.id,
                });
              } catch (err) {
                console.error('Error decrypting reply:', err.message);
              }
            },
          }
        );

        await Promise.any(this.pool.publish(this.relayUrls, signed));
        console.log(`Message sent to ${recipientPubkeyHex.slice(0, 8)}, waiting for reply...`);
      } catch (error) {
        console.error('Error sending message:', error.message);
        finalize(error);
      }
    });
  }

  /**
   * Listen for plain text direct messages from a specific sender
   */
  listenForMessages(senderPubkey, onMessage, onError) {
    const senderPubkeyHex = keyUtils.publicToHex(senderPubkey);
    const baseFilter = {
      kinds: [4],
      '#p': [this.publicKey],
      authors: [senderPubkeyHex],
    };
    const filter = this._buildFilter(baseFilter, this.incomingFilterBuilder, {
      senderPubkey: senderPubkeyHex,
    });

    const subscription = this.pool.subscribe(
      this.relayUrls,
      filter,
      {
        onevent: async (event) => {
          try {
            const pTag = event.tags.find(t => t[0] === 'p');
            if (!pTag || pTag[1] !== this.publicKey || event.pubkey !== senderPubkey) {
              return;
            }

            const decrypted = await nip04.decrypt(
              this.privateKey,
              senderPubkeyHex,
              event.content
            );

            onMessage({
              text: decrypted,
              sender: senderPubkey,
              timestamp: event.created_at,
              eventId: event.id,
            });
          } catch (err) {
            console.error('Error decrypting message:', err.message);
            if (onError) onError(err);
          }
        },
      }
    );

    return subscription;
  }

  /**
   * Close connections
   */
  close() {
    this.pool.close(this.relayUrls);
  }
}

export default NostrClient;
