import { Router } from "express";
import { db, contractsTable, jobsTable, usersTable, messagesTable, paymentsTable, reviewsTable, contractStatusHistoryTable, notificationsTable } from "@workspace/db";
import { eq, and, or, desc } from "drizzle-orm";
import { requireAuth, getUser } from "../middlewares/auth";
import { formatUser } from "./auth";
import { logger } from "../lib/logger";

const router = Router();

function formatContract(c: import("@workspace/db").Contract) {
  return {
    id: c.id, jobId: c.jobId, clientId: c.clientId, translatorId: c.translatorId,
    bidId: c.bidId, agreedPrice: c.agreedPrice, platformFee: c.platformFee,
    translatorPayout: c.translatorPayout, status: c.status, paymentStatus: c.paymentStatus,
    deliveryNote: c.deliveryNote, disputeReason: c.disputeReason,
    createdAt: c.createdAt.toISOString(), updatedAt: c.updatedAt.toISOString(),
  };
}

async function buildContractSummary(c: import("@workspace/db").Contract) {
  const [job] = await db.select().from(jobsTable).where(eq(jobsTable.id, c.jobId)).limit(1);
  const [client] = await db.select().from(usersTable).where(eq(usersTable.id, c.clientId)).limit(1);
  const [translator] = await db.select().from(usersTable).where(eq(usersTable.id, c.translatorId)).limit(1);
  return {
    ...formatContract(c),
    job: job ? { id: job.id, title: job.title, sourceLang: job.sourceLang, targetLang: job.targetLang, status: job.status, budgetMin: job.budgetMin, budgetMax: job.budgetMax, bidsCount: job.bidsCount, deliveryType: job.deliveryType, createdAt: job.createdAt.toISOString(), clientId: job.clientId } : undefined,
    client: client ? formatUser(client) : undefined,
    translator: translator ? formatUser(translator) : undefined,
  };
}

router.get("/", requireAuth, async (req, res) => {
  const user = getUser(req);
  const { status } = req.query as { status?: string };

  try {
    const userCondition = or(eq(contractsTable.clientId, user.id), eq(contractsTable.translatorId, user.id))!;
    const contracts = await db.select().from(contractsTable)
      .where(status ? and(userCondition, eq(contractsTable.status, status as any)) : userCondition)
      .orderBy(desc(contractsTable.createdAt));

    const result = await Promise.all(contracts.map(buildContractSummary));
    res.json(result);
  } catch (err) {
    logger.error({ err }, "List contracts error");
    res.status(500).json({ error: "Failed to list contracts" });
  }
});

router.get("/:contractId", requireAuth, async (req, res) => {
  const user = getUser(req);
  const contractId = parseInt(String(req.params.contractId ?? ""));
  if (isNaN(contractId)) {
    res.status(400).json({ error: "Invalid contract ID" });
    return;
  }

  try {
    const [contract] = await db.select().from(contractsTable).where(eq(contractsTable.id, contractId)).limit(1);
    if (!contract) {
      res.status(404).json({ error: "Contract not found" });
      return;
    }
    if (contract.clientId !== user.id && contract.translatorId !== user.id) {
      res.status(403).json({ error: "Not your contract" });
      return;
    }

    const summary = await buildContractSummary(contract);

    let messages: any[] = [];
    if (contract.paymentStatus === "confirmed" || contract.paymentStatus === "released") {
      const rawMsgs = await db.select().from(messagesTable).where(eq(messagesTable.contractId, contractId)).orderBy(messagesTable.createdAt);
      messages = await Promise.all(rawMsgs.map(async (m) => {
        const [sender] = await db.select().from(usersTable).where(eq(usersTable.id, m.senderId)).limit(1);
        return { id: m.id, contractId: m.contractId, senderId: m.senderId, content: m.content, fileUrl: m.fileUrl, fileType: m.fileType, sender: sender ? formatUser(sender) : undefined, createdAt: m.createdAt.toISOString() };
      }));
    }

    const [payment] = await db.select().from(paymentsTable).where(eq(paymentsTable.contractId, contractId)).limit(1);
    const [review] = await db.select().from(reviewsTable).where(eq(reviewsTable.contractId, contractId)).limit(1);
    const statusHistory = await db.select().from(contractStatusHistoryTable).where(eq(contractStatusHistoryTable.contractId, contractId)).orderBy(contractStatusHistoryTable.createdAt);

    res.json({
      ...summary,
      messages,
      payment: payment ? { id: payment.id, contractId: payment.contractId, amount: payment.amount, platformFee: payment.platformFee, translatorPayout: payment.translatorPayout, status: payment.status, paymentMethod: payment.paymentMethod, createdAt: payment.createdAt.toISOString(), confirmedAt: payment.confirmedAt?.toISOString(), releasedAt: payment.releasedAt?.toISOString() } : undefined,
      review: review ? { id: review.id, contractId: review.contractId, clientId: review.clientId, translatorId: review.translatorId, rating: review.rating, feedback: review.feedback, createdAt: review.createdAt.toISOString() } : undefined,
      statusHistory: statusHistory.map(h => ({ id: h.id, contractId: h.contractId, status: h.status, note: h.note, createdAt: h.createdAt.toISOString() })),
    });
  } catch (err) {
    logger.error({ err }, "Get contract error");
    res.status(500).json({ error: "Failed to get contract" });
  }
});

router.post("/:contractId/deliver", requireAuth, async (req, res) => {
  const user = getUser(req);
  const contractId = parseInt(String(req.params.contractId ?? ""));
  if (isNaN(contractId)) {
    res.status(400).json({ error: "Invalid contract ID" });
    return;
  }

  try {
    const [contract] = await db.select().from(contractsTable).where(eq(contractsTable.id, contractId)).limit(1);
    if (!contract || contract.translatorId !== user.id) {
      res.status(403).json({ error: "Not your contract" });
      return;
    }
    if (contract.status !== "active") {
      res.status(400).json({ error: "Contract must be active to deliver" });
      return;
    }

    const { deliveryNote } = req.body;
    const [updated] = await db.update(contractsTable)
      .set({ status: "delivered", deliveryNote })
      .where(eq(contractsTable.id, contractId))
      .returning();

    await db.insert(contractStatusHistoryTable).values({ contractId, status: "delivered", note: deliveryNote });

    await db.insert(notificationsTable).values({
      userId: contract.clientId,
      type: "delivery_submitted",
      title: "Delivery Submitted",
      body: "Your translator has submitted the completed work. Please review and approve.",
      relatedId: contractId,
      relatedType: "contract",
    });

    res.json(await buildContractSummary(updated));
  } catch (err) {
    logger.error({ err }, "Deliver contract error");
    res.status(500).json({ error: "Failed to deliver contract" });
  }
});

router.post("/:contractId/approve", requireAuth, async (req, res) => {
  const user = getUser(req);
  const contractId = parseInt(String(req.params.contractId ?? ""));
  if (isNaN(contractId)) {
    res.status(400).json({ error: "Invalid contract ID" });
    return;
  }

  try {
    const [contract] = await db.select().from(contractsTable).where(eq(contractsTable.id, contractId)).limit(1);
    if (!contract || contract.clientId !== user.id) {
      res.status(403).json({ error: "Not your contract" });
      return;
    }
    if (contract.status !== "delivered") {
      res.status(400).json({ error: "Contract must be delivered to approve" });
      return;
    }

    const [updated] = await db.update(contractsTable)
      .set({ status: "completed", paymentStatus: "released" })
      .where(eq(contractsTable.id, contractId))
      .returning();

    await db.update(paymentsTable).set({ status: "released", releasedAt: new Date() }).where(eq(paymentsTable.contractId, contractId));
    await db.insert(contractStatusHistoryTable).values({ contractId, status: "completed", note: "Client approved delivery" });

    await db.insert(notificationsTable).values({
      userId: contract.translatorId,
      type: "delivery_approved",
      title: "Delivery Approved",
      body: "Your delivery has been approved. Payment will be released to you.",
      relatedId: contractId,
      relatedType: "contract",
    });

    res.json(await buildContractSummary(updated));
  } catch (err) {
    logger.error({ err }, "Approve delivery error");
    res.status(500).json({ error: "Failed to approve delivery" });
  }
});

router.post("/:contractId/dispute", requireAuth, async (req, res) => {
  const user = getUser(req);
  const contractId = parseInt(String(req.params.contractId ?? ""));
  if (isNaN(contractId)) {
    res.status(400).json({ error: "Invalid contract ID" });
    return;
  }

  try {
    const [contract] = await db.select().from(contractsTable).where(eq(contractsTable.id, contractId)).limit(1);
    if (!contract || (contract.clientId !== user.id && contract.translatorId !== user.id)) {
      res.status(403).json({ error: "Not your contract" });
      return;
    }

    const { reason } = req.body;
    const [updated] = await db.update(contractsTable)
      .set({ status: "disputed", disputeReason: reason })
      .where(eq(contractsTable.id, contractId))
      .returning();

    await db.insert(contractStatusHistoryTable).values({ contractId, status: "disputed", note: reason });

    res.json(await buildContractSummary(updated));
  } catch (err) {
    logger.error({ err }, "Dispute contract error");
    res.status(500).json({ error: "Failed to dispute contract" });
  }
});

export default router;
