// HMAC Authentication Plugin
import crypto from 'crypto';
import { logger } from '../../utils/logger.js';

const DEFAULT_OPTIONS = {
  secret: '',
  headerName: 'X-Signature',
  headerNonce: 'X-Signature-Nonce',
  algorithm: 'sha256',
  clockTolerance: 300 // seconds
};

const secrets = new Map();

export default {
  name: 'hmac-auth',
  version: '1.0.0',
  description: 'HMAC signature authentication',
  defaultOptions: DEFAULT_OPTIONS,

  // Add secret
  addSecret(secretId, secret) {
    secrets.set(secretId, secret);
  },

  // Remove secret
  removeSecret(secretId) {
    secrets.delete(secretId);
  },

  // Generate signature
  generate(secret, message, algorithm = 'sha256') {
    return crypto.createHmac(algorithm, secret).update(message).digest('hex');
  },

  // Verify signature
  verify(signature, secret, message, algorithm = 'sha256') {
    const expected = this.generate(secret, message, algorithm);
    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expected)
    );
  },

  handler: (req, res, next) => {
    const options = req._pluginOptions?.['hmac-auth'] || DEFAULT_OPTIONS;
    
    const signature = req.headers[options.headerName?.toLowerCase()];
    const nonce = req.headers[options.headerNonce?.toLowerCase()];
    const secretId = req.headers['x-secret-id'] || 'default';
    
    if (!signature) {
      return res.status(401).json({ 
        error: 'Unauthorized', 
        message: 'HMAC signature required',
        header: options.headerName
      });
    }

    const secret = secrets.get(secretId) || options.secret;
    if (!secret) {
      return res.status(500).json({ error: 'HMAC secret not configured' });
    }

    // Build message to sign
    const nonceAge = nonce ? Date.now() - parseInt(nonce) : 0;
    if (nonce && nonceAge > options.clockTolerance * 1000) {
      logger.warn(`HMAC nonce too old: ${nonceAge}s`);
      return res.status(401).json({ error: 'Nonce expired' });
    }

    const message = [
      req.method,
      req.url,
      req.headers['content-type'] || '',
      nonce || '',
      req.headers['date'] || new Date().toUTCString()
    ].join('\n');

    try {
      const isValid = this.verify(
        Buffer.from(signature),
        secret,
        message,
        options.algorithm
      );

      if (!isValid) {
        logger.warn('HMAC verification failed');
        return res.status(401).json({ error: 'Invalid signature' });
      }

      req.hmac = { secretId, algorithm: options.algorithm };
      next();
    } catch (err) {
      logger.error('HMAC error:', err);
      return res.status(401).json({ error: 'Signature verification error' });
    }
  }
};
