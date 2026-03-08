// IP Whitelist Plugin
import { logger } from '../../utils/logger.js';

const DEFAULT_OPTIONS = {
  ips: [], // Array of IP addresses or CIDR ranges
  mode: 'allow', // 'allow' (whitelist) or 'deny' (blacklist)
  passthrough: false
};

// Simple CIDR matching
const ipInCidr = (ip, cidr) => {
  const [range, bits] = cidr.split('/');
  const mask = bits ? ~(2 ** (32 - parseInt(bits)) - 1) : -1;
  
  const ipNum = ip.split('.').reduce((acc, octet) => (acc << 8) + parseInt(octet), 0) >>> 0;
  const rangeNum = range.split('.').reduce((acc, octet) => (acc << 8) + parseInt(octet), 0) >>> 0;
  
  return (ipNum & mask) === (rangeNum & mask);
};

export default {
  name: 'ip-whitelist',
  version: '1.0.0',
  description: 'IP filtering plugin',
  defaultOptions: DEFAULT_OPTIONS,

  handler: (req, res, next) => {
    const options = req._pluginOptions?.['ip-whitelist'] || DEFAULT_OPTIONS;
    const clientIp = req.ip || req.headers['x-forwarded-for']?.split(',')[0] || 'unknown';
    
    if (!options.ips || options.ips.length === 0) {
      return next(); // No filtering configured
    }

    const isAllowed = options.ips.some(pattern => {
      if (pattern.includes('/')) {
        return ipInCidr(clientIp, pattern);
      }
      return clientIp === pattern || clientIp.startsWith(pattern);
    });

    if (options.mode === 'allow') {
      // Whitelist mode: only allow listed IPs
      if (!isAllowed) {
        logger.warn(`IP not whitelisted: ${clientIp}`);
        return res.status(403).json({ 
          error: 'Forbidden', 
          message: 'Your IP is not allowed' 
        });
      }
    } else {
      // Deny mode: block listed IPs
      if (isAllowed) {
        logger.warn(`IP blocked: ${clientIp}`);
        return res.status(403).json({ 
          error: 'Forbidden', 
          message: 'Your IP is blocked' 
        });
      }
    }

    next();
  }
};
