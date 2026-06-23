import { Router } from "express";
import { db, notificationsTable } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { requireAuth, getUser } from "../middlewares/auth";
import { logger } from "../lib/logger";

const router = Router();

function formatNotification(n: import("@workspace/db").Notification) {
  return {
    id: n.id, userId: n.userId, type: n.type, title: n.title, body: n.body,
    relatedId: n.relatedId, relatedType: n.relatedType, isRead: n.isRead,
    createdAt: n.createdAt.toISOString(),
  };
}

router.get("/", requireAuth, async (req, res) => {
  const user = getUser(req);
  const { unreadOnly } = req.query as { unreadOnly?: string };

  try {
    const condition = unreadOnly === "true"
      ? and(eq(notificationsTable.userId, user.id), eq(notificationsTable.isRead, false))
      : eq(notificationsTable.userId, user.id);

    const notifications = await db.select().from(notificationsTable)
      .where(condition)
      .orderBy(desc(notificationsTable.createdAt))
      .limit(50);

    res.json(notifications.map(formatNotification));
  } catch (err) {
    logger.error({ err }, "List notifications error");
    res.status(500).json({ error: "Failed to list notifications" });
  }
});

router.patch("/:notificationId/read", requireAuth, async (req, res) => {
  const user = getUser(req);
  const notificationId = parseInt(String(req.params.notificationId ?? ""));
  if (isNaN(notificationId)) {
    res.status(400).json({ error: "Invalid notification ID" });
    return;
  }

  try {
    const [updated] = await db.update(notificationsTable)
      .set({ isRead: true })
      .where(and(eq(notificationsTable.id, notificationId), eq(notificationsTable.userId, user.id)))
      .returning();

    if (!updated) {
      res.status(404).json({ error: "Notification not found" });
      return;
    }

    res.json(formatNotification(updated));
  } catch (err) {
    logger.error({ err }, "Mark notification read error");
    res.status(500).json({ error: "Failed to mark notification read" });
  }
});

router.post("/read-all", requireAuth, async (req, res) => {
  const user = getUser(req);
  try {
    await db.update(notificationsTable)
      .set({ isRead: true })
      .where(eq(notificationsTable.userId, user.id));
    res.json({ success: true });
  } catch (err) {
    logger.error({ err }, "Mark all notifications read error");
    res.status(500).json({ error: "Failed to mark notifications read" });
  }
});

export default router;
