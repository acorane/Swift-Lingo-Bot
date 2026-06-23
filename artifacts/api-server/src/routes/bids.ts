import { Router } from "express";
import { db, bidsTable, jobsTable, usersTable, translatorProfilesTable, contractsTable, notificationsTable } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { requireAuth, getUser } from "../middlewares/auth";
import { formatUser } from "./auth";
import { logger } from "../lib/logger";

const router = Router();

async function formatBid(b: import("@workspace/db").Bid) {
  const [translatorUser] = await db.select().from(usersTable).where(eq(usersTable.id, b.translatorId)).limit(1);
  const [translatorProfile] = await db.select().from(translatorProfilesTable).where(eq(translatorProfilesTable.userId, b.translatorId)).limit(1);

  return {
    id: b.id,
    jobId: b.jobId,
    translatorId: b.translatorId,
    amount: b.amount,
    coverLetter: b.coverLetter,
    deliveryDays: b.deliveryDays,
    status: b.status,
    translatorUser: translatorUser ? formatUser(translatorUser) : undefined,
    translator: translatorProfile ? {
      id: translatorProfile.id, userId: translatorProfile.userId, bio: translatorProfile.bio,
      pricePerWord: translatorProfile.pricePerWord, rating: translatorProfile.rating,
      completedJobsCount: translatorProfile.completedJobsCount,
      sourceLanguages: translatorProfile.sourceLanguages, targetLanguages: translatorProfile.targetLanguages,
      specializations: translatorProfile.specializations, createdAt: translatorProfile.createdAt.toISOString(),
    } : undefined,
    createdAt: b.createdAt.toISOString(),
  };
}

router.get("/job/:jobId", requireAuth, async (req, res) => {
  const jobId = parseInt(String(req.params.jobId ?? ""));
  if (isNaN(jobId)) {
    res.status(400).json({ error: "Invalid job ID" });
    return;
  }
  try {
    const bids = await db.select().from(bidsTable).where(eq(bidsTable.jobId, jobId)).orderBy(desc(bidsTable.createdAt));
    const formatted = await Promise.all(bids.map(formatBid));
    res.json(formatted);
  } catch (err) {
    logger.error({ err }, "List bids error");
    res.status(500).json({ error: "Failed to list bids" });
  }
});

router.post("/job/:jobId", requireAuth, async (req, res) => {
  const user = getUser(req);
  const jobId = parseInt(String(req.params.jobId ?? ""));
  if (isNaN(jobId)) {
    res.status(400).json({ error: "Invalid job ID" });
    return;
  }

  if (!user.isTranslatorApproved) {
    res.status(403).json({ error: "Only approved translators can submit bids" });
    return;
  }

  try {
    const [job] = await db.select().from(jobsTable).where(eq(jobsTable.id, jobId)).limit(1);
    if (!job || job.status !== "open") {
      res.status(400).json({ error: "Job is not open for bids" });
      return;
    }

    const existing = await db.select().from(bidsTable).where(and(eq(bidsTable.jobId, jobId), eq(bidsTable.translatorId, user.id))).limit(1);
    if (existing.length > 0) {
      res.status(400).json({ error: "You already submitted a bid on this job" });
      return;
    }

    const { amount, coverLetter, deliveryDays } = req.body;
    const [bid] = await db.insert(bidsTable).values({
      jobId,
      translatorId: user.id,
      amount,
      coverLetter,
      deliveryDays,
      status: "pending",
    }).returning();

    await db.update(jobsTable).set({ bidsCount: (job.bidsCount ?? 0) + 1 }).where(eq(jobsTable.id, jobId));

    await db.insert(notificationsTable).values({
      userId: job.clientId,
      type: "new_bid",
      title: "New Bid Received",
      body: `A translator has submitted a bid on your job: ${job.title}`,
      relatedId: bid.id,
      relatedType: "bid",
    });

    res.status(201).json(await formatBid(bid));
  } catch (err) {
    logger.error({ err }, "Submit bid error");
    res.status(500).json({ error: "Failed to submit bid" });
  }
});

router.patch("/:bidId", requireAuth, async (req, res) => {
  const user = getUser(req);
  const bidId = parseInt(String(req.params.bidId ?? ""));
  if (isNaN(bidId)) {
    res.status(400).json({ error: "Invalid bid ID" });
    return;
  }

  try {
    const [bid] = await db.select().from(bidsTable).where(eq(bidsTable.id, bidId)).limit(1);
    if (!bid || bid.translatorId !== user.id) {
      res.status(403).json({ error: "Not your bid" });
      return;
    }

    const { amount, coverLetter, deliveryDays } = req.body;
    const [updated] = await db.update(bidsTable)
      .set({ amount, coverLetter, deliveryDays })
      .where(eq(bidsTable.id, bidId))
      .returning();

    res.json(await formatBid(updated));
  } catch (err) {
    logger.error({ err }, "Update bid error");
    res.status(500).json({ error: "Failed to update bid" });
  }
});

router.delete("/:bidId", requireAuth, async (req, res) => {
  const user = getUser(req);
  const bidId = parseInt(String(req.params.bidId ?? ""));
  if (isNaN(bidId)) {
    res.status(400).json({ error: "Invalid bid ID" });
    return;
  }

  try {
    const [bid] = await db.select().from(bidsTable).where(eq(bidsTable.id, bidId)).limit(1);
    if (!bid || bid.translatorId !== user.id) {
      res.status(403).json({ error: "Not your bid" });
      return;
    }

    await db.update(bidsTable).set({ status: "withdrawn" }).where(eq(bidsTable.id, bidId));
    res.status(204).send();
  } catch (err) {
    logger.error({ err }, "Withdraw bid error");
    res.status(500).json({ error: "Failed to withdraw bid" });
  }
});

router.post("/:bidId/accept", requireAuth, async (req, res) => {
  const user = getUser(req);
  const bidId = parseInt(String(req.params.bidId ?? ""));
  if (isNaN(bidId)) {
    res.status(400).json({ error: "Invalid bid ID" });
    return;
  }

  try {
    const [bid] = await db.select().from(bidsTable).where(eq(bidsTable.id, bidId)).limit(1);
    if (!bid) {
      res.status(404).json({ error: "Bid not found" });
      return;
    }

    const [job] = await db.select().from(jobsTable).where(eq(jobsTable.id, bid.jobId)).limit(1);
    if (!job || job.clientId !== user.id) {
      res.status(403).json({ error: "Not your job" });
      return;
    }

    const PLATFORM_FEE_PERCENT = 10;
    const platformFee = bid.amount * (PLATFORM_FEE_PERCENT / 100);
    const translatorPayout = bid.amount - platformFee;

    const [contract] = await db.insert(contractsTable).values({
      jobId: job.id,
      clientId: user.id,
      translatorId: bid.translatorId,
      bidId: bid.id,
      agreedPrice: bid.amount,
      platformFee,
      translatorPayout,
      status: "pending_payment",
      paymentStatus: "pending",
    }).returning();

    await db.update(bidsTable).set({ status: "accepted" }).where(eq(bidsTable.id, bidId));
    await db.update(jobsTable).set({ status: "in_progress" }).where(eq(jobsTable.id, job.id));

    await db.insert(notificationsTable).values({
      userId: bid.translatorId,
      type: "bid_accepted",
      title: "Bid Accepted",
      body: `Your bid has been accepted for: ${job.title}. Please wait for the client to complete payment.`,
      relatedId: contract.id,
      relatedType: "contract",
    });

    res.status(201).json({
      id: contract.id, jobId: contract.jobId, clientId: contract.clientId,
      translatorId: contract.translatorId, bidId: contract.bidId,
      agreedPrice: contract.agreedPrice, platformFee: contract.platformFee,
      translatorPayout: contract.translatorPayout, status: contract.status,
      paymentStatus: contract.paymentStatus, deliveryNote: contract.deliveryNote,
      disputeReason: contract.disputeReason,
      createdAt: contract.createdAt.toISOString(), updatedAt: contract.updatedAt.toISOString(),
    });
  } catch (err) {
    logger.error({ err }, "Accept bid error");
    res.status(500).json({ error: "Failed to accept bid" });
  }
});

router.get("/my", requireAuth, async (req, res) => {
  const user = getUser(req);
  try {
    const bids = await db.select().from(bidsTable).where(eq(bidsTable.translatorId, user.id)).orderBy(desc(bidsTable.createdAt));

    const result = await Promise.all(bids.map(async (b) => {
      const [job] = await db.select().from(jobsTable).where(eq(jobsTable.id, b.jobId)).limit(1);
      const bidFmt = await formatBid(b);
      return { ...bidFmt, job: job ? { id: job.id, title: job.title, sourceLang: job.sourceLang, targetLang: job.targetLang, status: job.status, budgetMin: job.budgetMin, budgetMax: job.budgetMax, bidsCount: job.bidsCount, createdAt: job.createdAt.toISOString(), clientId: job.clientId, deliveryType: job.deliveryType } : undefined };
    }));

    res.json(result);
  } catch (err) {
    logger.error({ err }, "List my bids error");
    res.status(500).json({ error: "Failed to list bids" });
  }
});

export default router;
