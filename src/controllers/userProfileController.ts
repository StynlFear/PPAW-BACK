import type { Request, Response } from "express";

import { createUserProfile } from "../models/userProfileModel";
import { isEmail, isUuid } from "../utils/validators";

// Create a user profile (helper endpoint for local testing)
// Expects JSON: { "email": "a@b.com", "name"?: "...", "avatarUrl"?: "...", "id"?: "uuid" }
export async function createUserProfileHandler(req: Request, res: Response) {
  try {
    const email = req.body?.email;
    const role = req.body?.role;
    const name = req.body?.name;
    const avatarUrl = req.body?.avatarUrl;
    const id = req.body?.id;

    if (!isEmail(email)) {
      return res.status(400).json({ error: "email is required" });
    }
    if (role !== undefined && role !== "user" && role !== "admin") {
      return res.status(400).json({ error: "role must be 'user' or 'admin'" });
    }
    if (name !== undefined && typeof name !== "string") {
      return res.status(400).json({ error: "name must be a string" });
    }
    if (avatarUrl !== undefined && typeof avatarUrl !== "string") {
      return res.status(400).json({ error: "avatarUrl must be a string" });
    }
    if (id !== undefined && !isUuid(id)) {
      return res.status(400).json({ error: "id must be a uuid (if provided)" });
    }

    const user = await createUserProfile({
      ...(id ? { id } : {}),
      email: email.trim(),
      role: role as "user" | "admin" | undefined,
      name: typeof name === "string" ? name : null,
      avatarUrl: typeof avatarUrl === "string" ? avatarUrl : null,
    });

    const { role: _role, ...publicUser } = user;
    return res.status(201).json(publicUser);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(err);
    return res.status(500).json({ error: "internal error" });
  }
}
