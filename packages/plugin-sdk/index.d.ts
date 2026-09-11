import { Request, Response, NextFunction } from 'express';

export interface ApixRequest extends Request {
  _pluginOptions?: Record<string, any>;
  [key: string]: any; // Allow custom properties to be attached by plugins
}

export interface ApixResponse extends Response {
  [key: string]: any;
}

export type ApixNextFunction = NextFunction;

export interface ApixPlugin {
  /**
   * The name of the plugin. Must be unique.
   */
  name: string;

  /**
   * The version of the plugin.
   */
  version: string;

  /**
   * Default configuration options for the plugin.
   */
  defaultOptions?: Record<string, any>;

  /**
   * Pre-proxy handler. Runs before the request is forwarded to the upstream server.
   */
  handler?: (
    req: ApixRequest,
    res: ApixResponse,
    next: ApixNextFunction
  ) => void | Promise<void>;

  /**
   * Post-proxy handler. Runs after the response from the upstream server is received.
   */
  postHandler?: (
    req: ApixRequest,
    res: ApixResponse,
    next: ApixNextFunction
  ) => void | Promise<void>;

  /**
   * Error handler. Runs if an error occurs in a previous plugin or the proxy phase.
   */
  onError?: (
    err: Error,
    req: ApixRequest,
    res: ApixResponse,
    next: ApixNextFunction
  ) => void | Promise<void>;
}
