import { Router } from "express";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAuth, getUser } from "../middlewares/auth";
import { formatUser } from "./auth";
import { logger } from "../lib/logger";

const router = Router();

router.get("/me", requireAuth, async (req, res) => {
  const user = getUser(req);
  res.json(formatUser(user));
});

router.patch("/me", requireAuth, async (req, res) => {
  const user = getUser(req);
  const { preferredLanguage, role } = req.body as { preferredLanguage?: string; role?: string };

  const updates: Partial<typeof usersTable.$inferInsert> = {};
  if (preferredLanguage && ["en", "uz", "ru"].includes(preferredLanguage)) {
    updates.preferredLanguage = preferredLanguage as "en" | "uz" | "ru";
  }
  if (role && ["client", "translator"].includes(role)) {
    updates.role = role as "client" | "translator";
  }

  try {
    const [updated] = await db.update(usersTable).set(updates).where(eq(usersTable.id, user.id)).returning();
    res.json(formatUser(updated));
  } catch (err) {
    logger.error({ err }, "Update user error");
    res.status(500).json({ error: "Failed to update user" });
  }
});

router.get("/:userId", requireAuth, async (req, res) => {
  const userId = parseInt(String(req.params.userId ?? ""));
  if (isNaN(userId)) {
    res.status(400).json({ error: "Invalid user ID" });
    return;
  }

  try {
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    res.json(formatUser(user));
  } catch (err) {
    logger.error({ err }, "Get user error");
    res.status(500).json({ error: "Failed to get user" });
  }
});

export default router;
