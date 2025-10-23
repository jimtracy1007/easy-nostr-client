const { finalizeEvent } = require('nostr-tools/pure');
const nip04 = require('nostr-tools/nip04');
const { SimplePool } = require('nostr-tools/pool');

/**
 * Nostr Client - sends requests to the SDK backend
 */
class NostrClient {
  constructor(options = {}) {
    this.relayUrls = options.relays || ['wss://dev-relay.lnfi.network'];
    this.pool = new SimplePool({ enablePing: true, enableReconnect: true });
    this.privateKey = options.privateKey;
    this.publicKey = options.publicKey;
    this.serverPublicKey = options.serverPublicKey;
    this.timeout = options.timeout || 30000;
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

      try {
        // Encrypt request
        const plaintext = JSON.stringify(request);
        const encrypted = await nip04.encrypt(
          this.privateKey,
          this.serverPublicKey,
          plaintext
        );

        // Create event
        const event = {
          kind: 4,
          pubkey: this.publicKey,
          created_at: Math.floor(Date.now() / 1000),
          tags: [['p', this.serverPublicKey]],
          content: encrypted,
        };

        const signed = finalizeEvent(event, this.privateKey);

        // Set timeout
        const timeoutId = setTimeout(() => {
          reject(new Error(`Request timeout after ${this.timeout}ms`));
          subscription.close();
        }, this.timeout);

        // Listen for replies - subscribe on all relays with SimplePool
        let found = false;
        const subscription = this.pool.subscribe(
          this.relayUrls,
          { kinds: [4], '#p': [this.publicKey], authors: [this.serverPublicKey] },
          {
            onevent: async (replyEvent) => {
                if (found) return;

                // Ensure the reply targets this client
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
                    found = true;
                    clearTimeout(timeoutId);
                    subscription.close();

                    if (response.error) {
                      reject(new Error(response.error));
                    } else {
                      resolve(response.result);
                    }
                  }
                } catch (err) {
                  console.error('Error decrypting reply:', err.message);
                }
              },
          }
        );

        // Publish request via SimplePool
        await Promise.any(this.pool.publish(this.relayUrls, signed));

        console.log(`Sent ${method}`);
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Send plain text direct message and wait for reply
   */
  async sendMessage(text, recipientPubkey, waitForReply = false) {
    return new Promise(async (resolve, reject) => {
      try {
        const encrypted = await nip04.encrypt(
          this.privateKey,
          recipientPubkey,
          text
        );

        const event = {
          kind: 4,
          pubkey: this.publicKey,
          created_at: Math.floor(Date.now() / 1000),
          tags: [['p', recipientPubkey]],
          content: encrypted,
        };

        const signed = finalizeEvent(event, this.privateKey);
        const sentEventId = signed.id;
        const sentTimestamp = event.created_at;

        if (!waitForReply) {
          await Promise.any(this.pool.publish(this.relayUrls, signed));
          console.log(`Message sent to ${recipientPubkey.slice(0, 8)}`);
          resolve({ success: true, timestamp: sentTimestamp, eventId: sentEventId });
          return;
        }

        // Set timeout for reply
        const timeoutId = setTimeout(() => {
          subscription.close();
          reject(new Error(`Reply timeout after ${this.timeout}ms`));
        }, this.timeout);

        // Listen for reply with #e tag matching sent event ID, starting from message send time
        let found = false;
        const subscription = this.pool.subscribe(
          this.relayUrls,
          { kinds: [4], '#p': [this.publicKey], authors: [recipientPubkey], since: sentTimestamp },
          {
            onevent: async (replyEvent) => {
              if (found) return;

              console.log(`[Client] Received reply event ${replyEvent.id.slice(0, 8)} from ${replyEvent.pubkey.slice(0, 8)}`);
              console.log(`[Client] Event tags:`, replyEvent.tags);
              console.log(`[Client] Event content:`, replyEvent);
              try {
                const pTag = replyEvent.tags.find(t => t[0] === 'p');
                const eTag = replyEvent.tags.find(t => t[0] === 'e');
                if (!pTag || pTag[1] !== this.publicKey || replyEvent.pubkey !== recipientPubkey) {
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
                  recipientPubkey,
                  replyEvent.content
                );

                found = true;
                clearTimeout(timeoutId);
                subscription.close();

                resolve({
                  success: true,
                  reply: decrypted,
                  sender: recipientPubkey,
                  timestamp: replyEvent.created_at,
                  eventId: replyEvent.id,
                });
              } catch (err) {
                console.error('Error decrypting reply:', err.message);
              }
            },
          }
        );

        // Publish message after subscription is ready
        await Promise.any(this.pool.publish(this.relayUrls, signed));
        console.log(`Message sent to ${recipientPubkey.slice(0, 8)}, waiting for reply...`);
      } catch (error) {
        console.error('Error sending message:', error.message);
        reject(error);
      }
    });
  }

  /**
   * Listen for plain text direct messages from a specific sender
   */
  listenForMessages(senderPubkey, onMessage, onError) {
    const subscription = this.pool.subscribe(
      this.relayUrls,
      { kinds: [4], '#p': [this.publicKey], authors: [senderPubkey] },
      {
        onevent: async (event) => {
          try {
            const pTag = event.tags.find(t => t[0] === 'p');
            if (!pTag || pTag[1] !== this.publicKey || event.pubkey !== senderPubkey) {
              return;
            }

            const decrypted = await nip04.decrypt(
              this.privateKey,
              senderPubkey,
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

module.exports = NostrClient;
