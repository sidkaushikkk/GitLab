import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { env } from './config/env.js';
import { requestLogger } from './middleware/requestLogger.js';
import { notFoundHandler, errorHandler } from './middleware/errorHandler.js';
import { healthRouter } from './routes/health.js';
import { authRouter } from './routes/auth.js';

export function createApp() {
  const app = express();

  // CORS configuration allowing cookies/credentials from the frontend origin
  app.use(cors({
    origin: env.frontendUrl,
    credentials: true
  }));

  // Parse HTTP-only cookies
  app.use(cookieParser(env.sessionSecret));

  // Parse JSON and form bodies
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // HTTP Request Logging
  app.use(requestLogger);

  // Application Routes
  app.use(healthRouter);
  app.use('/api/auth', authRouter);

  // Handle 404 for unknown endpoints
  app.use(notFoundHandler);

  // Centralized error handling
  app.use(errorHandler);

  return app;
}

export const app = createApp();
