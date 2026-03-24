// GraphQL Protection Plugin
import { logger } from '../../utils/logger.js';

const DEFAULT_OPTIONS = {
  maxDepth: 10,
  maxComplexity: 1000,
  maxAliases: 15,
  maxDirectives: 50,
  disabledIntrospection: false,
  costAnalysis: true,
  defaultCost: 1,
  complexityCosts: {
    Field: 1,
    Query: 1,
    Mutation: 1,
    Int: 1,
    Float: 1,
    String: 1,
    Boolean: 1,
    List: 2,
    Object: 2
  }
};

export default {
  name: 'graphql-protection',
  version: '1.0.0',
  description: 'GraphQL query protection and cost analysis',
  defaultOptions: DEFAULT_OPTIONS,

  // Calculate query complexity
  calculateComplexity(ast, options) {
    let complexity = 0;

    function traverse(node, depth = 0) {
      if (depth > options.maxDepth) {
        return { valid: false, reason: 'max depth exceeded' };
      }

      if (!node) return { valid: true, complexity: 0 };

      switch (node.kind) {
        case 'Field':
          const baseCost = options.complexityCosts[node.name?.value] || options.defaultCost;
          complexity += baseCost;

          if (node.arguments?.length > options.maxAliases) {
            return { valid: false, reason: 'too many arguments' };
          }

          if (node.selectionSet) {
            for (const sel of node.selectionSet.selections) {
              const result = traverse(sel, depth + 1);
              if (!result.valid) return result;
              complexity += result.complexity;
            }
          }
          break;

        case 'FragmentSpread':
        case 'InlineFragment':
          // Handle fragments
          break;
      }

      return { valid: true, complexity };
    }

    if (ast?.definitions) {
      for (const def of ast.definitions) {
        const result = traverse(def);
        if (!result.valid) return result;
        complexity += result.complexity;
      }
    }

    return { valid: true, complexity };
  },

  // Check introspection query
  isIntrospectionQuery(body) {
    return body?.includes('__schema') || body?.includes('__type');
  },

  handler(req, res, next) {
    const options = req._pluginOptions?.['graphql-protection'] || DEFAULT_OPTIONS;

    // Only apply to GraphQL endpoints
    if (!req.path.includes('graphql') && !req.is('application/graphql')) {
      return next();
    }

    const contentType = req.headers['content-type'] || '';

    // Check for introspection (if disabled)
    if (options.disabledIntrospection) {
      if (contentType.includes('application/json')) {
        try {
          const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
          if (graphqlProtection.isIntrospectionQuery(JSON.stringify(body.query))) {
            logger.warn('Introspection query blocked');
            return res.status(400).json({
              error: 'Bad Request',
              message: 'Introspection queries are disabled'
            });
          }
        } catch (err) {
          logger.warn('Failed to check introspection query:', err.message);
        }
      }
    }

    // Parse and analyze query
    if (contentType.includes('application/json') || contentType.includes('application/graphql')) {
      try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
        const query = body?.query || body;

        if (query) {
          // Simple depth check via string analysis (full AST parsing would need graphql parser)
          const depth = (query.match(/{/g) || []).length;
          if (depth > options.maxDepth) {
            return res.status(400).json({
              error: 'Query Too Complex',
              message: `Query depth (${depth}) exceeds maximum (${options.maxDepth})`
            });
          }

          // Check for aliases
          const aliases = (query.match(/\w+:/g) || []).length;
          if (aliases > options.maxAliases) {
            return res.status(400).json({
              error: 'Too Many Aliases',
              message: `Query aliases (${aliases}) exceed maximum (${options.maxAliases})`
            });
          }

          // Check for directives
          const directives = (query.match(/@\w+/g) || []).length;
          if (directives > options.maxDirectives) {
            return res.status(400).json({
              error: 'Too Many Directives',
              message: `Directives (${directives}) exceed maximum (${options.maxDirectives})`
            });
          }
        }
      } catch (err) {
        logger.error('GraphQL parse error:', err.message);
      }
    }

    next();
  }
};
