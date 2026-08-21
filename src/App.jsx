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
  { id: "ltl", name: "Larger Than Life", category: "Children & Health", desc: "Helping Israeli children with cancer and their families — dream trips, summer camps, and pediatric oncology support", venmo: "Ltlusa5415", website: "https://largerthanlifeusa.org", color: "#4E9A6B", region: "US / Israel" },
  { id: "cwv", name: "Chabad of the West Village", category: "Community & Youth", desc: "Downtown Manhattan Chabad — Shabbat meals, learning, and a Jewish home in the West Village", venmo: "ChabadWV", venmoCharity: true, website: null, color: "#F2A9BE", region: "NYC" },
  { id: "inperson", name: "In-Person Tzedakah", category: "Given by hand", desc: "Cash in a pushka, a coin to someone who asked, a shul tzedakah box — record a gift you gave physically", inPerson: true, website: null, color: "#7A5CFF", region: "Anywhere" },
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
//  ARCADE PALETTE + PRIMITIVES
// ═══════════════════════════════════════════════
const INK = "#111", BG = "#f4ede0", PAPER = "#fff", YEL = "#ffd23f", RED = "#ff5c39", BLU = "#2563ff";
const cById = id => CHARITIES.find(c => c.id === id) || CHARITIES[0];
const pad5 = n => "$" + String(Math.max(0, Math.ceil(n))).padStart(5, "0");

// Background — cream with a faint dot grid
function ArcadeBg() {
  return <div style={{ position: "fixed", inset: 0, zIndex: 0, background: BG, backgroundImage: "radial-gradient(#d9cdb4 1px, transparent 1px)", backgroundSize: "18px 18px", pointerEvents: "none" }} />;
}

// Pixel coin — matches the app icon (see scripts/generate-icons.cjs)
const COIN_N = 21;
const COIN_COLORS = { K: "#111", D: "#6e4e0f", G: "#ffcc2a", L: "#ffe98a", S: "#d99a1f" };
const COIN_MAP = (() => {
  const c = (COIN_N - 1) / 2, R = COIN_N / 2 - 0.6, rIn = R * 0.62, grid = [];
  for (let y = 0; y < COIN_N; y++) {
    let row = "";
    for (let x = 0; x < COIN_N; x++) {
      const dx = x - c, dy = y - c, d = Math.hypot(dx, dy);
      if (d > R) { row += "."; continue; }
      if (R - d < 1.0) { row += "K"; continue; }
      if (Math.abs(d - rIn) < 0.55) { row += "D"; continue; }
      if (R - d < 2.1) { if (dx < 0 && dy < 0) { row += "L"; continue; } if (dx > 0 && dy > 0) { row += "S"; continue; } }
      row += "G";
    }
    grid.push(row);
  }
  const g = Math.round(c - R * 0.42);
  const set = (x, y) => { const r = grid[y].split(""); if (r[x] !== "." && r[x] !== "K") { r[x] = "L"; grid[y] = r.join(""); } };
  set(g, g); set(g + 1, g); set(g, g + 1);
  return grid;
})();
function PixelCoin({ pixel = 2 }) {
  const size = COIN_N * pixel, rects = [];
  for (let y = 0; y < COIN_N; y++) for (let x = 0; x < COIN_N; x++) {
    const ch = COIN_MAP[y][x]; if (ch === ".") continue;
    rects.push(<rect key={y * COIN_N + x} x={x * pixel} y={y * pixel} width={pixel} height={pixel} fill={COIN_COLORS[ch]} />);
  }
  return <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} shapeRendering="crispEdges" style={{ display: "inline-block" }}>{rects}</svg>;
}

// Bottom sheet used by all three home interactions
function Sheet({ title, onClose, children }) {
  return (
    <div style={S.sheetOverlay} onClick={onClose}>
      <div style={S.sheet} onClick={e => e.stopPropagation()}>
        <div style={S.sheetHead}>
          <span style={{ ...S.pix, fontSize: 11 }}>{title}</span>
          <button onClick={onClose} style={S.escBtn}>✕ ESC</button>
        </div>
        {children}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════
//  NAV ICONS
// ═══════════════════════════════════════════════
const IconDollarBag = ({ color }) => <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 3h6l2 4H7l2-4z" /><path d="M7 7c0 0-2 1-2 5s1 6 2 7c1.5 1.5 4 2 5 2s3.5-.5 5-2c1-1 2-3 2-7s-2-5-2-5" /><path d="M12 11v5" /><path d="M10 13h4" /></svg>;
const IconClock = ({ color }) => <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 3" /></svg>;
const IconChart = ({ color }) => <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 20l4-6 4 3 4-7 6-4" /><path d="M17 6h4v4" /></svg>;
const IconGear = ({ color }) => <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" /></svg>;

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
  const [sheet, setSheet] = useState(null); // 'streak' | 'charity' | 'amount' | null
  const [pending, setPending] = useState(null);
  const [animateCoin, setAnimateCoin] = useState(false);
  const [btnPressed, setBtnPressed] = useState(false);
  const [customAmt, setCustomAmt] = useState("");
  const [showCustom, setShowCustom] = useState(false);
  const [editName, setEditName] = useState(false);
  const [addYahrzeit, setAddYahrzeit] = useState(false);
  const [yForm, setYForm] = useState({ name: "", month: "", day: "" });
  const [onboardData, setOnboardData] = useState({ name: "", charity: "colel" });
  const [pastForm, setPastForm] = useState(null); // { date, charityId, amount }

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
    if (new Date(don.date).toDateString() === new Date().toDateString()) setDonatedToday(true);
    if (user) {
      try { await updateDoc(doc(db, "users", user.uid), { donations: arrayUnion(don) }); }
      catch (e) {
        console.error("Failed to save donation:", e);
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
  const sortedDonations = [...donations].sort((a, b) => new Date(b.date) - new Date(a.date));
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
  const charityById = yearDonations.reduce((a, d) => { const id = d.charityId || "colel"; a[id] = (a[id] || 0) + d.amount; return a; }, {});
  const monthlyData = Array.from({ length: 12 }, (_, i) => { const m = yearDonations.filter(d => new Date(d.date).getMonth() === i); return { mo: ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"][i], full: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][i], tot: m.reduce((s, d) => s + d.amount, 0) }; });
  const curAmt = showCustom && customAmt ? parseFloat(customAmt) : (profile?.amount || 1);

  const handleDonate = () => {
    if (!curAmt || curAmt <= 0) return;
    if (!charity.inPerson) {
      const note = profile?.name ? `Daily Tzedakah ${profile.name}: Tamid app` : "Daily Tzedakah: Tamid app";
      const url = charity.venmoCharity
        ? `https://venmo.com/${charity.venmo}` // verified charity profiles reject txn=pay; use their Donate flow
        : charity.venmo
        ? `https://venmo.com/${charity.venmo}?txn=pay&amount=${curAmt}&note=${encodeURIComponent(note)}`
        : charity.stripe
        ? `${charity.stripe}?prefilled_amount=${Math.round(curAmt * 100)}`
        : charity.website;
      if (url) window.open(url, "_blank");
    }
    setPending({ charity: charity.name, charityId: charity.id, amount: curAmt, date: new Date().toISOString() });
    setShowConfirm(true);
  };

  // ─── Log a gift given outside the app (in person, cheque, or a day you forgot) ───
  const todayISO = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
  const openPastForm = () => { setPastForm({ date: todayISO(), charityId: charity.id, amount: String(profile?.amount || 1) }); setSheet("past"); };
  const savePastGift = async () => {
    const amt = parseFloat(pastForm.amount);
    if (!amt || amt <= 0 || !pastForm.date) return;
    const [y, m, dd] = pastForm.date.split("-").map(Number);
    const when = new Date(y, m - 1, dd, 12, 0, 0); // noon local, so re-parsing never shifts the day
    const c = cById(pastForm.charityId);
    await addDonation({ charity: c.name, charityId: c.id, amount: amt, date: when.toISOString(), loggedLate: true });
    setSheet(null); setPastForm(null);
  };

  const confirmDonation = async () => {
    if (pending) {
      await addDonation(pending);
      setShowConfirm(false); setPending(null);
      setAnimateCoin(true); setTimeout(() => setAnimateCoin(false), 1200);
    }
  };

  const TABS = [
    { id: "home", label: "PLAY", Icon: IconDollarBag },
    { id: "history", label: "LOG", Icon: IconClock },
    { id: "progress", label: "STATS", Icon: IconChart },
    { id: "settings", label: "SETUP", Icon: IconGear },
  ];

  // ═══ LOADING ═══
  if (authLoading) return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 20, position: "relative" }}>
      <Styles /><ArcadeBg />
      <div style={{ zIndex: 1, ...S.pix, fontSize: 14, color: INK, animation: "blink 1s steps(2) infinite" }}>LOADING…</div>
      <div style={{ zIndex: 1, maxWidth: 280, textAlign: "center", fontSize: 14, color: "#5c5443", lineHeight: 1.6, fontStyle: "italic" }}>
        "{quote.text}"<div style={{ ...S.pix, fontSize: 7, marginTop: 8, fontStyle: "normal", color: "#8a8061" }}>— {quote.source.toUpperCase()}</div>
      </div>
    </div>
  );

  // ═══ SIGN IN ═══
  if (!user) return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", position: "relative" }}>
      <Styles /><ArcadeBg />
      <div style={{ zIndex: 1, textAlign: "center", padding: "40px 30px", maxWidth: 360 }}>
        <div style={{ ...S.pix, fontSize: 9, color: RED, marginBottom: 10 }}>★ DAILY TZEDAKAH ★</div>
        <div style={{ ...S.box, background: INK, padding: "18px 22px", display: "inline-block", boxShadow: `6px 6px 0 ${RED}` }}>
          <h1 style={{ ...S.pix, fontSize: 30, color: YEL, margin: 0, letterSpacing: 1 }}>TAMID</h1>
        </div>
        <div style={{ fontSize: 15, color: "#5c5443", lineHeight: 1.6, maxWidth: 280, margin: "26px auto 28px", fontStyle: "italic" }}>
          "{quote.text}"<div style={{ ...S.pix, fontSize: 7, marginTop: 8, fontStyle: "normal", color: "#8a8061" }}>— {quote.source.toUpperCase()}</div>
        </div>
        <div style={{ ...S.pix, fontSize: 8, color: INK, marginBottom: 12, animation: "blink 1s steps(2) infinite" }}>▸ INSERT COIN TO START ◂</div>
        <button onClick={signInWithGoogle} style={{ ...S.brutalBtn, background: INK, color: YEL, display: "flex", alignItems: "center", gap: 10, margin: "0 auto" }}>
          <svg width="18" height="18" viewBox="0 0 24 24"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" /><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" /><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18A10.96 10.96 0 001 12c0 1.77.42 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05" /><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" /></svg>
          SIGN IN WITH GOOGLE
        </button>
      </div>
    </div>
  );

  // ═══ ONBOARDING ═══
  if (!profile) return (
    <div style={{ minHeight: "100vh", position: "relative" }}>
      <Styles /><ArcadeBg />
      <div style={{ position: "relative", zIndex: 1, padding: "80px 24px 40px", maxWidth: 380, margin: "0 auto", textAlign: "center", animation: "fadeIn .5s ease" }}>
        <div style={{ ...S.pix, fontSize: 12, color: INK, marginBottom: 6 }}>NEW PLAYER</div>
        <p style={{ fontSize: 14, color: "#5c5443", marginBottom: 28 }}>Let's set up your daily giving</p>
        <div style={{ textAlign: "left", marginBottom: 16 }}>
          <label style={S.pixLabel}>▸ ENTER PLAYER NAME</label>
          <input value={onboardData.name} onChange={e => setOnboardData(d => ({ ...d, name: e.target.value }))} placeholder="Your name" style={S.input} autoFocus />
        </div>
        <button onClick={() => { if (onboardData.name) completeOnboarding(); }} disabled={!onboardData.name}
          style={{ ...S.brutalBtn, background: INK, color: YEL, width: "100%", opacity: onboardData.name ? 1 : .4 }}>START GAME ▸</button>
      </div>
    </div>
  );

  // ═══ MAIN APP ═══
  return (
    <div style={{ maxWidth: 480, margin: "0 auto", minHeight: "100dvh", display: "flex", flexDirection: "column", position: "relative", fontFamily: "'Space Grotesk',sans-serif", color: INK, paddingBottom: "calc(86px + env(safe-area-inset-bottom))" }}>
      <Styles /><ArcadeBg />

      {/* Header */}
      <div style={{ position: "relative", zIndex: 1, padding: "16px 16px 0", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ ...S.pix, fontSize: 13, letterSpacing: 1 }}>✦ TAMID</div>
        <div style={{ ...S.pix, fontSize: 7, color: "#8a8061" }}>P1 · {(profile.name || "").toUpperCase()}</div>
      </div>

      {/* Score HUD */}
      <div style={{ position: "relative", zIndex: 1, margin: "10px 16px 0", ...S.scorebar }}>
        <span>SCORE {pad5(totalAllTime)}</span>
        <span style={{ color: RED }}>LVL {streak}</span>
      </div>

      {/* Holiday banner */}
      {todayHoliday && (
        <div style={{ position: "relative", zIndex: 1, margin: "12px 16px 0", ...S.box, background: YEL, padding: "10px 12px", boxShadow: `4px 4px 0 ${INK}`, display: "flex", alignItems: "center", gap: 10, animation: "fadeIn .5s ease" }}>
          <span style={{ fontSize: 20 }}>{getHolidayEmoji(todayHoliday.name)}</span>
          <div>
            <div style={{ fontWeight: 700, fontSize: 13, textTransform: "uppercase" }}>{todayHoliday.name}</div>
            <div style={{ ...S.pix, fontSize: 7, marginTop: 4, lineHeight: 1.4 }}>{getHolidayNudge(todayHoliday.name).toUpperCase()}</div>
          </div>
        </div>
      )}

      <div style={{ position: "relative", zIndex: 1, padding: "14px 16px 20px", flex: 1, display: "flex", flexDirection: "column" }}>

        {/* ═══ PLAY / DONATE ═══ */}
        {screen === "home" && (
          <div style={{ animation: "fadeIn .35s ease", flex: 1, display: "flex", flexDirection: "column" }}>

            {/* Top group: streak + quest */}
            <div>
              {/* STREAK combo → stats sheet */}
              <div onClick={() => setSheet("streak")} style={{ ...S.box, ...S.clickable, background: PAPER, padding: 12, boxShadow: `4px 4px 0 ${BLU}`, display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                <div>
                  <div style={{ ...S.pix, fontSize: 9, color: BLU, marginBottom: 6 }}>★ STREAK</div>
                  <div style={{ ...S.pix, fontSize: 22, color: INK }}>x{streak}</div>
                  <div style={{ ...S.pix, fontSize: 7, color: "#888", marginTop: 6 }}>▸ TAP FOR STATS</div>
                </div>
                <span style={{ fontSize: 34, display: "inline-block", animation: "flame 1.6s ease-in-out infinite" }}>🔥</span>
              </div>

              {/* TODAY'S QUEST → charity sheet */}
              <div onClick={() => setSheet("charity")} style={{ ...S.box, ...S.clickable, background: PAPER, padding: 12, boxShadow: `4px 4px 0 ${INK}` }}>
                <div style={{ ...S.pix, fontSize: 8, color: RED, marginBottom: 6 }}>▶ TODAY'S QUEST</div>
                <div style={{ fontSize: 17, fontWeight: 700, display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ width: 14, height: 14, border: `2px solid ${INK}`, background: charity.color, display: "inline-block" }} />
                  {charity.name}
                </div>
                <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", margin: "8px 0", padding: "0 2px" }}>
                  <div>
                    <div style={{ ...S.pix, fontSize: 7, color: "#888", marginBottom: 4 }}>TODAY'S GIFT</div>
                    <div style={{ fontSize: 48, fontWeight: 800, lineHeight: 1, letterSpacing: "-.03em" }}>${curAmt}</div>
                  </div>
                  <div style={{ ...S.pix, fontSize: 7, lineHeight: 1.9, textAlign: "right" }}>
                    <span style={{ color: "#888" }}>{thisYear} TOTAL</span><br />
                    <span style={{ color: BLU, fontSize: 9 }}>${Math.round(yearTotal)}</span> · {yearDonations.length} GIFTS
                  </div>
                </div>
                <div style={{ ...S.pix, fontSize: 7, color: "#888" }}>▸ TAP TO SWITCH CHARITY</div>
              </div>
            </div>

            {/* Bottom group: INSERT COIN / done state — centered in leftover space */}
            <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", gap: 16, marginTop: 20 }}>
              {animateCoin && <div style={{ textAlign: "center", animation: "coinDrop 1s ease forwards" }}><PixelCoin pixel={2} /></div>}
              {donatedToday ? (
                <div style={{ ...S.box, background: INK, color: YEL, padding: "28px 20px", textAlign: "center", boxShadow: `6px 6px 0 ${BLU}` }}>
                  <div style={{ marginBottom: 10 }}><PixelCoin pixel={3} /></div>
                  <div style={{ ...S.pix, fontSize: 14, color: "#7CFFB0", marginBottom: 10 }}>✓ QUEST CLEARED</div>
                  <div style={{ fontSize: 14, opacity: .85 }}>Today's tzedakah is done.</div>
                  <button onClick={() => setSheet("amount")} style={{ ...S.brutalBtn, background: YEL, color: INK, marginTop: 18, fontSize: 11, boxShadow: `4px 4px 0 ${RED}` }}>▸ PLAY AGAIN</button>
                </div>
              ) : (
                <button
                  onPointerDown={() => setBtnPressed(true)}
                  onPointerUp={() => { setBtnPressed(false); setSheet("amount"); }}
                  onPointerLeave={() => setBtnPressed(false)}
                  style={{
                    width: "100%", background: INK, color: YEL, border: `3px solid ${INK}`, padding: "26px 18px", cursor: "pointer", textAlign: "center",
                    boxShadow: btnPressed ? `1px 1px 0 ${RED}` : `6px 6px 0 ${RED}`,
                    transform: btnPressed ? "translate(5px,5px)" : "translate(0,0)",
                    transition: "all .08s",
                  }}>
                  <div style={{ ...S.pix, fontSize: 11, marginBottom: 10, animation: "blink 1s steps(2) infinite" }}>▸ INSERT COIN ◂</div>
                  <div style={{ fontSize: 20, fontWeight: 800, textTransform: "uppercase", letterSpacing: ".05em" }}>{charity.inPerson ? "Log It" : "Give Now"}</div>
                </button>
              )}
              <div style={{ ...S.pix, fontSize: 7, textAlign: "center", color: "#8a8061" }}>© 5786 · {hebrewDate.display.toUpperCase()}</div>
            </div>
          </div>
        )}

        {/* ═══ LOG / HISTORY ═══ */}
        {screen === "history" && (
          <div style={{ animation: "fadeIn .35s ease" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <div style={{ ...S.pix, fontSize: 12 }}>▸ PLAY LOG</div>
              <button onClick={openPastForm} style={{ ...S.brutalBtn, background: YEL, color: INK, fontSize: 8, padding: "9px 11px", boxShadow: `3px 3px 0 ${INK}` }}>+ LOG PAST</button>
            </div>
            {donations.length === 0 ? (
              <div style={{ ...S.box, background: PAPER, padding: 30, textAlign: "center", boxShadow: `4px 4px 0 ${INK}` }}>
                <div style={{ fontSize: 30, marginBottom: 10 }}>📭</div>
                <div style={{ ...S.pix, fontSize: 8, color: "#888" }}>NO PLAYS YET</div>
              </div>
            ) : (
              <div style={{ ...S.box, background: PAPER, boxShadow: `4px 4px 0 ${INK}` }}>
                {sortedDonations.slice(0, 50).map((d, i, arr) => {
                  const dt = new Date(d.date); const ch = cById(d.charityId);
                  return (
                    <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderBottom: i < arr.length - 1 ? "2px solid #ece3d0" : "none" }}>
                      <div style={{ width: 14, height: 14, border: `2px solid ${INK}`, background: ch.color, flexShrink: 0 }} />
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 13, fontWeight: 700 }}>{d.charity}</div>
                        <div style={{ fontSize: 11, color: "#888" }}>{dt.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}</div>
                      </div>
                      <div style={{ ...S.pix, fontSize: 9 }}>${d.amount}</div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ═══ STATS / PROGRESS ═══ */}
        {screen === "progress" && (
          <div style={{ animation: "fadeIn .35s ease" }}>
            <div style={{ ...S.pix, fontSize: 12, marginBottom: 14 }}>▸ {thisYear} STATS</div>
            <div style={{ ...S.box, background: INK, color: YEL, padding: 16, textAlign: "center", boxShadow: `5px 5px 0 ${RED}`, marginBottom: 14 }}>
              <div style={{ ...S.pix, fontSize: 8, color: "#8a8061", marginBottom: 8 }}>HIGH SCORE</div>
              <div style={{ ...S.pix, fontSize: 26 }}>{pad5(totalAllTime)}</div>
              <div style={{ fontSize: 12, marginTop: 8, opacity: .8 }}>${yearTotal} this year · {yearDonations.length} gifts</div>
            </div>
            <MonthBars data={monthlyData} curMonth={today.getMonth()} />
            <CharityBreakdown byId={charityById} total={yearTotal} />
          </div>
        )}

        {/* ═══ SETUP / SETTINGS ═══ */}
        {screen === "settings" && (
          <div style={{ animation: "fadeIn .35s ease" }}>
            <div style={{ ...S.pix, fontSize: 12, marginBottom: 14 }}>▸ SETUP</div>

            <div style={{ ...S.box, background: PAPER, padding: 14, boxShadow: `4px 4px 0 ${INK}`, marginBottom: 12 }}>
              <div style={S.pixLabel}>PLAYER NAME</div>
              {editName ? (
                <div style={{ display: "flex", gap: 8 }}>
                  <input value={profile.name} onChange={e => saveProfile({ ...profile, name: e.target.value })} style={S.input} autoFocus />
                  <button onClick={() => setEditName(false)} style={{ ...S.brutalBtn, background: INK, color: YEL, fontSize: 9, padding: "10px 14px" }}>SAVE</button>
                </div>
              ) : (
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontSize: 15, fontWeight: 600 }}>{profile.name}</span>
                  <button onClick={() => setEditName(true)} style={S.linkBtn}>EDIT</button>
                </div>
              )}
            </div>

            <div style={{ ...S.box, background: PAPER, padding: 14, boxShadow: `4px 4px 0 ${INK}`, marginBottom: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={S.pixLabel}>YAHRZEITS</div>
                <button onClick={() => setAddYahrzeit(true)} style={S.linkBtn}>+ ADD</button>
              </div>
              {profile.yahrzeits?.length > 0 ? profile.yahrzeits.map((y, i) => (
                <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderTop: "2px solid #ece3d0" }}>
                  <div><div style={{ fontSize: 14, fontWeight: 600 }}>{y.name}</div><div style={{ fontSize: 11, color: "#888" }}>{y.monthName || ""} {y.day}</div></div>
                  <button onClick={() => saveProfile({ ...profile, yahrzeits: profile.yahrzeits.filter((_, j) => j !== i) })} style={{ ...S.linkBtn, color: RED }}>REMOVE</button>
                </div>
              )) : <div style={{ fontSize: 13, color: "#888", marginTop: 8 }}>None added yet</div>}
              {addYahrzeit && (
                <div style={{ marginTop: 12, paddingTop: 12, borderTop: "2px solid #ece3d0" }}>
                  <input value={yForm.name} onChange={e => setYForm(f => ({ ...f, name: e.target.value }))} placeholder="Name" style={{ ...S.input, marginBottom: 8 }} />
                  <div style={{ display: "flex", gap: 8 }}>
                    <input value={yForm.month} onChange={e => setYForm(f => ({ ...f, month: e.target.value }))} placeholder="Hebrew month" style={{ ...S.input, flex: 1 }} />
                    <input type="number" min={1} max={30} value={yForm.day} onChange={e => setYForm(f => ({ ...f, day: e.target.value }))} placeholder="Day" style={{ ...S.input, width: 70 }} />
                  </div>
                  <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                    <button onClick={() => { if (yForm.name && yForm.day) { saveProfile({ ...profile, yahrzeits: [...(profile.yahrzeits || []), { name: yForm.name, monthName: yForm.month, day: parseInt(yForm.day) }] }); setYForm({ name: "", month: "", day: "" }); setAddYahrzeit(false); } }} style={{ ...S.brutalBtn, background: INK, color: YEL, fontSize: 9, padding: "10px 14px" }}>SAVE</button>
                    <button onClick={() => { setAddYahrzeit(false); setYForm({ name: "", month: "", day: "" }); }} style={{ ...S.brutalBtn, background: PAPER, color: INK, fontSize: 9, padding: "10px 14px" }}>CANCEL</button>
                  </div>
                </div>
              )}
            </div>

            <div style={{ ...S.box, background: PAPER, padding: 14, boxShadow: `4px 4px 0 ${INK}`, marginBottom: 12 }}>
              <div style={S.pixLabel}>NOTIFICATIONS</div>
              <button onClick={async () => {
                  const token = await getFCMToken();
                  if (token) { await setDoc(doc(db, "users", user.uid), { profile: { fcmToken: token } }, { merge: true }); alert("Notifications enabled! You'll get a daily morning reminder."); }
                  else { alert("Notifications blocked. Please enable them in your browser settings."); }
                }}
                style={{ ...S.brutalBtn, background: typeof Notification !== "undefined" && Notification.permission === "granted" ? "#7CFFB0" : YEL, color: INK, fontSize: 10, width: "100%", boxShadow: `4px 4px 0 ${INK}` }}>
                {typeof Notification !== "undefined" && Notification.permission === "granted" ? "✓ REMINDERS ON" : "ENABLE DAILY REMINDERS"}
              </button>
            </div>

            <div style={{ textAlign: "center", marginTop: 18 }}>
              <button onClick={() => signOut(auth)} style={{ ...S.linkBtn, color: "#8a8061" }}>SIGN OUT</button>
            </div>
          </div>
        )}
      </div>

      {/* ═══ SHEETS ═══ */}
      {sheet === "streak" && (
        <Sheet title="★ STREAK STATS" onClose={() => setSheet(null)}>
          <div style={S.sectionLabel}>▸ THIS YEAR BY MONTH</div>
          <MonthBars data={monthlyData} curMonth={today.getMonth()} />
          <div style={S.sectionLabel}>▸ WHERE IT WENT ({thisYear})</div>
          <CharityBreakdown byId={charityById} total={yearTotal} />
          <div style={S.sectionLabel}>▸ DAYS DONATED</div>
          {donations.length === 0
            ? <div style={{ ...S.box, background: PAPER, padding: 18, ...S.pix, fontSize: 8, color: "#888", textAlign: "center", boxShadow: `4px 4px 0 ${INK}` }}>NO PLAYS YET</div>
            : (
              <div style={{ ...S.box, background: PAPER, boxShadow: `4px 4px 0 ${INK}` }}>
                {sortedDonations.slice(0, 30).map((d, i, arr) => {
                  const ch = cById(d.charityId);
                  return (
                    <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 10px", borderBottom: i < arr.length - 1 ? "2px solid #ece3d0" : "none" }}>
                      <div style={{ width: 14, height: 14, border: `2px solid ${INK}`, background: ch.color, flexShrink: 0 }} />
                      <div style={{ flex: 1, fontSize: 12, fontWeight: 700 }}>{new Date(d.date).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}<div style={{ fontSize: 11, color: "#666", fontWeight: 400 }}>{ch.name}</div></div>
                      <div style={{ ...S.pix, fontSize: 9 }}>${d.amount}</div>
                    </div>
                  );
                })}
              </div>
            )}
        </Sheet>
      )}

      {sheet === "charity" && (
        <Sheet title="▶ CHOOSE QUEST" onClose={() => setSheet(null)}>
          {CHARITIES.map(c => {
            const sel = c.id === charity.id;
            return (
              <div key={c.id} onClick={() => { saveProfile({ ...profile, selectedCharity: c.id }); setTimeout(() => setSheet(null), 200); }}
                style={{ ...S.box, ...S.clickable, background: PAPER, padding: 12, marginBottom: 10, boxShadow: sel ? `4px 4px 0 ${RED}` : `4px 4px 0 ${INK}` }}>
                <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                  <span style={{ width: 16, height: 16, border: `2px solid ${INK}`, background: c.color }} />
                  <span style={{ flex: 1, fontSize: 15, fontWeight: 700 }}>{c.name}</span>
                  <span style={{ ...S.pix, fontSize: 9, color: sel ? BLU : "#bbb" }}>{sel ? "◉ ACTIVE" : "○"}</span>
                </div>
                <div style={{ fontSize: 11, color: "#666", marginTop: 6, lineHeight: 1.4 }}>{c.desc}</div>
                <div style={{ ...S.pix, fontSize: 7, color: "#999", marginTop: 6 }}>▸ {c.region.toUpperCase()} · {c.inPerson ? "BY HAND" : c.venmoCharity ? "VENMO DONATE" : c.venmo ? "VENMO" : c.stripe ? "STRIPE" : "WEB"}</div>
              </div>
            );
          })}
        </Sheet>
      )}

      {sheet === "amount" && (
        <Sheet title="⊕ INSERT COIN" onClose={() => setSheet(null)}>
          <div style={S.sectionLabel}>▸ PICK YOUR AMOUNT</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 8 }}>
            {PRESET_AMOUNTS.map(a => {
              const sel = !showCustom && (profile?.amount || 1) === a;
              return (
                <div key={a} onClick={() => { setShowCustom(false); setCustomAmt(""); saveProfile({ ...profile, amount: a }); }}
                  style={{ ...S.box, ...S.clickable, padding: "14px 0", textAlign: "center", fontWeight: 800, fontSize: 18, background: sel ? YEL : PAPER, boxShadow: sel ? `3px 3px 0 ${RED}` : `3px 3px 0 ${INK}` }}>
                  ${a}{a === 18 && <div style={{ ...S.pix, fontSize: 6, marginTop: 3 }}>CHAI</div>}{a === 36 && <div style={{ ...S.pix, fontSize: 6, marginTop: 3 }}>2X CHAI</div>}
                </div>
              );
            })}
            <div onClick={() => setShowCustom(true)} style={{ ...S.box, ...S.clickable, padding: "14px 0", textAlign: "center", ...S.pix, fontSize: 9, display: "flex", alignItems: "center", justifyContent: "center", background: showCustom ? YEL : PAPER, boxShadow: showCustom ? `3px 3px 0 ${RED}` : `3px 3px 0 ${INK}` }}>$ CUSTOM</div>
          </div>
          {showCustom && (
            <div style={{ marginTop: 10, ...S.box, background: PAPER, padding: 10, display: "flex", alignItems: "center", gap: 8, boxShadow: `3px 3px 0 ${INK}` }}>
              <span style={{ fontSize: 22, fontWeight: 800 }}>$</span>
              <input type="number" min="0.5" step="0.5" value={customAmt} onChange={e => setCustomAmt(e.target.value)} placeholder="enter amount" autoFocus style={{ flex: 1, border: "none", outline: "none", fontSize: 20, fontWeight: 800, fontFamily: "'Space Grotesk',sans-serif", background: "transparent", color: INK }} />
            </div>
          )}
          {charity.venmoCharity && (
            <div style={{ ...S.box, background: YEL, padding: "10px 12px", marginTop: 12, boxShadow: `3px 3px 0 ${INK}` }}>
              <div style={{ ...S.pix, fontSize: 7, lineHeight: 1.7 }}>! VENMO WON'T PREFILL FOR<br />THIS CHARITY — TAP DONATE<br />AND ENTER ${curAmt} YOURSELF</div>
            </div>
          )}
          <button onClick={() => { if (curAmt > 0) { setSheet(null); handleDonate(); } }}
            style={{ ...S.brutalBtn, width: "100%", background: INK, color: YEL, marginTop: 14, boxShadow: `5px 5px 0 ${RED}` }}>
            <div style={{ ...S.pix, fontSize: 8, marginBottom: 5 }}>▸ TODAY'S COIN ◂</div>
            <div style={{ fontSize: 16, fontWeight: 800 }}>{charity.inPerson ? `LOG $${curAmt} GIVEN` : `GIVE $${curAmt}`} →</div>
          </button>
        </Sheet>
      )}

      {sheet === "past" && pastForm && (
        <Sheet title="✎ LOG A PAST GIFT" onClose={() => { setSheet(null); setPastForm(null); }}>
          <div style={{ fontSize: 12, color: "#5c5443", lineHeight: 1.5 }}>Gave outside the app — in person, by cheque, or on a day you forgot to tap? Record it here so it counts.</div>
          <div style={S.sectionLabel}>▸ WHEN</div>
          <input type="date" max={todayISO()} value={pastForm.date} onChange={e => setPastForm(f => ({ ...f, date: e.target.value }))} style={S.input} />
          <div style={S.sectionLabel}>▸ WHO</div>
          <select value={pastForm.charityId} onChange={e => setPastForm(f => ({ ...f, charityId: e.target.value }))} style={{ ...S.input, cursor: "pointer" }}>
            {CHARITIES.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <div style={S.sectionLabel}>▸ HOW MUCH</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 8, marginBottom: 10 }}>
            {PRESET_AMOUNTS.map(a => {
              const sel = parseFloat(pastForm.amount) === a;
              return <div key={a} onClick={() => setPastForm(f => ({ ...f, amount: String(a) }))}
                style={{ ...S.box, ...S.clickable, padding: "12px 0", textAlign: "center", fontWeight: 800, fontSize: 15, background: sel ? YEL : PAPER, boxShadow: sel ? `3px 3px 0 ${RED}` : `3px 3px 0 ${INK}` }}>${a}</div>;
            })}
          </div>
          <div style={{ ...S.box, background: PAPER, padding: 10, display: "flex", alignItems: "center", gap: 8, boxShadow: `3px 3px 0 ${INK}` }}>
            <span style={{ fontSize: 22, fontWeight: 800 }}>$</span>
            <input type="number" min="0.5" step="0.5" value={pastForm.amount} onChange={e => setPastForm(f => ({ ...f, amount: e.target.value }))} placeholder="amount"
              style={{ flex: 1, border: "none", outline: "none", fontSize: 20, fontWeight: 800, fontFamily: "'Space Grotesk',sans-serif", background: "transparent", color: INK }} />
          </div>
          <button onClick={savePastGift} disabled={!(parseFloat(pastForm.amount) > 0)}
            style={{ ...S.brutalBtn, width: "100%", background: INK, color: YEL, marginTop: 14, boxShadow: `5px 5px 0 ${BLU}`, opacity: parseFloat(pastForm.amount) > 0 ? 1 : .4 }}>
            <div style={{ ...S.pix, fontSize: 8, marginBottom: 5 }}>▸ ADD TO LOG ◂</div>
            <div style={{ fontSize: 16, fontWeight: 800 }}>RECORD ${parseFloat(pastForm.amount) > 0 ? parseFloat(pastForm.amount) : 0} →</div>
          </button>
        </Sheet>
      )}

      {/* Confirm modal */}
      {showConfirm && (
        <div style={S.modalOverlay}>
          <div style={{ ...S.box, background: BG, padding: 22, maxWidth: 320, width: "90%", textAlign: "center", boxShadow: `6px 6px 0 ${INK}` }}>
            <div style={{ marginBottom: 10 }}><PixelCoin pixel={2} /></div>
            <div style={{ ...S.pix, fontSize: 11, lineHeight: 1.5 }}>{cById(pending?.charityId).inPerson ? <>LOG THIS GIFT<br />AS GIVEN?</> : <>DID YOU COMPLETE<br />YOUR DONATION?</>}</div>
            <div style={{ fontSize: 13, color: "#5c5443", marginTop: 10 }}>${pending?.amount} to {pending?.charity}</div>
            <div style={{ fontSize: 13, color: "#5c5443", fontStyle: "italic", marginTop: 12, lineHeight: 1.5 }}>"{quote.text}"</div>
            <div style={{ display: "flex", gap: 8, marginTop: 18 }}>
              <button onClick={confirmDonation} style={{ ...S.brutalBtn, flex: 1, background: INK, color: YEL, fontSize: 10, boxShadow: `4px 4px 0 ${RED}` }}>YES ✓</button>
              <button onClick={() => { setShowConfirm(false); setPending(null); }} style={{ ...S.brutalBtn, flex: 1, background: PAPER, color: INK, fontSize: 10, boxShadow: `4px 4px 0 ${INK}` }}>NOT YET</button>
            </div>
          </div>
        </div>
      )}

      {/* Bottom nav */}
      <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, maxWidth: 480, margin: "0 auto", background: INK, borderTop: `3px solid ${INK}`, display: "flex", zIndex: 50, paddingBottom: "env(safe-area-inset-bottom)" }}>
        {TABS.map(t => { const a = screen === t.id; return (
          <button key={t.id} onClick={() => setScreen(t.id)} style={{ flex: 1, padding: "13px 0 12px", background: a ? "#1d1f25" : "transparent", border: "none", borderTop: a ? `3px solid ${YEL}` : "3px solid transparent", cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: 5 }}>
            <t.Icon color={a ? YEL : "#6b6e77"} />
            <span style={{ ...S.pix, fontSize: 7, color: a ? YEL : "#6b6e77" }}>{t.label}</span>
          </button>
        ); })}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════
//  SHARED CHART COMPONENTS
// ═══════════════════════════════════════════════
function MonthBars({ data, curMonth }) {
  const max = Math.max(...data.map(m => m.tot), 1);
  return (
    <div style={{ ...S.box, background: PAPER, padding: "10px 6px 6px", display: "flex", alignItems: "flex-end", gap: 4, height: 120, boxShadow: `4px 4px 0 ${INK}` }}>
      {data.map((m, i) => {
        const h = m.tot > 0 ? Math.max((m.tot / max) * 100, 6) : 0;
        const cur = i === curMonth;
        return (
          <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end", height: "100%", gap: 3 }}>
            <div style={{ width: "100%", height: `${h}%`, minHeight: m.tot > 0 ? 3 : 0, background: cur ? YEL : BLU, border: m.tot > 0 ? `1.5px solid ${INK}` : "none" }} />
            <div style={{ fontSize: 8, fontWeight: 700, color: cur ? INK : "#888" }}>{m.mo}</div>
          </div>
        );
      })}
    </div>
  );
}

function CharityBreakdown({ byId, total }) {
  const entries = Object.entries(byId).sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) return <div style={{ ...S.box, background: PAPER, padding: 18, ...S.pix, fontSize: 8, color: "#888", textAlign: "center", boxShadow: `4px 4px 0 ${INK}` }}>NO DATA YET</div>;
  return (
    <div>
      {entries.map(([id, amt]) => {
        const c = cById(id);
        return (
          <div key={id} style={{ ...S.box, background: PAPER, padding: 10, marginBottom: 8, boxShadow: `4px 4px 0 ${INK}` }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
              <span style={{ width: 12, height: 12, border: `2px solid ${INK}`, background: c.color }} />
              <span style={{ flex: 1, fontSize: 13, fontWeight: 700 }}>{c.name}</span>
              <span style={{ ...S.pix, fontSize: 9 }}>${amt}</span>
            </div>
            <div style={{ height: 12, background: "#e4dcc8", border: `2px solid ${INK}` }}>
              <div style={{ height: "100%", width: `${total > 0 ? (amt / total) * 100 : 0}%`, background: c.color }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ═══════════════════════════════════════════════
//  STYLES
// ═══════════════════════════════════════════════
function Styles() {
  return <style>{`
    @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=Press+Start+2P&display=swap');
    *{box-sizing:border-box;margin:0;padding:0;-webkit-tap-highlight-color:transparent}
    body{background:${BG}}
    @keyframes fadeIn{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}
    @keyframes sheetUp{from{transform:translateY(100%)}to{transform:translateY(0)}}
    @keyframes blink{50%{opacity:0}}
    @keyframes flame{0%,100%{transform:scale(1);filter:drop-shadow(0 0 3px rgba(255,138,61,.55))}50%{transform:scale(1.22);filter:drop-shadow(0 0 11px rgba(255,138,61,.95))}}
    @keyframes coinDrop{0%{transform:translateY(-40px) scale(.5);opacity:0}50%{transform:translateY(4px) scale(1.1);opacity:1}100%{transform:translateY(0) scale(1);opacity:1}}
    ::selection{background:${YEL}}
    input:focus{outline:none}
  `}</style>;
}

const S = {
  pix: { fontFamily: "'Press Start 2P',monospace" },
  box: { border: `3px solid ${INK}` },
  clickable: { cursor: "pointer" },
  scorebar: { background: INK, color: YEL, padding: "9px 12px", display: "flex", justifyContent: "space-between", fontFamily: "'Press Start 2P',monospace", fontSize: 9, border: `2px solid ${INK}` },
  brutalBtn: { padding: "14px 22px", border: `3px solid ${INK}`, fontFamily: "'Press Start 2P',monospace", fontSize: 10, cursor: "pointer", lineHeight: 1.4 },
  linkBtn: { background: "none", border: "none", color: BLU, cursor: "pointer", fontFamily: "'Press Start 2P',monospace", fontSize: 8 },
  pixLabel: { fontFamily: "'Press Start 2P',monospace", fontSize: 8, color: "#8a8061", marginBottom: 8, display: "block" },
  sectionLabel: { fontFamily: "'Press Start 2P',monospace", fontSize: 8, color: RED, margin: "14px 0 8px" },
  input: { width: "100%", padding: "12px 14px", border: `3px solid ${INK}`, background: PAPER, fontFamily: "'Space Grotesk',sans-serif", fontSize: 14, fontWeight: 600, color: INK, outline: "none" },
  sheetOverlay: { position: "fixed", inset: 0, background: "rgba(17,17,17,.55)", zIndex: 100, display: "flex", alignItems: "flex-end", justifyContent: "center" },
  sheet: { width: "100%", maxWidth: 480, background: BG, borderTop: `4px solid ${INK}`, borderRadius: "18px 18px 0 0", padding: "16px 16px 28px", maxHeight: "88vh", overflowY: "auto", animation: "sheetUp .28s cubic-bezier(.2,.8,.2,1)" },
  sheetHead: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 },
  escBtn: { fontFamily: "'Press Start 2P',monospace", fontSize: 9, background: INK, color: YEL, border: `2px solid ${INK}`, padding: "7px 9px", cursor: "pointer" },
  modalOverlay: { position: "fixed", inset: 0, background: "rgba(17,17,17,.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 120, padding: 16 },
};
