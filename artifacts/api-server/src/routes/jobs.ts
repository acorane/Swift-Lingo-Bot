import { Router } from "express";
import { db, jobsTable, usersTable, bidsTable } from "@workspace/db";
import { eq, and, or, ilike, gte, lte, desc, sql } from "drizzle-orm";
import { requireAuth, getUser } from "../middlewares/auth";
import { formatUser } from "./auth";
import { logger } from "../lib/logger";

const router = Router();

function formatJob(j: import("@workspace/db").Job) {
  return {
    id: j.id,
    clientId: j.clientId,
    title: j.title,
    description: j.description,
    sourceLang: j.sourceLang,
    targetLang: j.targetLang,
    wordCount: j.wordCount,
    budgetMin: j.budgetMin,
    budgetMax: j.budgetMax,
    deliveryType: j.deliveryType,
    specialization: j.specialization,
    status: j.status,
    bidsCount: j.bidsCount,
    createdAt: j.createdAt.toISOString(),
  };
}

router.get("/", requireAuth, async (req, res) => {
  const { search, sourceLang, targetLang, specialization, deliveryType, budgetMin, budgetMax, status, myJobs, limit = "20", offset = "0" } = req.query as Record<string, string>;
  const user = getUser(req);

  try {
    const conditions = [];

    if (myJobs === "true") {
      conditions.push(eq(jobsTable.clientId, user.id));
    }
    if (search) {
      conditions.push(or(ilike(jobsTable.title, `%${search}%`), ilike(jobsTable.description, `%${search}%`))!);
    }
    if (sourceLang) conditions.push(eq(jobsTable.sourceLang, sourceLang));
    if (targetLang) conditions.push(eq(jobsTable.targetLang, targetLang));
    if (specialization) conditions.push(eq(jobsTable.specialization, specialization));
    if (deliveryType) conditions.push(eq(jobsTable.deliveryType, deliveryType as any));
    if (budgetMin) conditions.push(gte(jobsTable.budgetMin, parseFloat(budgetMin)));
    if (budgetMax) conditions.push(lte(jobsTable.budgetMax, parseFloat(budgetMax)));
    if (status) conditions.push(eq(jobsTable.status, status as any));
    else if (!myJobs) conditions.push(eq(jobsTable.status, "open"));

    const limitNum = Math.min(parseInt(limit) || 20, 100);
    const offsetNum = parseInt(offset) || 0;

    const jobs = await db.select().from(jobsTable)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(jobsTable.createdAt))
      .limit(limitNum)
      .offset(offsetNum);

    const totalResult = await db.select({ count: sql<number>`count(*)` }).from(jobsTable)
      .where(conditions.length > 0 ? and(...conditions) : undefined);

    res.json({ jobs: jobs.map(formatJob), total: Number(totalResult[0]?.count ?? 0) });
  } catch (err) {
    logger.error({ err }, "List jobs error");
    res.status(500).json({ error: "Failed to list jobs" });
  }
});

router.post("/", requireAuth, async (req, res) => {
  const user = getUser(req);
  const { title, description, sourceLang, targetLang, wordCount, budgetMin, budgetMax, deliveryType, specialization } = req.body;

  if (!title || !sourceLang || !targetLang || budgetMin === undefined || budgetMax === undefined) {
    res.status(400).json({ error: "Missing required fields" });
    return;
  }

  try {
    const [job] = await db.insert(jobsTable).values({
      clientId: user.id,
      title,
      description,
      sourceLang,
      targetLang,
      wordCount,
      budgetMin,
      budgetMax,
      deliveryType: deliveryType ?? "standard",
      specialization,
      status: "open",
    }).returning();

    res.status(201).json(formatJob(job));
  } catch (err) {
    logger.error({ err }, "Create job error");
    res.status(500).json({ error: "Failed to create job" });
  }
});

router.get("/:jobId", requireAuth, async (req, res) => {
  const jobId = parseInt(String(req.params.jobId ?? ""));
  if (isNaN(jobId)) {
    res.status(400).json({ error: "Invalid job ID" });
    return;
  }

  try {
    const [job] = await db.select().from(jobsTable).where(eq(jobsTable.id, jobId)).limit(1);
    if (!job) {
      res.status(404).json({ error: "Job not found" });
      return;
    }

    const [client] = await db.select().from(usersTable).where(eq(usersTable.id, job.clientId)).limit(1);
    const bids = await db.select().from(bidsTable).where(eq(bidsTable.jobId, jobId)).orderBy(desc(bidsTable.createdAt));

    res.json({
      ...formatJob(job),
      client: client ? formatUser(client) : undefined,
      bids: bids.map(b => ({
        id: b.id, jobId: b.jobId, translatorId: b.translatorId, amount: b.amount,
        coverLetter: b.coverLetter, deliveryDays: b.deliveryDays, status: b.status,
        createdAt: b.createdAt.toISOString(),
      })),
    });
  } catch (err) {
    logger.error({ err }, "Get job error");
    res.status(500).json({ error: "Failed to get job" });
  }
});

router.patch("/:jobId", requireAuth, async (req, res) => {
  const user = getUser(req);
  const jobId = parseInt(String(req.params.jobId ?? ""));
  if (isNaN(jobId)) {
    res.status(400).json({ error: "Invalid job ID" });
    return;
  }

  try {
    const [job] = await db.select().from(jobsTable).where(eq(jobsTable.id, jobId)).limit(1);
    if (!job) {
      res.status(404).json({ error: "Job not found" });
      return;
    }
    if (job.clientId !== user.id) {
      res.status(403).json({ error: "Not your job" });
      return;
    }

    const { title, description, wordCount, budgetMin, budgetMax, deliveryType, specialization, status } = req.body;
    const [updated] = await db.update(jobsTable)
      .set({ title, description, wordCount, budgetMin, budgetMax, deliveryType, specialization, status })
      .where(eq(jobsTable.id, jobId))
      .returning();

    res.json(formatJob(updated));
  } catch (err) {
    logger.error({ err }, "Update job error");
    res.status(500).json({ error: "Failed to update job" });
  }
});

router.delete("/:jobId", requireAuth, async (req, res) => {
  const user = getUser(req);
  const jobId = parseInt(String(req.params.jobId ?? ""));
  if (isNaN(jobId)) {
    res.status(400).json({ error: "Invalid job ID" });
    return;
  }

  try {
    const [job] = await db.select().from(jobsTable).where(eq(jobsTable.id, jobId)).limit(1);
    if (!job) {
      res.status(404).json({ error: "Job not found" });
      return;
    }
    if (job.clientId !== user.id) {
      res.status(403).json({ error: "Not your job" });
      return;
    }
    if (job.status !== "open") {
      res.status(400).json({ error: "Can only delete open jobs" });
      return;
    }

    await db.delete(jobsTable).where(eq(jobsTable.id, jobId));
    res.status(204).send();
  } catch (err) {
    logger.error({ err }, "Delete job error");
    res.status(500).json({ error: "Failed to delete job" });
  }
});

export default router;
