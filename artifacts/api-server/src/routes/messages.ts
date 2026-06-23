import { Router } from "express";
import { db, messagesTable, contractsTable, usersTable, notificationsTable } from "@workspace/db";
import { eq, or } from "drizzle-orm";
import { requireAuth, getUser } from "../middlewares/auth";
import { formatUser } from "./auth";
import { logger } from "../lib/logger";

const router = Router();

router.get("/:contractId/messages", requireAuth, async (req, res) => {
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
    if (contract.paymentStatus !== "confirmed" && contract.paymentStatus !== "released") {
      res.status(403).json({ error: "Chat is locked until payment is confirmed" });
      return;
    }

    const msgs = await db.select().from(messagesTable).where(eq(messagesTable.contractId, contractId)).orderBy(messagesTable.createdAt);

    const result = await Promise.all(msgs.map(async (m) => {
      const [sender] = await db.select().from(usersTable).where(eq(usersTable.id, m.senderId)).limit(1);
      return {
        id: m.id, contractId: m.contractId, senderId: m.senderId, content: m.content,
        fileUrl: m.fileUrl, fileType: m.fileType, sender: sender ? formatUser(sender) : undefined,
        createdAt: m.createdAt.toISOString(),
      };
    }));

    res.json(result);
  } catch (err) {
    logger.error({ err }, "List messages error");
    res.status(500).json({ error: "Failed to list messages" });
  }
});

router.post("/:contractId/messages", requireAuth, async (req, res) => {
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
    if (contract.paymentStatus !== "confirmed" && contract.paymentStatus !== "released") {
      res.status(403).json({ error: "Chat is locked until payment is confirmed" });
      return;
    }

    const { content, fileUrl, fileType } = req.body;
    const [msg] = await db.insert(messagesTable).values({
      contractId,
      senderId: user.id,
      content,
      fileUrl,
      fileType,
    }).returning();

    const recipientId = contract.clientId === user.id ? contract.translatorId : contract.clientId;
    await db.insert(notificationsTable).values({
      userId: recipientId,
      type: "new_message",
      title: "New Message",
      body: content.substring(0, 100),
      relatedId: contractId,
      relatedType: "contract",
    });

    const [sender] = await db.select().from(usersTable).where(eq(usersTable.id, msg.senderId)).limit(1);
    res.status(201).json({
      id: msg.id, contractId: msg.contractId, senderId: msg.senderId,
      content: msg.content, fileUrl: msg.fileUrl, fileType: msg.fileType,
      sender: sender ? formatUser(sender) : undefined,
      createdAt: msg.createdAt.toISOString(),
    });
  } catch (err) {
    logger.error({ err }, "Send message error");
    res.status(500).json({ error: "Failed to send message" });
  }
});

export default router;
