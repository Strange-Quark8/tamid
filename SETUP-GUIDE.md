# Tamid — Setup Guide

## 1. Create a Firebase Project

1. Go to https://console.firebase.google.com
2. Click "Add project"
3. Name it "tamid" (or whatever you like)
4. Disable Google Analytics (you don't need it for this)
5. Click "Create project"

## 2. Enable Google Sign-In

1. In your Firebase project, go to **Build > Authentication**
2. Click "Get started"
3. Go to the **Sign-in method** tab
4. Click "Google" and toggle it **ON**
5. Enter your email as the support email
6. Click **Save**

## 3. Enable Firestore Database

1. Go to **Build > Firestore Database**
2. Click "Create database"
3. Choose **Start in test mode** (we'll add security rules later)
4. Select the closest region to you
5. Click **Enable**

## 4. Get Your Firebase Config

1. Go to **Project Settings** (gear icon at top left)
2. Scroll down to "Your apps"
3. Click the **Web** icon (looks like `</>`)
4. Register app with nickname "tamid-web"
5. You'll see a `firebaseConfig` object — copy those values
6. Paste them into `src/firebase.js` replacing the placeholder values

## 5. Add Your Vercel Domain

1. Still in **Authentication > Settings > Authorized domains**
2. Add your Vercel URL (e.g., `tamid-abc123.vercel.app`)
3. This allows Google sign-in to work on your deployed site

## 6. Deploy

```bash
cd tamid
npm install
npm run dev     # test locally first
vercel          # deploy when ready
```

That's it! Google sign-in and data persistence are now live.
