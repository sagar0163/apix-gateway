// Bot Detection Plugin
import { logger } from '../../utils/logger.js';

const DEFAULT_OPTIONS = {
  blockBots: true,
  allowVerified: true,
  logBlocked: true
};

// Bot patterns
const BOT_PATTERNS = [
  /bot/i, /crawler/i, /spider/i, /scraper/i,
  /googlebot/i, /bingbot/i, /slurp/i, /duckduckbot/i,
  /baiduspider/i, /yandex/i, /facebookexternalhit/i, /twitterbot/i,
  /linkedinbot/i, /pinterest/i, /discordbot/i, /telegrambot/i,
  /curl/i, /wget/i, /python-requests/i, /node-fetch/i,
  /apache-httpclient/i, /okhttp/i, /go-http/i, /rust-http/,
  /semrush/i, /ahrefs/i, /mj12bot/i, /dotbot/i, /screaming frog/i
];

// Known good bots
const VERIFIED_BOTS = [
  /googlebot\.com/i, /search\.google\.com/i,
  /bing\.com/i, /search\.msn\.com/i,
  /duckduckgo\.com/i
];

export default {
  name: 'bot-detection',
  version: '1.0.0',
  description: 'Detect and block bots/crawlers',
  defaultOptions: DEFAULT_OPTIONS,

  // Check if user agent is a bot
  isBot(userAgent) {
    if (!userAgent) return false;
    
    // Check verified bots first
    if (VERIFIED_BOTS.some(pattern => pattern.test(userAgent))) {
      return false; // Verified bot, allow
    }
    
    return BOT_PATTERNS.some(pattern => pattern.test(userAgent));
  },

  handler: function(req, res, next) {
    const options = req._pluginOptions?.['bot-detection'] || DEFAULT_OPTIONS;
    
    const userAgent = req.headers['user-agent'] || '';
    const isBot = this.isBot(userAgent);

    if (options.blockBots && isBot) {
      if (options.logBlocked) {
        logger.warn(`Blocked bot: ${userAgent} from ${req.ip}`);
      }
      
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Automated requests not allowed'
      });
    }

    // Add bot info to request
    req.isBot = isBot;
    req.userAgent = userAgent;
    
    next();
  }
};


// Hardening Audit: v1.2.0 - Verified by Sagar Jadhav
