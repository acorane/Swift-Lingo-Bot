import { Router } from "express";
import { db, paymentsTable, contractsTable, contractStatusHistoryTable, notificationsTable, jobsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAuth, getUser } from "../middlewares/auth";
import { logger } from "../lib/logger";

const router = Router();

function formatPayment(p: import("@workspace/db").Payment) {
  return {
    id: p.id, contractId: p.contractId, amount: p.amount,
    platformFee: p.platformFee, translatorPayout: p.translatorPayout,
    status: p.status, paymentMethod: p.paymentMethod,
    createdAt: p.createdAt.toISOString(),
    confirmedAt: p.confirmedAt?.toISOString() ?? null,
    releasedAt: p.releasedAt?.toISOString() ?? null,
  };
}

router.post("/", requireAuth, async (req, res) => {
  const user = getUser(req);
  const { contractId, paymentMethod } = req.body as { contractId?: number; paymentMethod?: string };

  if (!contractId) {
    res.status(400).json({ error: "contractId is required" });
    return;
  }

  try {
    const [contract] = await db.select().from(contractsTable).where(eq(contractsTable.id, contractId)).limit(1);
    if (!contract || contract.clientId !== user.id) {
      res.status(403).json({ error: "Not your contract" });
      return;
    }
    if (contract.status !== "pending_payment") {
      res.status(400).json({ error: "Contract is not awaiting payment" });
      return;
    }

    const existing = await db.select().from(paymentsTable).where(eq(paymentsTable.contractId, contractId)).limit(1);
    if (existing.length > 0) {
      res.status(400).json({ error: "Payment already initiated" });
      return;
    }

    const [payment] = await db.insert(paymentsTable).values({
      contractId,
      amount: contract.agreedPrice,
      platformFee: contract.platformFee,
      translatorPayout: contract.translatorPayout,
      status: "pending",
      paymentMethod: paymentMethod ?? "mock",
    }).returning();

    res.status(201).json(formatPayment(payment));
  } catch (err) {
    logger.error({ err }, "Initiate payment error");
    res.status(500).json({ error: "Failed to initiate payment" });
  }
});

router.post("/:contractId/confirm", requireAuth, async (req, res) => {
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

    const [payment] = await db.select().from(paymentsTable).where(eq(paymentsTable.contractId, contractId)).limit(1);
    if (!payment) {
      res.status(400).json({ error: "No payment initiated yet" });
      return;
    }

    const [updatedPayment] = await db.update(paymentsTable)
      .set({ status: "confirmed", confirmedAt: new Date() })
      .where(eq(paymentsTable.contractId, contractId))
      .returning();

    await db.update(contractsTable)
      .set({ status: "active", paymentStatus: "confirmed" })
      .where(eq(contractsTable.id, contractId));

    await db.insert(contractStatusHistoryTable).values({ contractId, status: "active", note: "Payment confirmed" });

    await db.insert(notificationsTable).values([
      {
        userId: contract.translatorId,
        type: "payment_received",
        title: "Payment Received",
        body: "Payment has been confirmed. You can now start working on the contract.",
        relatedId: contractId,
        relatedType: "contract",
      },
      {
        userId: contract.clientId,
        type: "contract_activated",
        title: "Contract Activated",
        body: "Payment confirmed. The contract is now active and chat is unlocked.",
        relatedId: contractId,
        relatedType: "contract",
      },
    ]);

    res.json(formatPayment(updatedPayment));
  } catch (err) {
    logger.error({ err }, "Confirm payment error");
    res.status(500).json({ error: "Failed to confirm payment" });
  }
});

export default router;
