import { Router } from "express";
import { db, reviewsTable, contractsTable, usersTable, translatorProfilesTable } from "@workspace/db";
import { eq, avg, count, desc } from "drizzle-orm";
import { requireAuth, getUser } from "../middlewares/auth";
import { formatUser } from "./auth";
import { logger } from "../lib/logger";

const router = Router();

router.post("/", requireAuth, async (req, res) => {
  const user = getUser(req);
  const { contractId, rating, feedback } = req.body as { contractId?: number; rating?: number; feedback?: string };

  if (!contractId || rating === undefined) {
    res.status(400).json({ error: "contractId and rating are required" });
    return;
  }

  try {
    const [contract] = await db.select().from(contractsTable).where(eq(contractsTable.id, contractId)).limit(1);
    if (!contract || contract.clientId !== user.id) {
      res.status(403).json({ error: "Not your contract" });
      return;
    }
    if (contract.status !== "completed") {
      res.status(400).json({ error: "Contract must be completed to leave a review" });
      return;
    }

    const existing = await db.select().from(reviewsTable).where(eq(reviewsTable.contractId, contractId)).limit(1);
    if (existing.length > 0) {
      res.status(400).json({ error: "Review already submitted" });
      return;
    }

    const [review] = await db.insert(reviewsTable).values({
      contractId,
      clientId: user.id,
      translatorId: contract.translatorId,
      rating: Math.max(1, Math.min(5, rating)),
      feedback,
    }).returning();

    const stats = await db.select({ avgRating: avg(reviewsTable.rating), totalCount: count() })
      .from(reviewsTable).where(eq(reviewsTable.translatorId, contract.translatorId));

    if (stats[0]) {
      await db.update(translatorProfilesTable)
        .set({
          rating: stats[0].avgRating ? parseFloat(String(stats[0].avgRating)) : null,
          completedJobsCount: Number(stats[0].totalCount),
        })
        .where(eq(translatorProfilesTable.userId, contract.translatorId));
    }

    res.status(201).json({
      id: review.id, contractId: review.contractId, clientId: review.clientId,
      translatorId: review.translatorId, rating: review.rating, feedback: review.feedback,
      createdAt: review.createdAt.toISOString(),
    });
  } catch (err) {
    logger.error({ err }, "Submit review error");
    res.status(500).json({ error: "Failed to submit review" });
  }
});

router.get("/translator/:userId", requireAuth, async (req, res) => {
  const userId = parseInt(String(req.params.userId ?? ""));
  if (isNaN(userId)) {
    res.status(400).json({ error: "Invalid user ID" });
    return;
  }

  try {
    const reviews = await db.select().from(reviewsTable).where(eq(reviewsTable.translatorId, userId)).orderBy(desc(reviewsTable.createdAt));

    const result = await Promise.all(reviews.map(async (r) => {
      const [client] = await db.select().from(usersTable).where(eq(usersTable.id, r.clientId)).limit(1);
      return {
        id: r.id, contractId: r.contractId, clientId: r.clientId, translatorId: r.translatorId,
        rating: r.rating, feedback: r.feedback, client: client ? formatUser(client) : undefined,
        createdAt: r.createdAt.toISOString(),
      };
    }));

    res.json(result);
  } catch (err) {
    logger.error({ err }, "List reviews error");
    res.status(500).json({ error: "Failed to list reviews" });
  }
});

export default router;
