import winston from 'winston';
import os from 'os';

const { combine, timestamp, errors, json, colorize, simple, printf } = winston.format;

// Custom format for structured logging (ELK stack ready)
const structuredFormat = printf(({ level, message, timestamp, stack, ...metadata }) => {
  const log = {
    '@timestamp': timestamp,
    '@version': '1',
    level,
    service: 'apix-gateway',
    hostname: os.hostname(),
    pid: process.pid,
    message: message || '',
    ...metadata
  };
  
  if (stack) {
    log.error = {
      message: message,
      stack: stack
    };
  }
  
  return JSON.stringify(log);
});

// Development format (human readable)
const devFormat = combine(
  colorize(),
  timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  printf(({ timestamp, level, message, ...metadata }) => {
    const meta = Object.keys(metadata).length ? JSON.stringify(metadata) : '';
    return `${timestamp} [${level}]: ${message} ${meta}`;
  })
);

// Determine environment
const isProduction = process.env.NODE_ENV === 'production';
const isStructured = process.env.LOG_STRUCTURED === 'true';

export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  defaultMeta: {
    service: 'apix-gateway',
    hostname: os.hostname(),
    pid: process.pid
  },
  format: isProduction || isStructured
    ? combine(
        timestamp(),
        errors({ stack: true }),
        structuredFormat
      )
    : combine(
        timestamp(),
        errors({ stack: true }),
        devFormat
      ),
  transports: [
    // Console transport
    new winston.transports.Console({
      format: isProduction || isStructured
        ? structuredFormat
        : combine(colorize(), simple())
    }),
    
    // Error file
    new winston.transports.File({
      filename: 'logs/error.log',
      level: 'error',
      maxsize: 10 * 1024 * 1024, // 10MB
      maxFiles: 5
    }),
    
    // Combined log
    new winston.transports.File({
      filename: 'logs/combined.log',
      maxsize: 10 * 1024 * 1024, // 10MB
      maxFiles: 5
    })
  ],
  
  // Handle uncaught exceptions
  exceptionHandlers: [
    new winston.transports.File({ filename: 'logs/exceptions.log' })
  ],
  
  // Handle unhandled promise rejections
  rejectionHandlers: [
    new winston.transports.File({ filename: 'logs/rejections.log' })
  ]
});

// Request logger helper
export const requestLogger = (req) => {
  return {
    method: req.method,
    url: req.originalUrl || req.url,
    path: req.path,
    query: req.query,
    ip: req.ip,
    userAgent: req.get('user-agent'),
    referer: req.get('referer'),
    contentLength: req.get('content-length'),
    contentType: req.get('content-type')
  };
};

// Response logger helper
export const responseLogger = (req, res, duration) => {
  return {
    method: req.method,
    url: req.originalUrl || req.url,
    status: res.statusCode,
    duration: `${duration}ms`,
    contentLength: res.getHeader('content-length')
  };
};

export default logger;
// ELK-ready structured logging
