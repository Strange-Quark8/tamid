// ─────────────────────────────────────────────
// FIREBASE CONFIG — You need to fill this in!
// See SETUP-GUIDE.md for step-by-step instructions
// ─────────────────────────────────────────────
import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getMessaging } from "firebase/messaging";

const firebaseConfig = {
  apiKey: "AIzaSyBBnCk_Jhy-h9Y728qxg1wTZzU-vUlXHqk",
  authDomain: "tamid-app.firebaseapp.com",
  projectId: "tamid-app",
  storageBucket: "tamid-app.firebasestorage.app",
  messagingSenderId: "67237654594",
  appId: "1:67237654594:web:59eeb621f39b1fc69a7ddb"
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
export const db = getFirestore(app);
export const messaging = getMessaging(app);
