import { initializeApp, getApps, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getMessaging } from "firebase-admin/messaging";

function getAdminApp() {
  if (getApps().length) return getApps()[0];
  return initializeApp({
    credential: cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
    }),
  });
}

const MESSAGES = [
  "Time for your daily tzedakah — every coin counts. 🕍",
  "A small act of giving ripples out further than you know.",
  "Your daily pushka moment is waiting for you.",
  "Tamid — always giving, always growing. Today is your day.",
  "The world is repaired one act of tzedakah at a time.",
];

export default async function handler(req, res) {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const app = getAdminApp();
  const db = getFirestore(app);
  const messaging = getMessaging(app);

  const today = new Date().toISOString().split("T")[0];
  const body = MESSAGES[new Date().getDay() % MESSAGES.length];

  const usersSnap = await db.collection("users").get();
  const results = { sent: 0, skipped: 0, errors: 0 };

  for (const userDoc of usersSnap.docs) {
    const data = userDoc.data();
    const profile = data.profile || {};
    const donations = data.donations || [];
    const token = profile.fcmToken;

    if (!token) { results.skipped++; continue; }

    const donatedToday = donations.some(d => d.date?.startsWith(today));
    if (donatedToday) { results.skipped++; continue; }

    const name = profile.name ? `, ${profile.name}` : "";
    const title = `Good morning${name} — daily tzedakah`;

    try {
      await messaging.send({
        token,
        notification: { title, body },
        webpush: {
          notification: {
            title,
            body,
            icon: "/icon-192.png",
            badge: "/icon-192.png",
            tag: "tamid-daily-reminder",
            renotify: true,
          },
          fcmOptions: { link: "/" },
        },
      });
      results.sent++;
    } catch (e) {
      console.error(`FCM error for ${userDoc.id}:`, e.message);
      if (e.code === "messaging/registration-token-not-registered") {
        await db.collection("users").doc(userDoc.id).update({ "profile.fcmToken": null });
      }
      results.errors++;
    }
  }

  console.log("Cron result:", results);
  return res.status(200).json(results);
}
