// Response Pagination Plugin
import { logger } from '../../utils/logger.js';

const DEFAULT_OPTIONS = {
  paramPage: 'page',
  paramLimit: 'limit',
  defaultLimit: 20,
  maxLimit: 100,
  headerTotal: 'x-total',
  headerPage: 'x-page',
  headerLimit: 'x-limit',
  headerPages: 'x-total-pages'
};

export default {
  name: 'pagination',
  version: '1.0.0',
  description: 'Paginate list responses',
  defaultOptions: DEFAULT_OPTIONS,

  handler: (req, res, next) => {
    const options = req._pluginOptions?.pagination || DEFAULT_OPTIONS;
    
    // Extract pagination params
    const page = parseInt(req.query[options.paramPage]) || 1;
    let limit = parseInt(req.query[options.paramLimit]) || options.defaultLimit;
    
    // Clamp limit
    limit = Math.min(limit, options.maxLimit);
    const offset = (page - 1) * limit;

    // Attach to request for downstream use
    req._pagination = {
      page,
      limit,
      offset,
      maxLimit: options.maxLimit
    };

    // Store original json
    const originalJson = res.json.bind(res);

    res.json = (body) => {
      // Check if body is array or has items
      let items = Array.isArray(body) ? body : body?.data || body?.items || [];
      
      if (!Array.isArray(items)) {
        return originalJson(body);
      }

      // Paginate if needed
      const total = items.length;
      
      if (total > limit) {
        items = items.slice(offset, offset + limit);
      }

      // Add pagination metadata
      const totalPages = Math.ceil(total / limit);
      
      const response = Array.isArray(body) ? items : {
        ...body,
        data: items,
        pagination: {
          page,
          limit,
          total,
          totalPages,
          hasNext: page < totalPages,
          hasPrev: page > 1
        }
      };

      // Set headers
      res.set(options.headerTotal, total.toString());
      res.set(options.headerPage, page.toString());
      res.set(options.headerLimit, limit.toString());
      res.set(options.headerPages, totalPages.toString());

      return originalJson(response);
    };

    next();
  }
};
