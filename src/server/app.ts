import compression from "compression";
import express, { type Express } from "express";
import helmet from "helmet";

export interface AppOptions {
  staticRoot?: string;
}

export function createApp(options: AppOptions = {}): Express {
  const app = express();

  app.disable("x-powered-by");
  app.use(helmet());
  app.use(compression());
  app.use(express.json({ limit: "256kb" }));

  app.get("/api/health", (_request, response) => {
    response.json({
      service: "application-tracker",
      status: "ok",
    });
  });

  if (options.staticRoot) {
    app.use(express.static(options.staticRoot, { index: false }));
    app.use((request, response, next) => {
      if (request.method !== "GET" || !request.accepts("html")) {
        next();
        return;
      }

      response.sendFile("index.html", { root: options.staticRoot });
    });
  }

  return app;
}
