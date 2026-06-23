import { Router } from "express";
import { db, translatorProfilesTable, usersTable, reviewsTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { requireAuth, getUser } from "../middlewares/auth";
import { formatUser } from "./auth";
import { logger } from "../lib/logger";

const router = Router();

function formatProfile(p: import("@workspace/db").TranslatorProfile) {
  return {
    id: p.id,
    userId: p.userId,
    bio: p.bio,
    certifications: p.certifications,
    yearsOfExperience: p.yearsOfExperience,
    pricePerWord: p.pricePerWord,
    sourceLanguages: p.sourceLanguages,
    targetLanguages: p.targetLanguages,
    specializations: p.specializations,
    rating: p.rating,
    completedJobsCount: p.completedJobsCount,
    createdAt: p.createdAt.toISOString(),
  };
}

router.get("/me", requireAuth, async (req, res) => {
  const user = getUser(req);
  try {
    const [profile] = await db.select().from(translatorProfilesTable).where(eq(translatorProfilesTable.userId, user.id)).limit(1);
    if (!profile) {
      res.status(404).json({ error: "No translator profile found" });
      return;
    }
    res.json(formatProfile(profile));
  } catch (err) {
    logger.error({ err }, "Get translator profile error");
    res.status(500).json({ error: "Failed to get profile" });
  }
});

router.put("/me", requireAuth, async (req, res) => {
  const user = getUser(req);
  const { bio, certifications, yearsOfExperience, pricePerWord, sourceLanguages, targetLanguages, specializations } = req.body;

  try {
    const existing = await db.select().from(translatorProfilesTable).where(eq(translatorProfilesTable.userId, user.id)).limit(1);

    if (existing.length > 0) {
      const [updated] = await db.update(translatorProfilesTable)
        .set({ bio, certifications, yearsOfExperience, pricePerWord, sourceLanguages, targetLanguages, specializations })
        .where(eq(translatorProfilesTable.userId, user.id))
        .returning();
      res.json(formatProfile(updated));
    } else {
      const [created] = await db.insert(translatorProfilesTable)
        .values({ userId: user.id, bio, certifications, yearsOfExperience, pricePerWord: pricePerWord ?? 0, sourceLanguages: sourceLanguages ?? [], targetLanguages: targetLanguages ?? [], specializations: specializations ?? [] })
        .returning();
      res.json(formatProfile(created));
    }
  } catch (err) {
    logger.error({ err }, "Upsert translator profile error");
    res.status(500).json({ error: "Failed to update profile" });
  }
});

router.get("/:userId", requireAuth, async (req, res) => {
  const userId = parseInt(String(req.params.userId ?? ""));
  if (isNaN(userId)) {
    res.status(400).json({ error: "Invalid user ID" });
    return;
  }

  try {
    const [profile] = await db.select().from(translatorProfilesTable).where(eq(translatorProfilesTable.userId, userId)).limit(1);
    if (!profile) {
      res.status(404).json({ error: "Translator profile not found" });
      return;
    }

    const [userRow] = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
    const recentReviews = await db.select().from(reviewsTable).where(eq(reviewsTable.translatorId, userId)).orderBy(desc(reviewsTable.createdAt)).limit(5);

    const reviews = await Promise.all(recentReviews.map(async (r) => {
      const [client] = await db.select().from(usersTable).where(eq(usersTable.id, r.clientId)).limit(1);
      return {
        id: r.id,
        contractId: r.contractId,
        clientId: r.clientId,
        translatorId: r.translatorId,
        rating: r.rating,
        feedback: r.feedback,
        client: client ? formatUser(client) : undefined,
        createdAt: r.createdAt.toISOString(),
      };
    }));

    res.json({
      ...formatProfile(profile),
      user: userRow ? formatUser(userRow) : undefined,
      recentReviews: reviews,
    });
  } catch (err) {
    logger.error({ err }, "Get translator profile by userId error");
    res.status(500).json({ error: "Failed to get profile" });
  }
});

export default router;
