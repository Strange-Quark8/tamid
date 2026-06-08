import { useState, useEffect } from "react";
import { auth, googleProvider, db, messaging } from "./firebase";
import { getToken } from "firebase/messaging";
import { signInWithPopup, onAuthStateChanged, signOut } from "firebase/auth";
import { doc, getDoc, setDoc, updateDoc, arrayUnion } from "firebase/firestore";
import { HDate, HebrewCalendar, flags } from "@hebcal/core";

// ═══════════════════════════════════════════════
//  HEBREW CALENDAR
// ═══════════════════════════════════════════════
function getHebrewDate() {
  const hd = new HDate();
  return { day: hd.getDate(), month: hd.getMonthName(), year: hd.getFullYear(), display: `${hd.getDate()} ${hd.getMonthName()} ${hd.getFullYear()}` };
}

function getTodayHoliday() {
  try {
    const today = new Date();
    const events = HebrewCalendar.calendar({ start: today, end: today, candlelighting: false, sedrot: false, omer: false, noMinorFast: true, noModern: true, noRoshChodesh: true, noSpecialShabbat: true });
    const mask = flags.CHAG | flags.MINOR_HOLIDAY | flags.CHOL_HAMOED | flags.CHANUKAH_CANDLES | flags.MAJOR_FAST;
    const primary = events.find(ev => ev.getFlags() & mask);
    if (primary) return { name: primary.getDesc() };
    const erev = events.find(ev => ev.getFlags() & flags.EREV);
    if (erev) return { name: erev.getDesc(), isErev: true };
    if (today.getDay() === 5) return { name: "Erev Shabbat" };
  } catch (e) { console.error("Hebcal error:", e); }
  return null;
}

function getHolidayEmoji(name) {
  const n = name.toLowerCase();
  if (n.includes("rosh hashana")) return "🍎"; if (n.includes("yom kippur")) return "🕊️";
  if (n.includes("sukkot")) return "🌿"; if (n.includes("simchat")) return "📜";
  if (n.includes("chanukah") || n.includes("hanukkah")) return "🕎"; if (n.includes("purim")) return "🎭";
  if (n.includes("pesach") || n.includes("passover")) return "🫓"; if (n.includes("shavuot")) return "🌾";
  if (n.includes("shabbat")) return "🕯️"; return "✨";
}

function getHolidayNudge(name) {
  const n = name.toLowerCase();
  if (n.startsWith("erev ") && !n.includes("shabbat")) return "Give tzedakah before chag begins tonight";
  if (n.includes("rosh hashana")) return "Start the new year with extra generosity";
  if (n.includes("yom kippur")) return "Tzedakah, Tefillah, Teshuvah — give generously before the fast";
  if (n.includes("sukkot")) return "Rejoice and share your blessings";
  if (n.includes("chanukah")) return "Light up someone's life with a gift";
  if (n.includes("purim")) return "Matanot La'evyonim — gifts to the poor";
  if (n.includes("pesach")) return "Ma'ot Chitim — help others celebrate freedom";
  if (n.includes("shavuot")) return "Give in honor of receiving the Torah";
  if (n.includes("shabbat")) return "Give tzedakah before lighting candles";
  return "A time for extra generosity";
}

// ═══════════════════════════════════════════════
//  QUOTES
// ═══════════════════════════════════════════════
const QUOTES = [
  { text: "Tzedakah saves from death.", source: "Proverbs 10:2" },
  { text: "You shall surely open your hand to your poor and needy kin.", source: "Deuteronomy 15:11" },
  { text: "Those who are generous to the poor make a loan to God.", source: "Proverbs 19:17" },
  { text: "On three things the world stands: on the Torah, on the service, and on acts of kindness.", source: "Pirkei Avot 1:2" },
  { text: "Share your bread with the hungry.", source: "Isaiah 58:7" },
  { text: "When you see the naked, clothe them.", source: "Isaiah 58:7" },
  { text: "You shall relieve him… that he may live with you.", source: "Leviticus 25:35" },
  { text: "Tzedakah is equivalent to all the other mitzvot combined.", source: "Bava Batra 9a" },
  { text: "One who causes others to give is greater than one who gives.", source: "Bava Batra 9a" },
  { text: "The highest level of tzedakah is to strengthen a person before they fall into poverty.", source: "Mishneh Torah, Gifts to the Poor 10" },
];
function getDailyQuote() { const d = Math.floor((Date.now() - new Date(new Date().getFullYear(), 0, 0).getTime()) / 86400000); return QUOTES[d % QUOTES.length]; }

// ═══════════════════════════════════════════════
//  CHARITIES
// ═══════════════════════════════════════════════
const CHARITIES = [
  { id: "colel", name: "Colel Chabad", category: "Elderly & Families", desc: "Israel's oldest charity — soup kitchens, elderly care, widows & orphans", venmo: "ColelChabad", website: "https://colelchabad.org/donate-2/", color: "#C8963E", region: "US / Israel" },
  { id: "chb", name: "Chabad House Bowery", category: "Community & Youth", desc: "Warm, soulful Judaism for young Jews downtown — learning, prayer & connection for college students and young professionals", venmo: "ChabadHouseBowery", website: null, color: "#2E5EA7", region: "NYC" },
  { id: "jwb", name: "Jewish Welfare Board", category: "Community & Welfare", desc: "Supporting the Jewish community of Singapore — welfare, education, and communal life", stripe: "https://donate.stripe.com/fZu4gy37paG7boj7bD2Fa00", website: "https://jwbs.org.sg", color: "#5BA8D4", region: "Singapore" },
  { id: "ltl", name: "Larger Than Life", category: "Children & Health", desc: "Helping Israeli children with cancer and their families — dream trips, summer camps, and pediatric oncology support", venmo: "Ltlusa5415", website: "https://largerthanlifeusa.org", color: "#E0479E", region: "US / Israel" },
  // TODO: Add JWB Singapore with Stripe link once available
];
const PRESET_AMOUNTS = [1, 2, 3, 5, 10, 18, 36];

// ═══════════════════════════════════════════════
//  NOTIFICATIONS
// ═══════════════════════════════════════════════
async function getFCMToken() {
  if (!("Notification" in window) || !("serviceWorker" in navigator)) return null;
  if (Notification.permission === "denied") return null;
  if (Notification.permission !== "granted") {
    const result = await Notification.requestPermission();
    if (result !== "granted") return null;
  }
  try {
    const reg = await navigator.serviceWorker.ready;
    return await getToken(messaging, {
      vapidKey: import.meta.env.VITE_VAPID_KEY,
      serviceWorkerRegistration: reg,
    });
  } catch (e) {
    console.error("FCM token error:", e);
    return null;
  }
}

// ═══════════════════════════════════════════════
//  CHARITY PICKER MODAL
// ═══════════════════════════════════════════════
function CharityPicker({ current, onSelect, onClose }) {
  return (
    <div style={S.overlay} onClick={onClose}>
      <div style={{ ...S.modal, maxWidth: 360 }} onClick={e => e.stopPropagation()}>
        <div style={{ fontFamily: "'Cormorant Garamond',Georgia,serif", fontSize: 22, fontWeight: 700, color: "#E8D5AA", marginBottom: 16 }}>
          Choose Charity
        </div>
        {CHARITIES.map(c => (
          <button key={c.id} onClick={() => { onSelect(c.id); onClose(); }}
            style={{
              display: "flex", alignItems: "center", gap: 12, padding: "14px 16px", width: "100%",
              background: current === c.id ? "rgba(200,150,62,.08)" : "transparent",
              border: current === c.id ? `1.5px solid ${c.color}` : "1.5px solid rgba(200,150,62,.08)",
              borderRadius: 12, cursor: "pointer", textAlign: "left", marginBottom: 8, transition: "all .15s",
            }}>
            <div style={{ width: 10, height: 10, borderRadius: "50%", background: c.color, flexShrink: 0 }} />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 15, fontWeight: 600, color: "#E8D5AA" }}>{c.name}</div>
              <div style={{ fontSize: 11, color: "rgba(200,150,62,.4)", marginTop: 2 }}>
                {c.category} · {c.region} · {c.venmo ? "Venmo" : c.stripe ? "Stripe" : "Web"}
              </div>
            </div>
            {current === c.id && <span style={{ color: c.color, fontSize: 16 }}>✓</span>}
          </button>
        ))}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════
//  ANIMATED VINES
// ═══════════════════════════════════════════════
function AnimatedVines() {
  return (
    <div style={{ position: "fixed", inset: 0, overflow: "hidden", zIndex: 0, pointerEvents: "none" }}>
      <div style={{ position: "absolute", inset: 0, background: "radial-gradient(ellipse at 30% 20%, #0F1F3A 0%, #0A1628 50%, #060E1A 100%)" }} />
      <svg viewBox="0 0 420 900" preserveAspectRatio="xMidYMid slice" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", opacity: .18 }}>
        <defs><linearGradient id="vg" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stopColor="#C8963E" /><stop offset="50%" stopColor="#E8C068" /><stop offset="100%" stopColor="#C8963E" /></linearGradient></defs>
        <g style={{ animation: "vineSwayLeft 8s ease-in-out infinite" }}>
          <path d="M-20 900 C-20 750 40 700 30 600 C20 500 -10 450 10 350 C30 250 0 200 20 100 C35 30 10 0 10 -20" fill="none" stroke="url(#vg)" strokeWidth="2" />
          <path d="M30 600 C50 580 60 590 45 610 C30 620 25 610 30 600Z" fill="#C8963E" opacity=".6" style={{ animation: "leafPulse 4s ease-in-out .5s infinite" }} />
          <path d="M10 350 C-15 330 -20 345 -5 360 C10 370 15 355 10 350Z" fill="#C8963E" opacity=".5" style={{ animation: "leafPulse 4s ease-in-out 1s infinite" }} />
          <path d="M20 100 C45 80 50 95 35 110 C20 120 15 105 20 100Z" fill="#C8963E" opacity=".4" style={{ animation: "leafPulse 4s ease-in-out 1.5s infinite" }} />
        </g>
        <g style={{ animation: "vineSwayRight 9s ease-in-out infinite" }}>
          <path d="M440 900 C440 780 390 720 400 630 C410 540 440 480 420 380 C400 280 430 220 415 130 C405 60 420 0 420 -20" fill="none" stroke="url(#vg)" strokeWidth="2" />
          <path d="M400 630 C375 615 370 628 385 643 C400 653 405 640 400 630Z" fill="#C8963E" opacity=".6" style={{ animation: "leafPulse 4s ease-in-out .7s infinite" }} />
          <path d="M420 380 C445 365 450 378 435 393 C420 403 415 390 420 380Z" fill="#C8963E" opacity=".5" style={{ animation: "leafPulse 4s ease-in-out 1.2s infinite" }} />
        </g>
        {[{ x: 60, y: 150 }, { x: 350, y: 250 }, { x: 80, y: 450 }, { x: 340, y: 550 }, { x: 100, y: 700 }, { x: 320, y: 800 }].map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r={1.5} fill="#C8963E" opacity={.12} style={{ animation: `dotPulse ${3 + i * .5}s ease-in-out ${i * .3}s infinite` }} />
        ))}
      </svg>
    </div>
  );
}

// ═══════════════════════════════════════════════
//  NAV ICONS
// ═══════════════════════════════════════════════
const IconDollarBag = ({ color }) => <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M9 3h6l2 4H7l2-4z" /><path d="M7 7c0 0-2 1-2 5s1 6 2 7c1.5 1.5 4 2 5 2s3.5-.5 5-2c1-1 2-3 2-7s-2-5-2-5" /><path d="M12 11v5" /><path d="M10 13h4" /></svg>;
const IconClock = ({ color }) => <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 3" /></svg>;
const IconChart = ({ color }) => <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 20l4-6 4 3 4-7 6-4" /><path d="M17 6h4v4" /></svg>;
const IconGear = ({ color }) => <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" /></svg>;

// ═══════════════════════════════════════════════
//  MAIN APP
// ═══════════════════════════════════════════════
export default function TamidApp() {
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [profile, setProfile] = useState(null);
  const [donations, setDonations] = useState([]);
  const [screen, setScreen] = useState("home");
  const [donatedToday, setDonatedToday] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [showCharityPicker, setShowCharityPicker] = useState(false);
  const [pending, setPending] = useState(null);
  const [animateCoin, setAnimateCoin] = useState(false);
  const [btnPressed, setBtnPressed] = useState(false);
  const [customAmt, setCustomAmt] = useState("");
  const [showCustom, setShowCustom] = useState(false);
  const [editName, setEditName] = useState(false);
  const [addYahrzeit, setAddYahrzeit] = useState(false);
  const [yForm, setYForm] = useState({ name: "", month: "", day: "" });
  const [onboardData, setOnboardData] = useState({ name: "", charity: "colel" });

  // ─── Auth + data loading ───
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      if (u) {
        try {
          const snap = await getDoc(doc(db, "users", u.uid));
          if (snap.exists()) {
            const data = snap.data();
            setProfile(data.profile || null);
            setDonations(data.donations || []);
            setDonatedToday((data.donations || []).some(x => new Date(x.date).toDateString() === new Date().toDateString()));
          }
        } catch (e) {
          console.error("Firestore read failed:", e);
          // Don't block the app — user can still onboard fresh
        }
      } else {
        setProfile(null);
        setDonations([]);
      }
      setAuthLoading(false);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    if (profile && user) {
      getFCMToken().then(token => {
        if (token) setDoc(doc(db, "users", user.uid), { profile: { fcmToken: token } }, { merge: true });
      });
    }
  }, [profile]);

  // ─── Firestore helpers ───
  const saveProfile = async (prof) => {
    setProfile(prof);
    if (user) {
      try { await setDoc(doc(db, "users", user.uid), { profile: prof }, { merge: true }); }
      catch (e) { console.error("Failed to save profile:", e); }
    }
  };
  const addDonation = async (don) => {
    setDonations(prev => [...prev, don]);
    setDonatedToday(true);
    if (user) {
      try { await updateDoc(doc(db, "users", user.uid), { donations: arrayUnion(don) }); }
      catch (e) {
        console.error("Failed to save donation:", e);
        // Try setDoc as fallback (in case doc doesn't exist yet)
        try { await setDoc(doc(db, "users", user.uid), { donations: [don] }, { merge: true }); }
        catch (e2) { console.error("Fallback save also failed:", e2); }
      }
    }
  };

  const signInWithGoogle = async () => { try { await signInWithPopup(auth, googleProvider); } catch (e) { console.error(e); } };

  const completeOnboarding = async () => {
    await saveProfile({ name: onboardData.name, selectedCharity: onboardData.charity, amount: 1, yahrzeits: [] });
  };

  // ─── Derived ───
  const charity = CHARITIES.find(c => c.id === (profile?.selectedCharity || "colel")) || CHARITIES[0];
  const hebrewDate = getHebrewDate();
  const todayHoliday = getTodayHoliday();
  const quote = getDailyQuote();
  const today = new Date();
  const thisYear = today.getFullYear();
  const yearDonations = donations.filter(d => new Date(d.date).getFullYear() === thisYear);
  const yearTotal = yearDonations.reduce((s, d) => s + d.amount, 0);
  const totalAllTime = donations.reduce((s, d) => s + d.amount, 0);
  const isRestDay = (date) => {
    if (date.getDay() === 6) return true; // Shabbat
    const evts = HebrewCalendar.calendar({ start: date, end: date, sedrot: false, omer: false });
    return evts.some(e => (e.getFlags() & flags.CHAG) !== 0);
  };
  const streak = (() => {
    let s = 0, d = new Date(); d.setHours(0, 0, 0, 0);
    for (let i = 0; i < 365; i++) {
      const donated = donations.some(x => new Date(x.date).toDateString() === d.toDateString());
      if (donated) { s++; }
      else if (!isRestDay(d)) { break; }
      d.setDate(d.getDate() - 1);
    }
    return s;
  })();
  const charityBreakdown = yearDonations.reduce((a, d) => { a[d.charity] = (a[d.charity] || 0) + d.amount; return a; }, {});
  const monthlyData = Array.from({ length: 12 }, (_, i) => { const m = yearDonations.filter(d => new Date(d.date).getMonth() === i); return { mo: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][i], tot: m.reduce((s, d) => s + d.amount, 0) }; });
  const curAmt = showCustom && customAmt ? parseFloat(customAmt) : (profile?.amount || 1);

  const handleDonate = () => {
    if (!curAmt || curAmt <= 0) return;
    const url = charity.venmo
      ? `https://venmo.com/${charity.venmo}?txn=pay&amount=${curAmt}&note=${encodeURIComponent("Daily Tzedakah - Tamid")}`
      : charity.stripe
      ? `${charity.stripe}?prefilled_amount=${Math.round(curAmt * 100)}`
      : charity.website;
    if (url) window.open(url, "_blank");
    setPending({ charity: charity.name, charityId: charity.id, amount: curAmt, date: new Date().toISOString() });
    setShowConfirm(true);
  };

  const confirmDonation = async () => {
    if (pending) {
      await addDonation(pending);
      setShowConfirm(false); setPending(null);
      setAnimateCoin(true); setTimeout(() => setAnimateCoin(false), 1200);
    }
  };

  const TABS = [
    { id: "home", label: "Donate", Icon: IconDollarBag },
    { id: "history", label: "History", Icon: IconClock },
    { id: "progress", label: "Progress", Icon: IconChart },
    { id: "settings", label: "Settings", Icon: IconGear },
  ];

  // ═══ LOADING ═══
  if (authLoading) return (
    <div style={{ minHeight: "100vh", background: "#0A1628", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 20 }}>
      <Styles /><AnimatedVines />
      <div style={{ zIndex: 1, color: "#C8963E", fontSize: 28, animation: "pulse 2s ease infinite" }}>✡</div>
      <div style={{ zIndex: 1, maxWidth: 280, textAlign: "center", fontFamily: "'Cormorant Garamond',Georgia,serif", fontSize: 15, fontStyle: "italic", color: "rgba(200,150,62,.4)", lineHeight: 1.6 }}>
        "{quote.text}"
        <div style={{ fontSize: 11, marginTop: 6, color: "rgba(200,150,62,.25)" }}>— {quote.source}</div>
      </div>
    </div>
  );

  // ═══ SIGN IN ═══
  if (!user) return (
    <div style={{ minHeight: "100vh", background: "#0A1628", display: "flex", alignItems: "center", justifyContent: "center", position: "relative" }}>
      <Styles /><AnimatedVines />
      <div style={{ zIndex: 1, textAlign: "center", padding: "40px 30px", maxWidth: 360 }}>
        <div style={{ fontSize: 36, marginBottom: 8 }}>✡</div>
        <h1 style={{ fontFamily: "'Cormorant Garamond',Georgia,serif", fontSize: 38, fontWeight: 700, color: "#E8D5AA", letterSpacing: 2, margin: "0 0 4px" }}>Tamid</h1>
        <div style={{ fontSize: 12, letterSpacing: 3, color: "#C8963E", textTransform: "uppercase", marginBottom: 24 }}>Daily Tzedakah</div>
        <div style={{ fontFamily: "'Cormorant Garamond',Georgia,serif", fontSize: 15, fontStyle: "italic", color: "rgba(200,150,62,.35)", lineHeight: 1.6, maxWidth: 260, margin: "0 auto 32px" }}>
          "{quote.text}"<br /><span style={{ fontSize: 11, color: "rgba(200,150,62,.2)" }}>— {quote.source}</span>
        </div>
        <button onClick={signInWithGoogle} style={{ padding: "14px 32px", borderRadius: 12, border: "1.5px solid rgba(200,150,62,.3)", background: "linear-gradient(145deg,rgba(200,150,62,.12),rgba(200,150,62,.04))", color: "#E8D5AA", fontWeight: 600, fontSize: 15, cursor: "pointer", display: "flex", alignItems: "center", gap: 10, margin: "0 auto", boxShadow: "0 4px 20px rgba(200,150,62,.1)" }}>
          <svg width="20" height="20" viewBox="0 0 24 24"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" /><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" /><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18A10.96 10.96 0 001 12c0 1.77.42 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05" /><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" /></svg>
          Sign in with Google
        </button>
      </div>
    </div>
  );

  // ═══ ONBOARDING ═══
  if (!profile) return (
    <div style={{ minHeight: "100vh", background: "#0A1628", position: "relative" }}>
      <Styles /><AnimatedVines />
      <div style={{ position: "relative", zIndex: 1, padding: "80px 24px 40px", maxWidth: 380, margin: "0 auto", textAlign: "center", animation: "fadeIn .5s ease" }}>
        <h2 style={{ fontFamily: "'Cormorant Garamond',Georgia,serif", fontSize: 28, color: "#E8D5AA", fontWeight: 700, marginBottom: 8 }}>Welcome to Tamid</h2>
        <p style={{ fontSize: 14, color: "rgba(232,213,170,.5)", marginBottom: 32 }}>Let's set up your daily giving</p>
        <div style={{ textAlign: "left", marginBottom: 16 }}>
          <label style={S.onLabel}>What's your name?</label>
          <input value={onboardData.name} onChange={e => setOnboardData(d => ({ ...d, name: e.target.value }))} placeholder="Your name" style={S.onInput} autoFocus />
        </div>
        <button onClick={() => { if (onboardData.name) completeOnboarding(); }} disabled={!onboardData.name}
          style={{ ...S.goldBtn, width: "100%", opacity: onboardData.name ? 1 : .4 }}>Start Giving</button>
      </div>
    </div>
  );

  // ═══ MAIN APP ═══
  return (
    <div style={{ maxWidth: 420, margin: "0 auto", minHeight: "100vh", position: "relative", fontFamily: "'DM Sans',sans-serif", color: "#E8D5AA" }}>
      <Styles /><AnimatedVines />

      {/* Header */}
      <div style={{ position: "relative", zIndex: 1, padding: "20px 20px 12px", display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid rgba(200,150,62,.12)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 24 }}>✡</span>
          <div><div style={{ fontFamily: "'Cormorant Garamond',Georgia,serif", fontSize: 22, fontWeight: 700, lineHeight: 1.1 }}>Tamid</div><div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: 1.5, color: "#C8963E", fontWeight: 600 }}>Daily Tzedakah</div></div>
        </div>
        <div style={{ fontSize: 13, color: "rgba(200,150,62,.5)" }}>Shalom, {profile.name}</div>
      </div>

      {/* Holiday banner */}
      {todayHoliday && (
        <div style={{ margin: "12px 20px 0", padding: "12px 16px", background: "linear-gradient(135deg,rgba(200,150,62,.08),rgba(200,150,62,.03))", borderRadius: 12, display: "flex", alignItems: "center", gap: 12, border: "1px solid rgba(200,150,62,.15)", position: "relative", zIndex: 1, animation: "fadeIn .5s ease" }}>
          <span style={{ fontSize: 22 }}>{getHolidayEmoji(todayHoliday.name)}</span>
          <div>
            <div style={{ fontFamily: "'Cormorant Garamond',Georgia,serif", fontWeight: 700, fontSize: 15 }}>{todayHoliday.name}</div>
            <div style={{ fontSize: 12, opacity: .7, marginTop: 2 }}>{getHolidayNudge(todayHoliday.name)}</div>
          </div>
        </div>
      )}

      {/* Nav */}
      <div style={{ display: "flex", padding: "0 20px", borderBottom: "1px solid rgba(200,150,62,.1)", marginTop: 8, position: "relative", zIndex: 1 }}>
        {TABS.map(t => { const a = screen === t.id; return <button key={t.id} onClick={() => setScreen(t.id)} style={{ flex: 1, padding: "10px 0 8px", background: "none", border: "none", cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: 2, borderBottom: a ? "2px solid #C8963E" : "2px solid transparent", transition: "all .15s", borderRadius: "8px 8px 0 0" }}><t.Icon color={a ? "#C8963E" : "rgba(200,150,62,.35)"} /><span style={{ fontSize: 11, color: a ? "#C8963E" : "rgba(200,150,62,.35)", fontWeight: a ? 600 : 400 }}>{t.label}</span></button>; })}
      </div>

      <div style={{ position: "relative", zIndex: 1, padding: "16px 20px 80px" }}>

        {/* ═══ DONATE ═══ */}
        {screen === "home" && (
          <div style={{ animation: "fadeIn .4s ease" }}>
            <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
              {[{ v: streak, l: "Day Streak" }, { v: `$${yearTotal}`, l: `${thisYear} Total` }, { v: yearDonations.length, l: "Donations" }].map((s, i) => (
                <div key={i} style={{ flex: 1, background: "rgba(200,150,62,.04)", borderRadius: 12, padding: "14px 10px", textAlign: "center", border: "1px solid rgba(200,150,62,.1)" }}>
                  <div style={{ fontFamily: "'Cormorant Garamond',Georgia,serif", fontSize: 22, fontWeight: 700, color: "#E8C068" }}>{s.v}</div>
                  <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: .8, color: "rgba(200,150,62,.4)", marginTop: 2, fontWeight: 500 }}>{s.l}</div>
                </div>
              ))}
            </div>

            {/* Charity card — tap to switch */}
            <button onClick={() => setShowCharityPicker(true)} style={{
              display: "block", width: "100%", textAlign: "left", cursor: "pointer",
              background: "rgba(200,150,62,.04)", borderRadius: 12, padding: "16px 18px",
              border: "1px solid rgba(200,150,62,.1)", borderLeft: `3px solid ${charity.color}`,
              transition: "all .2s",
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 1.2, color: charity.color, fontWeight: 600 }}>{charity.category}</div>
                <div style={{ fontSize: 10, color: "rgba(200,150,62,.3)", display: "flex", alignItems: "center", gap: 4 }}>
                  Tap to switch
                  <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="rgba(200,150,62,.3)" strokeWidth="2"><path d="M6 4l4 4-4 4" /></svg>
                </div>
              </div>
              <div style={{ fontFamily: "'Cormorant Garamond',Georgia,serif", fontSize: 22, fontWeight: 700, marginTop: 4 }}>{charity.name}</div>
              <div style={{ fontSize: 13, color: "rgba(200,150,62,.5)", marginTop: 4, lineHeight: 1.5 }}>{charity.desc}</div>
              <div style={{ fontSize: 11, color: "#5BA8D4", marginTop: 6 }}>
                {charity.venmo ? `Venmo: @${charity.venmo}` : charity.stripe ? "via Stripe" : ""}
              </div>
            </button>

            {/* Amount selector */}
            <div style={{ marginTop: 20 }}>
              <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 1.2, color: "rgba(200,150,62,.4)", fontWeight: 600, marginBottom: 8 }}>Daily Amount</div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {PRESET_AMOUNTS.map(a => (
                  <button key={a} onClick={() => { setShowCustom(false); saveProfile({ ...profile, amount: a }); }}
                    style={{ padding: "8px 14px", borderRadius: 20, cursor: "pointer", fontWeight: 600, fontSize: 14, transition: "all .15s", display: "flex", alignItems: "center",
                      background: !showCustom && profile.amount === a ? "linear-gradient(145deg,#C8963E,#A67A2E)" : "transparent",
                      color: !showCustom && profile.amount === a ? "#0A1628" : "rgba(200,150,62,.5)",
                      border: !showCustom && profile.amount === a ? "1.5px solid #C8963E" : "1.5px solid rgba(200,150,62,.15)" }}>
                    ${a}{a === 18 && <span style={{ fontSize: 9, marginLeft: 2 }}>chai</span>}{a === 36 && <span style={{ fontSize: 9, marginLeft: 2 }}>double chai</span>}
                  </button>
                ))}
                <button onClick={() => setShowCustom(true)} style={{ padding: "8px 14px", borderRadius: 20, cursor: "pointer", fontWeight: 600, fontSize: 14, background: showCustom ? "linear-gradient(145deg,#C8963E,#A67A2E)" : "transparent", color: showCustom ? "#0A1628" : "rgba(200,150,62,.5)", border: showCustom ? "1.5px solid #C8963E" : "1.5px solid rgba(200,150,62,.15)", transition: "all .15s" }}>Custom</button>
              </div>
              {showCustom && <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 8 }}><span style={{ color: "#C8963E", fontSize: 20, fontWeight: 700 }}>$</span><input type="number" min="0.5" step="0.5" value={customAmt} onChange={e => setCustomAmt(e.target.value)} placeholder="Enter amount" autoFocus style={{ flex: 1, padding: "10px 14px", borderRadius: 10, border: "1.5px solid rgba(200,150,62,.2)", background: "rgba(200,150,62,.04)", fontSize: 16, color: "#E8D5AA", fontWeight: 600, outline: "none" }} /></div>}
            </div>

            {/* 3D Donate Button */}
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginTop: 32, position: "relative" }}>
              {animateCoin && <div style={{ position: "absolute", top: -30, fontSize: 32, animation: "coinDrop 1s ease forwards", zIndex: 10 }}>🪙</div>}
              {donatedToday ? (
                <div style={{ textAlign: "center" }}>
                  <div style={{ fontSize: 48, marginBottom: 8, color: "#5BA34B" }}>✓</div>
                  <div style={{ fontFamily: "'Cormorant Garamond',Georgia,serif", fontSize: 22, color: "#5BA34B", fontWeight: 700 }}>Today's tzedakah — done</div>
                  <div style={{ fontSize: 13, color: "rgba(200,150,62,.4)", marginTop: 6 }}>You can still give again</div>
                  <button onClick={handleDonate} style={{ marginTop: 16, padding: "10px 28px", background: "rgba(200,150,62,.08)", border: "1.5px solid rgba(200,150,62,.2)", borderRadius: 25, color: "rgba(200,150,62,.6)", fontSize: 14, cursor: "pointer", fontWeight: 600 }}>Give Again — ${curAmt}</button>
                </div>
              ) : (
                <button onPointerDown={() => setBtnPressed(true)} onPointerUp={() => { setBtnPressed(false); handleDonate(); }} onPointerLeave={() => setBtnPressed(false)}
                  style={{
                    width: 190, height: 190, borderRadius: "50%", border: "3px solid rgba(232,192,104,.3)", cursor: "pointer", outline: "none",
                    background: btnPressed ? "radial-gradient(circle at 50% 55%, #A67A2E, #8B6914 60%, #6E5210 100%)" : "radial-gradient(circle at 40% 35%, #E8C068, #C8963E 40%, #A67A2E 80%, #8B6914 100%)",
                    color: btnPressed ? "rgba(10,22,40,.7)" : "#0A1628",
                    display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
                    boxShadow: btnPressed ? "0 2px 8px rgba(200,150,62,.2), inset 0 2px 6px rgba(0,0,0,.2)" : "0 8px 0px #8B6914, 0 12px 32px rgba(200,150,62,.3), 0 0 60px rgba(200,150,62,.1), inset 0 2px 0 rgba(255,255,255,.15)",
                    transform: btnPressed ? "translateY(6px) scale(0.97)" : "translateY(0) scale(1)",
                    transition: "all .1s ease",
                  }}>
                  <div style={{ fontSize: 12, letterSpacing: 1.5, textTransform: "uppercase", opacity: .7 }}>Tap to Give</div>
                  <div style={{ fontFamily: "'Cormorant Garamond',Georgia,serif", fontSize: 40, fontWeight: 700, lineHeight: 1, marginTop: 4, textShadow: "0 1px 2px rgba(0,0,0,.1)" }}>${curAmt}</div>
                  <div style={{ fontSize: 11, opacity: .6, marginTop: 6, fontStyle: "italic" }}>to {charity.name}</div>
                </button>
              )}
            </div>
            <div style={{ textAlign: "center", marginTop: 24 }}><span style={{ fontFamily: "'Cormorant Garamond',Georgia,serif", fontStyle: "italic", fontSize: 12, color: "rgba(200,150,62,.3)", padding: "4px 16px", border: "1px solid rgba(200,150,62,.08)", borderRadius: 20 }}>{hebrewDate.display}</span></div>
          </div>
        )}

        {/* ═══ HISTORY ═══ */}
        {screen === "history" && (
          <div style={{ animation: "fadeIn .4s ease" }}>
            <div style={{ fontFamily: "'Cormorant Garamond',Georgia,serif", fontSize: 24, fontWeight: 700, marginBottom: 16 }}>Donation History</div>
            {donations.length === 0 ? <div style={{ textAlign: "center", padding: 40, color: "rgba(200,150,62,.3)" }}><div style={{ fontSize: 36, marginBottom: 12 }}>📭</div>No donations yet</div> :
              [...donations].reverse().slice(0, 50).map((d, i) => {
                const dt = new Date(d.date); const ch = CHARITIES.find(c => c.id === d.charityId);
                return <div key={i} style={{ display: "flex", alignItems: "center", padding: "14px 16px", background: "rgba(200,150,62,.03)", borderRadius: 10, border: "1px solid rgba(200,150,62,.08)", marginBottom: 6, position: "relative", overflow: "hidden" }}>
                  <div style={{ width: 4, height: "100%", borderRadius: 2, background: ch?.color || "#C8963E", position: "absolute", left: 0, top: 0 }} />
                  <div style={{ flex: 1, paddingLeft: 12 }}><div style={{ fontWeight: 600, fontSize: 14 }}>{d.charity}</div><div style={{ fontSize: 11, color: "rgba(200,150,62,.35)", marginTop: 2 }}>{dt.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}</div></div>
                  <div style={{ fontFamily: "'Cormorant Garamond',Georgia,serif", fontSize: 20, fontWeight: 700, color: "#E8C068" }}>${d.amount}</div>
                </div>;
              })}
          </div>
        )}

        {/* ═══ PROGRESS ═══ */}
        {screen === "progress" && (
          <div style={{ animation: "fadeIn .4s ease" }}>
            <div style={{ fontFamily: "'Cormorant Garamond',Georgia,serif", fontSize: 24, fontWeight: 700, marginBottom: 16 }}>{thisYear} Progress</div>
            <div style={{ textAlign: "center", padding: "24px 0" }}>
              <div style={{ fontFamily: "'Cormorant Garamond',Georgia,serif", fontSize: 52, fontWeight: 700, color: "#E8C068", lineHeight: 1 }}>${yearTotal}</div>
              <div style={{ fontSize: 13, color: "rgba(200,150,62,.4)", marginTop: 6 }}>given across {yearDonations.length} donations</div>
              {totalAllTime !== yearTotal && <div style={{ fontSize: 12, color: "rgba(200,150,62,.25)", marginTop: 4 }}>${totalAllTime} all time</div>}
            </div>
            <div style={{ display: "flex", alignItems: "flex-end", gap: 4, height: 100, padding: "0 4px", marginTop: 16 }}>
              {monthlyData.map((m, i) => { const mx = Math.max(...monthlyData.map(x => x.tot), 1); const h = m.tot > 0 ? Math.max((m.tot / mx) * 80, 4) : 2; const cur = i === today.getMonth(); return <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}><div style={{ fontSize: 9, color: "rgba(200,150,62,.35)" }}>{m.tot > 0 ? `$${m.tot}` : ""}</div><div style={{ width: "100%", height: h, background: m.tot > 0 ? (cur ? "linear-gradient(180deg,#E8C068,#C8963E)" : "rgba(200,150,62,.15)") : "rgba(200,150,62,.05)", borderRadius: 3, transition: "height .5s ease" }} /><div style={{ fontSize: 9, color: cur ? "#E8C068" : "rgba(200,150,62,.25)", fontWeight: cur ? 600 : 400 }}>{m.mo}</div></div>; })}
            </div>
            {Object.keys(charityBreakdown).length > 0 && <div style={{ marginTop: 28 }}><div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 1.2, color: "rgba(200,150,62,.3)", fontWeight: 600, marginBottom: 12 }}>By Charity</div>{Object.entries(charityBreakdown).sort((a, b) => b[1] - a[1]).map(([n, t], i) => { const pct = yearTotal > 0 ? (t / yearTotal) * 100 : 0; return <div key={i} style={{ marginBottom: 12 }}><div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}><span style={{ fontSize: 13 }}>{n}</span><span style={{ fontSize: 13, fontWeight: 600, color: "#E8C068" }}>${t}</span></div><div style={{ height: 6, background: "rgba(200,150,62,.06)", borderRadius: 3, overflow: "hidden" }}><div style={{ height: "100%", width: `${pct}%`, background: "#C8963E", borderRadius: 3, transition: "width .8s ease" }} /></div></div>; })}</div>}
            <div style={{ background: "rgba(200,150,62,.04)", borderRadius: 12, padding: "16px 18px", border: "1px solid rgba(200,150,62,.1)", borderLeft: "3px solid #C8963E", marginTop: 24, textAlign: "center" }}>
              <div style={{ fontFamily: "'Cormorant Garamond',Georgia,serif", fontSize: 36, fontWeight: 700, color: "#E8C068" }}>{streak}</div>
              <div style={{ fontSize: 13, color: "rgba(200,150,62,.4)" }}>day giving streak</div>
            </div>
          </div>
        )}

        {/* ═══ SETTINGS ═══ */}
        {screen === "settings" && (
          <div style={{ animation: "fadeIn .4s ease" }}>
            <div style={{ fontFamily: "'Cormorant Garamond',Georgia,serif", fontSize: 24, fontWeight: 700, marginBottom: 16 }}>Settings</div>
            <div style={S.setGroup}>
              <div style={S.setLabel}>Your Name</div>
              {editName ? <div style={{ display: "flex", gap: 8 }}><input value={profile.name} onChange={e => saveProfile({ ...profile, name: e.target.value })} style={S.onInput} autoFocus /><button onClick={() => setEditName(false)} style={{ ...S.goldBtn, fontSize: 12, padding: "8px 16px" }}>Save</button></div>
                : <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}><span style={{ fontSize: 15 }}>{profile.name}</span><button onClick={() => setEditName(true)} style={S.linkBtn}>Edit</button></div>}
            </div>
            <div style={S.setGroup}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}><div style={S.setLabel}>Yahrzeits</div><button onClick={() => setAddYahrzeit(true)} style={S.linkBtn}>+ Add</button></div>
              {profile.yahrzeits?.length > 0 ? profile.yahrzeits.map((y, i) => <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid rgba(200,150,62,.06)" }}><div><div style={{ fontSize: 14 }}>{y.name}</div><div style={{ fontSize: 11, color: "rgba(200,150,62,.35)" }}>{y.monthName || ""} {y.day}</div></div><button onClick={() => saveProfile({ ...profile, yahrzeits: profile.yahrzeits.filter((_, j) => j !== i) })} style={{ ...S.linkBtn, color: "#D4483B" }}>Remove</button></div>) : <div style={{ fontSize: 13, color: "rgba(200,150,62,.25)", marginTop: 8 }}>None added yet</div>}
              {addYahrzeit && <div style={{ marginTop: 12, padding: 14, background: "rgba(200,150,62,.04)", borderRadius: 10, border: "1px solid rgba(200,150,62,.08)" }}>
                <input value={yForm.name} onChange={e => setYForm(f => ({ ...f, name: e.target.value }))} placeholder="Name" style={{ ...S.onInput, marginBottom: 8 }} />
                <div style={{ display: "flex", gap: 8 }}>
                  <input value={yForm.month} onChange={e => setYForm(f => ({ ...f, month: e.target.value }))} placeholder="Hebrew month" style={{ ...S.onInput, flex: 1 }} />
                  <input type="number" min={1} max={30} value={yForm.day} onChange={e => setYForm(f => ({ ...f, day: e.target.value }))} placeholder="Day" style={{ ...S.onInput, width: 70 }} />
                </div>
                <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                  <button onClick={() => { if (yForm.name && yForm.day) { saveProfile({ ...profile, yahrzeits: [...(profile.yahrzeits || []), { name: yForm.name, monthName: yForm.month, day: parseInt(yForm.day) }] }); setYForm({ name: "", month: "", day: "" }); setAddYahrzeit(false); } }} style={{ ...S.goldBtn, fontSize: 12, padding: "8px 16px" }}>Save</button>
                  <button onClick={() => { setAddYahrzeit(false); setYForm({ name: "", month: "", day: "" }); }} style={{ ...S.subtleBtn, fontSize: 12, padding: "8px 16px" }}>Cancel</button>
                </div>
              </div>}
            </div>
            <div style={S.setGroup}>
              <div style={S.setLabel}>Notifications</div>
              <button onClick={async () => {
                  const token = await getFCMToken();
                  if (token) {
                    await setDoc(doc(db, "users", user.uid), { profile: { fcmToken: token } }, { merge: true });
                    alert("Notifications enabled! You'll get a daily morning reminder.");
                  } else {
                    alert("Notifications blocked. Please enable them in your browser settings.");
                  }
                }}
                style={{ ...S.subtleBtn, fontSize: 13, padding: "10px 16px", width: "100%" }}>
                {typeof Notification !== "undefined" && Notification.permission === "granted" ? "✓ Notifications enabled" : "Enable daily reminders"}
              </button>
            </div>
            <div style={{ marginTop: 24, textAlign: "center" }}>
              <button onClick={() => signOut(auth)} style={{ ...S.linkBtn, color: "rgba(200,150,62,.3)", fontSize: 12 }}>Sign out</button>
            </div>
          </div>
        )}
      </div>

      {/* Charity picker modal */}
      {showCharityPicker && <CharityPicker current={profile.selectedCharity} onSelect={id => saveProfile({ ...profile, selectedCharity: id })} onClose={() => setShowCharityPicker(false)} />}

      {/* Confirm modal */}
      {showConfirm && (
        <div style={S.overlay}>
          <div style={S.modal}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>🪙</div>
            <div style={{ fontFamily: "'Cormorant Garamond',Georgia,serif", fontSize: 22, fontWeight: 700, color: "#E8D5AA" }}>Did you complete your donation?</div>
            <div style={{ fontSize: 13, color: "rgba(200,150,62,.5)", marginTop: 8 }}>${pending?.amount} to {pending?.charity}</div>
            <div style={{ fontFamily: "'Cormorant Garamond',Georgia,serif", fontSize: 13, fontStyle: "italic", color: "rgba(200,150,62,.25)", marginTop: 12, lineHeight: 1.5 }}>
              "{quote.text}"<br /><span style={{ fontSize: 10 }}>— {quote.source}</span>
            </div>
            <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
              <button onClick={confirmDonation} style={{ ...S.goldBtn, flex: 1 }}>Yes, I donated ✓</button>
              <button onClick={() => { setShowConfirm(false); setPending(null); }} style={{ ...S.subtleBtn, flex: 1 }}>Not yet</button>
            </div>
          </div>
        </div>
      )}

      {/* Footer */}
      <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, maxWidth: 420, margin: "0 auto", padding: "10px 20px", background: "rgba(10,22,40,.95)", backdropFilter: "blur(8px)", borderTop: "1px solid rgba(200,150,62,.08)", display: "flex", justifyContent: "center", gap: 8, fontSize: 11, zIndex: 2 }}>
        <span style={{ fontFamily: "'Cormorant Garamond',Georgia,serif", fontStyle: "italic", color: "rgba(200,150,62,.25)" }}>{hebrewDate.display}</span>
        <span style={{ color: "rgba(200,150,62,.15)" }}>·</span>
        <span style={{ color: "rgba(200,150,62,.2)" }}>Tamid v0.3</span>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════
//  STYLES
// ═══════════════════════════════════════════════
function Styles() {
  return <style>{`
    @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,600;0,700;1,400&family=DM+Sans:wght@400;500;600&display=swap');
    *{box-sizing:border-box;margin:0;padding:0}body{background:#0A1628}
    @keyframes pulse{0%,100%{transform:scale(1);opacity:.8}50%{transform:scale(1.15);opacity:1}}
    @keyframes coinDrop{0%{transform:translateY(-60px) scale(.5);opacity:0}50%{transform:translateY(5px) scale(1.1);opacity:1}70%{transform:translateY(-8px) scale(1)}100%{transform:translateY(0) scale(1);opacity:1}}
    @keyframes fadeIn{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}
    @keyframes vineSwayLeft{0%,100%{transform:translateX(0) rotate(0deg)}50%{transform:translateX(3px) rotate(.3deg)}}
    @keyframes vineSwayRight{0%,100%{transform:translateX(0) rotate(0deg)}50%{transform:translateX(-3px) rotate(-.3deg)}}
    @keyframes leafPulse{0%,100%{opacity:.4;transform:scale(1)}50%{opacity:.7;transform:scale(1.05)}}
    @keyframes dotPulse{0%,100%{opacity:.1}50%{opacity:.25}}
    ::selection{background:rgba(200,150,62,.25)}
    input:focus,select:focus{border-color:#C8963E!important;outline:none;box-shadow:0 0 0 3px rgba(200,150,62,.1)!important}
  `}</style>;
}

const S = {
  onLabel: { fontSize: 11, textTransform: "uppercase", letterSpacing: 1.2, color: "rgba(200,150,62,.4)", fontWeight: 600, marginBottom: 6, display: "block" },
  onInput: { width: "100%", padding: "12px 14px", borderRadius: 10, border: "1.5px solid rgba(200,150,62,.15)", background: "rgba(200,150,62,.04)", fontFamily: "'DM Sans',sans-serif", fontSize: 14, color: "#E8D5AA", outline: "none" },
  goldBtn: { padding: "14px 24px", borderRadius: 12, background: "linear-gradient(145deg,#C8963E,#A67A2E)", border: "none", color: "#0A1628", fontFamily: "'DM Sans',sans-serif", fontWeight: 600, fontSize: 15, cursor: "pointer", boxShadow: "0 4px 16px rgba(200,150,62,.25)", transition: "all .2s" },
  subtleBtn: { padding: "14px 24px", borderRadius: 12, background: "rgba(200,150,62,.06)", border: "1px solid rgba(200,150,62,.12)", color: "rgba(200,150,62,.5)", fontFamily: "'DM Sans',sans-serif", fontWeight: 500, fontSize: 15, cursor: "pointer", transition: "all .2s" },
  linkBtn: { background: "none", border: "none", color: "#C8963E", cursor: "pointer", fontFamily: "'DM Sans',sans-serif", fontWeight: 600, fontSize: 13 },
  setGroup: { padding: "16px 0", borderBottom: "1px solid rgba(200,150,62,.08)" },
  setLabel: { fontSize: 11, textTransform: "uppercase", letterSpacing: 1.2, color: "rgba(200,150,62,.3)", fontWeight: 600, marginBottom: 8 },
  overlay: { position: "fixed", inset: 0, background: "rgba(10,22,40,.7)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, backdropFilter: "blur(6px)" },
  modal: { background: "linear-gradient(180deg,#0F1F3A,#0A1628)", borderRadius: 20, padding: "32px 28px", maxWidth: 340, width: "90%", textAlign: "center", border: "1px solid rgba(200,150,62,.2)", boxShadow: "0 20px 60px rgba(0,0,0,.4)" },
};
