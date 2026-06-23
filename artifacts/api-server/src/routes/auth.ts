import { createHmac } from "node:crypto";
import { Router } from "express";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { signToken } from "../middlewares/auth";
import { logger } from "../lib/logger";

const router = Router();

function parseTelegramInitData(initData: string): Record<string, string> {
  const params: Record<string, string> = {};
  const pairs = initData.split("&");
  for (const pair of pairs) {
    const eqIdx = pair.indexOf("=");
    if (eqIdx === -1) continue;
    const key = decodeURIComponent(pair.slice(0, eqIdx));
    const value = decodeURIComponent(pair.slice(eqIdx + 1));
    params[key] = value;
  }
  return params;
}

function validateTelegramHash(initData: string, botToken: string): boolean {
  try {
    const params = parseTelegramInitData(initData);
    const hash = params["hash"];
    if (!hash) return false;

    const dataCheckEntries = Object.entries(params)
      .filter(([k]) => k !== "hash")
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join("\n");

    const secretKey = createHmac("sha256", "WebAppData")
      .update(botToken)
      .digest();
    const expectedHash = createHmac("sha256", secretKey)
      .update(dataCheckEntries)
      .digest("hex");

    return expectedHash === hash;
  } catch {
    return false;
  }
}

router.post("/telegram", async (req, res) => {
  try {
    const { initData } = req.body as { initData?: string };

    const botToken = process.env["TELEGRAM_BOT_TOKEN"];
    const isProduction = process.env["NODE_ENV"] === "production";

    let telegramId: string;
    let username: string | undefined;
    let firstName: string | undefined;
    let lastName: string | undefined;
    let photoUrl: string | undefined;

    if (initData && initData.trim()) {
      if (isProduction && botToken) {
        if (!validateTelegramHash(initData, botToken)) {
          res.status(401).json({ error: "Invalid Telegram auth data" });
          return;
        }
      }

      const params = parseTelegramInitData(initData);
      const userStr = params["user"];
      if (userStr) {
        try {
          const userObj = JSON.parse(userStr);
          telegramId = String(userObj.id);
          username = userObj.username;
          firstName = userObj.first_name;
          lastName = userObj.last_name;
          photoUrl = userObj.photo_url;
        } catch {
          telegramId = params["user"] ?? "dev_user_1";
        }
      } else {
        telegramId = "dev_user_1";
        firstName = "Dev";
        lastName = "User";
      }
    } else {
      telegramId = "dev_user_1";
      firstName = "Dev";
      lastName = "User";
    }

    let [user] = await db.select().from(usersTable).where(eq(usersTable.telegramId, telegramId)).limit(1);

    if (!user) {
      const [newUser] = await db.insert(usersTable).values({
        telegramId,
        username,
        firstName,
        lastName,
        profilePhotoUrl: photoUrl,
        role: "client",
        preferredLanguage: "en",
        isTranslatorApproved: false,
      }).returning();
      user = newUser;
    } else {
      const [updated] = await db.update(usersTable)
        .set({
          username: username ?? user.username,
          firstName: firstName ?? user.firstName,
          lastName: lastName ?? user.lastName,
          profilePhotoUrl: photoUrl ?? user.profilePhotoUrl,
        })
        .where(eq(usersTable.id, user.id))
        .returning();
      user = updated;
    }

    const token = signToken(user.id);
    res.json({ user: formatUser(user), token });
  } catch (err) {
    logger.error({ err }, "Telegram auth error");
    res.status(500).json({ error: "Authentication failed" });
  }
});

export function formatUser(user: import("@workspace/db").User) {
  return {
    id: user.id,
    telegramId: user.telegramId,
    username: user.username,
    firstName: user.firstName,
    lastName: user.lastName,
    profilePhotoUrl: user.profilePhotoUrl,
    role: user.role,
    preferredLanguage: user.preferredLanguage,
    isTranslatorApproved: user.isTranslatorApproved,
    createdAt: user.createdAt.toISOString(),
  };
}

export default router;
