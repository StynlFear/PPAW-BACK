import type { NextFunction, Request, Response } from "express";

import { verifyAccessToken } from "../utils/jwt";

export type AuthenticatedRequest = Request & {
  auth?: {
    userId: string;
    email: string;
    role: "user" | "admin";
  };
};

export function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header || typeof header !== "string") {
    return res.status(401).json({ error: "missing Authorization header" });
  }

  const [scheme, token] = header.split(" ");
  if (scheme !== "Bearer" || !token) {
    return res.status(401).json({ error: "invalid Authorization header" });
  }

  try {
    const payload = verifyAccessToken(token);
    req.auth = { userId: payload.sub, email: payload.email, role: payload.role };
    return next();
  } catch {
    return res.status(401).json({ error: "invalid token" });
  }
}
