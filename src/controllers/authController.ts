import type { Request, Response } from "express";
import bcrypt from "bcryptjs";

import type { AuthenticatedRequest } from "../middleware/auth";
import { createUserProfile } from "../models/userProfileModel";
import { createCredential, getCredentialByEmail, getUserProfileByEmail } from "../models/authModel";
import { getUserProfileById } from "../models/uploadModel";
import { isEmail } from "../utils/validators";
import { signAccessToken } from "../utils/jwt";

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

function toPublicUserProfile(user: {
  id: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
  createdAt: Date | null;
}): {
  id: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
  createdAt: Date | null;
} {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    avatarUrl: user.avatarUrl,
    createdAt: user.createdAt,
  };
}

export async function registerHandler(req: Request, res: Response) {
  try {
    const emailRaw = req.body?.email;
    const password = req.body?.password;
    const name = req.body?.name;
    const avatarUrl = req.body?.avatarUrl;

    if (!isEmail(emailRaw)) {
      return res.status(400).json({ error: "email is required" });
    }
    if (!isNonEmptyString(password) || password.length < 8) {
      return res.status(400).json({ error: "password must be at least 8 characters" });
    }
    if (name !== undefined && typeof name !== "string") {
      return res.status(400).json({ error: "name must be a string" });
    }
    if (avatarUrl !== undefined && typeof avatarUrl !== "string") {
      return res.status(400).json({ error: "avatarUrl must be a string" });
    }

    const email = emailRaw.trim().toLowerCase();

    const existingCredential = await getCredentialByEmail(email);
    if (existingCredential) {
      return res.status(409).json({ error: "email already registered" });
    }

    const existingProfile = await getUserProfileByEmail(email);
    if (existingProfile) {
      return res.status(409).json({ error: "email already registered" });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const user = await createUserProfile({
      email,
      role: "user",
      name: typeof name === "string" ? name : null,
      avatarUrl: typeof avatarUrl === "string" ? avatarUrl : null,
    });

    await createCredential({
      userId: user.id,
      email,
      passwordHash,
    });

    const token = signAccessToken({ sub: user.id, email, role: user.role as "user" | "admin" });

    return res.status(201).json({ token, user: toPublicUserProfile(user) });
  } catch (err) {
    const code =
      typeof err === "object" && err !== null && "code" in err
        ? (err as { code?: unknown }).code
        : undefined;
    const metaTable =
      typeof err === "object" && err !== null && "meta" in err
        ? (err as { meta?: unknown }).meta
        : undefined;
    const table =
      metaTable && typeof metaTable === "object" && "table" in metaTable
        ? (metaTable as { table?: unknown }).table
        : undefined;

    if (code === "P2021" && typeof table === "string" && table.includes("auth_credentials")) {
      return res.status(500).json({
        error:
          "auth not initialized: missing auth_credentials table. Run prisma/sql/20260105_add_auth_credentials.sql against your database.",
      });
    }

    // eslint-disable-next-line no-console
    console.error(err);
    return res.status(500).json({ error: "internal error" });
  }
}

export async function loginHandler(req: Request, res: Response) {
  try {
    const emailRaw = req.body?.email;
    const password = req.body?.password;

    if (!isEmail(emailRaw)) {
      return res.status(400).json({ error: "email is required" });
    }
    if (!isNonEmptyString(password)) {
      return res.status(400).json({ error: "password is required" });
    }

    const email = emailRaw.trim().toLowerCase();

    const credential = await getCredentialByEmail(email);
    if (!credential) {
      return res.status(401).json({ error: "invalid credentials" });
    }

    const ok = await bcrypt.compare(password, credential.passwordHash);
    if (!ok) {
      return res.status(401).json({ error: "invalid credentials" });
    }

    const token = signAccessToken({
      sub: credential.userId,
      email: credential.email,
      role: credential.user.role as "user" | "admin",
    });
    return res.json({ token, user: toPublicUserProfile(credential.user) });
  } catch (err) {
    const code =
      typeof err === "object" && err !== null && "code" in err
        ? (err as { code?: unknown }).code
        : undefined;
    const metaTable =
      typeof err === "object" && err !== null && "meta" in err
        ? (err as { meta?: unknown }).meta
        : undefined;
    const table =
      metaTable && typeof metaTable === "object" && "table" in metaTable
        ? (metaTable as { table?: unknown }).table
        : undefined;

    if (code === "P2021" && typeof table === "string" && table.includes("auth_credentials")) {
      return res.status(500).json({
        error:
          "auth not initialized: missing auth_credentials table. Run prisma/sql/20260105_add_auth_credentials.sql against your database.",
      });
    }

    // eslint-disable-next-line no-console
    console.error(err);
    return res.status(500).json({ error: "internal error" });
  }
}

export async function meHandler(req: AuthenticatedRequest, res: Response) {
  try {
    const auth = req.auth;
    if (!auth) {
      return res.status(401).json({ error: "unauthorized" });
    }

    const user = await getUserProfileById(auth.userId);
    if (!user) {
      return res.status(404).json({ error: "user not found" });
    }

    return res.json(toPublicUserProfile(user));
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(err);
    return res.status(500).json({ error: "internal error" });
  }
}
