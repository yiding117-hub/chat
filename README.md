# Chat

A simple group chat, installable as an app, that sends push notifications even when the browser/phone is closed.

- Anyone can sign up (username + password)
- One shared chat room, live via WebSockets while open
- Push notifications (Web Push) for new messages when you're not looking at the tab
- Works as a PWA — "Add to Home Screen" on your phone for an app-like icon

## 1. Get a free database (one-time, ~2 minutes)

This app needs Postgres so your accounts/messages don't get wiped when the free host restarts it.

1. Go to https://neon.tech and sign up (free, no credit card).
2. Create a new project (any name/region).
3. On the project dashboard, copy the **connection string** (starts with `postgresql://...`).
4. Paste it into `.env` as `DATABASE_URL=...` (replacing the placeholder).

## 2. Run locally

```
npm install
npm start
```

Open http://localhost:3000. Note: push notifications require HTTPS, so on localhost you can test everything except actual push delivery (the browser will usually still let you subscribe over `localhost` as a special case in Chrome).

## 3. Deploy for free (Render)

1. Push this folder to a GitHub repo.
2. Go to https://render.com, sign up free, click **New > Web Service**, connect the repo.
3. Build command: `npm install` — Start command: `npm start`.
4. Add environment variables (from your `.env`): `DATABASE_URL`, `SESSION_SECRET`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_CONTACT`.
5. Deploy. Render gives you a free `https://your-app.onrender.com` URL — HTTPS included, which is required for push notifications.

Note: Render's free web services spin down after 15 minutes of no traffic and take ~30s to wake back up on the next request. That's fine for chat history (it's in Postgres, not lost) but means the very first message after idle time may be a bit slow.

## 4. Using it on your phone

1. Open the Render URL in your phone's browser.
2. Sign up / log in.
3. Tap **Enable notifications** in the chat header and allow the permission prompt.
4. (Recommended, especially on iPhone) Add it to your home screen: Safari share menu → "Add to Home Screen". On iOS, push notifications only work for PWAs installed this way (iOS 16.4+), not for a regular open Safari tab.
5. Close the app / lock the phone. Have someone else send a message — you should get a notification.
