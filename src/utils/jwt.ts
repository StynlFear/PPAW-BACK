import jwt from "jsonwebtoken";

import { getAuthConfig } from "../config/auth";

export type JwtPayload = {
  sub: string;
  email: string;
  role: "user" | "admin";
};

export function signAccessToken(payload: JwtPayload): string {
  const { jwtSecret, jwtExpiresIn } = getAuthConfig();
  return jwt.sign(payload, jwtSecret, { expiresIn: jwtExpiresIn });
}

export function verifyAccessToken(token: string): JwtPayload {
  const { jwtSecret } = getAuthConfig();
  const decoded = jwt.verify(token, jwtSecret);

  if (!decoded || typeof decoded !== "object") {
    throw new Error("invalid token");
  }

  const sub = (decoded as { sub?: unknown }).sub;
  const email = (decoded as { email?: unknown }).email;
  const role = (decoded as { role?: unknown }).role;

  if (typeof sub !== "string" || typeof email !== "string") {
    throw new Error("invalid token payload");
  }

  if (role !== "user" && role !== "admin") {
    throw new Error("invalid token payload");
  }

  return { sub, email, role };
}
