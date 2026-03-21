import React, { useCallback, useEffect, useRef, useState } from "react";
import { useActor } from "./hooks/useActor";
import { useQRScanner } from "./qr-code/useQRScanner";
// backend types are used via useActor() hook

// ─── Canister type helpers ────────────────────────────────────────────────────
// Map canister MenuItem stock (bigint: -1 = unlimited) ↔ frontend stock (undefined = unlimited)
function canisterStockToLocal(s: bigint): number | undefined {
  return s === BigInt(-1) ? undefined : Number(s);
}
function localStockToCanister(s: number | undefined): bigint {
  return s === undefined ? BigInt(-1) : BigInt(s);
}

// ─── Types ───────────────────────────────────────────────────────────────────

interface UserRecord {
  lvl: number;
  q: string;
  a: string;
  uid?: string;
}

interface UserDB {
  [name: string]: UserRecord;
}

interface LogAttachment {
  type: "image" | "video" | "audio" | "file" | "gif";
  url?: string;
  dataUrl?: string;
  name?: string;
  mimeType?: string;
}

interface SectorLog {
  id?: string;
  sector: string;
  title: string;
  body: string;
  author: string;
  level: number;
  date: string;
  attachments?: LogAttachment[];
  category?: string;
}

interface AdminPost {
  id?: string;
  author: string;
  content: string;
  minLvl: number;
  date: string;
  sector?: string;
  attachments?: LogAttachment[];
}

interface CurrentUser {
  name: string;
  lvl: number;
  q: string;
  a: string;
  uid?: string;
}

interface ActivityEntry {
  msg: string;
  ts: string;
}

interface DMAttachment {
  type: "image" | "video" | "audio" | "file" | "gif" | "voice";
  dataUrl?: string; // for uploaded files encoded as base64
  url?: string; // for GIF URLs
  name?: string; // for files: filename
  mimeType?: string;
}

interface DMMessage {
  from: string;
  text: string;
  ts: string;
  attachments?: DMAttachment[];
}

interface DMGroup {
  id: string;
  name: string;
  creatorUsername: string;
  members: string[];
  messages: DMMessage[];
}

interface TransactionEntry {
  member: string;
  prevAmount: number;
  newAmount: number;
  changedBy: string;
  ts: string;
  description?: string;
  reversed?: boolean;
  reversedBy?: string;
}

interface MenuItem {
  id: string;
  facility: string;
  name: string;
  price: number;
  description: string;
  createdBy: string;
  stock?: number; // undefined = unlimited
  category?: string;
}

interface MenuItemSupply {
  id: string;
  name: string;
  imageUrl?: string;
  currentStock: number;
  neededPerPurchase: number;
}

interface MenuItemExtras {
  imageUrl?: string;
  supplies?: MenuItemSupply[];
}

// ─── Constants ───────────────────────────────────────────────────────────────

const IMMUNE = ["UNITY", "SYNDELIOUS"];

// biome-ignore lint/correctness/noUnusedVariables: kept for reference
const FACILITIES = [
  { id: "Jail", icon: "⛓️", d: "Containment for unauthorized entities." },
  { id: "Laboratory", icon: "🧪", d: "Primal alchemy and energy synthesis." },
  { id: "Med Bay", icon: "⚕️", d: "Biological restoration." },
  { id: "Bar", icon: "🍷", d: "Social decompression." },
  { id: "Restaurant", icon: "🍱", d: "High-tier nutritional sustenance." },
  { id: "School", icon: "🎓", d: "Knowledge transfer." },
  { id: "Supply Drop", icon: "📦", d: "External resource acquisition." },
  { id: "Gift Shop", icon: "🎁", d: "Sovereign artifacts." },
  { id: "Flight Area", icon: "🚁", d: "Transit hub." },
  { id: "Training Area", icon: "⚔️", d: "Combat simulation." },
  { id: "Greenhouse", icon: "🌿", d: "Resource cultivation." },
  { id: "Surveillance", icon: "👁️", d: "Visibility monitoring." },
  { id: "Offices", icon: "🏢", d: "Command nexus." },
  { id: "Tech Area", icon: "💻", d: "Mainframe encryption." },
  { id: "Dorms", icon: "🛌", d: "Residential quarters." },
];

const LEVEL_NAMES: Record<number, string> = {
  1: "L1: GUEST",
  2: "L2: CIVILIAN",
  3: "L3: OPERATIVE",
  4: "L4: COMMANDER",
  5: "L5: ARCHITECT",
  6: "L6: SOVEREIGN",
};

// ─── localStorage helpers ─────────────────────────────────────────────────────

function getDB(): UserDB {
  return JSON.parse(localStorage.getItem("x_db_v22") || "{}");
}
function setDB(db: UserDB) {
  localStorage.setItem("x_db_v22", JSON.stringify(db));
}

function getRawActivities(): (ActivityEntry | string)[] {
  return JSON.parse(localStorage.getItem("x_act_v22") || "[]");
}

function getActivities(): ActivityEntry[] {
  const raw = getRawActivities();
  return raw.map((entry) => {
    if (typeof entry === "string") {
      // backward compat: old plain string format
      return { msg: entry, ts: new Date(0).toISOString() };
    }
    return entry as ActivityEntry;
  });
}

function get24hActivities(): ActivityEntry[] {
  const all = getActivities();
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  return all.filter((e) => {
    const t = new Date(e.ts).getTime();
    // old entries (epoch 0) are shown to avoid losing them silently; only truly old ones filtered
    return t === 0 || t >= cutoff;
  });
}

function addActivity(msg: string) {
  const ts = new Date().toISOString();
  const raw = getRawActivities();
  const entry: ActivityEntry = { msg, ts };
  raw.unshift(entry);
  localStorage.setItem("x_act_v22", JSON.stringify(raw.slice(0, 50)));
  // Dispatch event so App can forward to canister
  window.dispatchEvent(
    new CustomEvent("xution-activity", { detail: { msg, ts } }),
  );
}

function getSectorLogs(): SectorLog[] {
  return JSON.parse(localStorage.getItem("xution_logs_v5") || "[]");
}
function setSectorLogs(logs: SectorLog[]) {
  localStorage.setItem("xution_logs_v5", JSON.stringify(logs));
}
function getAdminPosts(): AdminPost[] {
  return JSON.parse(localStorage.getItem("x_admin_posts_v22") || "[]");
}
function setAdminPosts(posts: AdminPost[]) {
  localStorage.setItem("x_admin_posts_v22", JSON.stringify(posts));
}
function getBroadcastMsg(): string {
  return localStorage.getItem("x_broadcast_msg_v22") || "";
}
function setBroadcastMsg(msg: string) {
  localStorage.setItem("x_broadcast_msg_v22", msg);
}

// ─── UID helpers ─────────────────────────────────────────────────────────────

function generateUID(): string {
  const db = getDB();
  const usedUIDs = new Set(
    Object.values(db)
      .map((r) => r.uid)
      .filter(Boolean),
  );
  let uid: string;
  do {
    uid = String(Math.floor(10000 + Math.random() * 90000));
  } while (usedUIDs.has(uid));
  return uid;
}

// ─── Card & Funds helpers ─────────────────────────────────────────────────────

function getCardNumber(name: string): string {
  const key = `x_card_${name}`;
  const existing = localStorage.getItem(key);
  if (existing) return existing;
  // Generate 16-digit card: 4xxx groups then last 4 from UID
  const g1 = String(4000 + Math.floor(Math.random() * 999)).padStart(4, "0");
  const g2 = String(Math.floor(1000 + Math.random() * 9000));
  const g3 = String(Math.floor(1000 + Math.random() * 9000));
  const db = getDB();
  const uid = db[name]?.uid || "0000";
  const g4 = uid.padStart(4, "0").slice(-4);
  const cardNum = `${g1} ${g2} ${g3} ${g4}`;
  localStorage.setItem(key, cardNum);
  return cardNum;
}

function getFunds(name: string): number {
  const key = `x_funds_${name}`;
  const existing = localStorage.getItem(key);
  if (existing !== null) return Number.parseFloat(existing);
  const amount = Number.parseFloat((500 + Math.random() * 9499).toFixed(2));
  localStorage.setItem(key, String(amount));
  return amount;
}

function setFunds(name: string, amount: number): void {
  localStorage.setItem(`x_funds_${name}`, String(amount));
}

// ─── Transaction helpers ──────────────────────────────────────────────────────

function getTransactions(): TransactionEntry[] {
  return JSON.parse(localStorage.getItem("x_transactions_v1") || "[]");
}

function addTransaction(entry: TransactionEntry) {
  const all = getTransactions();
  all.unshift(entry);
  localStorage.setItem("x_transactions_v1", JSON.stringify(all.slice(0, 200)));
}

function getMemberTransactions(name: string): TransactionEntry[] {
  return getTransactions().filter((t) => t.member === name);
}

// ─── Category Helpers ──────────────────────────────────────────────────────
const FACILITY_CATS_KEY = "x_facility_categories_v1";
const SECTOR_CATS_KEY = "x_sector_categories_v1";

function getFacilityCategories(facilityKey: string): string[] {
  try {
    const raw = localStorage.getItem(FACILITY_CATS_KEY);
    const map: Record<string, string[]> = raw ? JSON.parse(raw) : {};
    return map[facilityKey] || [];
  } catch {
    return [];
  }
}

function setFacilityCategories(facilityKey: string, cats: string[]) {
  try {
    const raw = localStorage.getItem(FACILITY_CATS_KEY);
    const map: Record<string, string[]> = raw ? JSON.parse(raw) : {};
    map[facilityKey] = cats;
    localStorage.setItem(FACILITY_CATS_KEY, JSON.stringify(map));
  } catch {}
}

function getSectorCategories(sectorKey: string): string[] {
  try {
    const raw = localStorage.getItem(SECTOR_CATS_KEY);
    const map: Record<string, string[]> = raw ? JSON.parse(raw) : {};
    return map[sectorKey] || [];
  } catch {
    return [];
  }
}

function setSectorCategories(sectorKey: string, cats: string[]) {
  try {
    const raw = localStorage.getItem(SECTOR_CATS_KEY);
    const map: Record<string, string[]> = raw ? JSON.parse(raw) : {};
    map[sectorKey] = cats;
    localStorage.setItem(SECTOR_CATS_KEY, JSON.stringify(map));
  } catch {}
}

function formatFunds(amount: number): string {
  return `$${amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// ─── Menu Item helpers ────────────────────────────────────────────────────────

function getMenuItems(): MenuItem[] {
  return JSON.parse(localStorage.getItem("x_menu_items_v1") || "[]");
}

function setMenuItems(items: MenuItem[]): void {
  localStorage.setItem("x_menu_items_v1", JSON.stringify(items));
}

function _getMenuItemExtrasLocal(id: string): MenuItemExtras {
  const map = JSON.parse(localStorage.getItem("x_menu_item_extras_v1") || "{}");
  try {
    return JSON.parse(map[id] || "{}");
  } catch {
    return {};
  }
}
function setMenuItemExtrasLocal(id: string, extras: MenuItemExtras) {
  const map = JSON.parse(localStorage.getItem("x_menu_item_extras_v1") || "{}");
  map[id] = JSON.stringify(extras);
  localStorage.setItem("x_menu_item_extras_v1", JSON.stringify(map));
}
function getAllMenuItemExtrasMapLocal(): Record<string, MenuItemExtras> {
  const map = JSON.parse(localStorage.getItem("x_menu_item_extras_v1") || "{}");
  const result: Record<string, MenuItemExtras> = {};
  for (const [k, v] of Object.entries(map)) {
    try {
      result[k] = JSON.parse(v as string);
    } catch {
      result[k] = {};
    }
  }
  return result;
}

function getXutNumbersMap(): Record<string, string> {
  return JSON.parse(localStorage.getItem("x_xut_numbers_v1") || "{}");
}
function setXutNumberLocal(name: string, num: string) {
  const map = getXutNumbersMap();
  map[name] = num;
  localStorage.setItem("x_xut_numbers_v1", JSON.stringify(map));
}

function getFacilityMenu(facility: string): MenuItem[] {
  return getMenuItems().filter((item) => item.facility === facility);
}

function updateMenuItemStock(itemId: string, newStock: number): void {
  const items = getMenuItems().map((item) =>
    item.id === itemId ? { ...item, stock: Math.max(0, newStock) } : item,
  );
  setMenuItems(items);
}

function decrementMenuItemStock(itemId: string): void {
  const items = getMenuItems();
  const item = items.find((i) => i.id === itemId);
  if (!item || item.stock === undefined) return; // unlimited
  if (item.stock <= 0) return;
  updateMenuItemStock(itemId, item.stock - 1);
}

function getCardExpiry(uid: string | undefined): string {
  if (!uid) return "01/29";
  const uidNum = Number.parseInt(uid, 10);
  const mm = String((uidNum % 12) + 1).padStart(2, "0");
  return `${mm}/29`;
}

// ─── ID Card Image helpers ────────────────────────────────────────────────────
function getIdCardImage(username: string): string | null {
  return localStorage.getItem(`x_idcard_${username}`);
}
function setIdCardImage(username: string, dataUrl: string) {
  localStorage.setItem(`x_idcard_${username}`, dataUrl);
}
function exportIdCardImage(username: string) {
  const data = getIdCardImage(username);
  if (!data) return;
  const a = document.createElement("a");
  a.href = data;
  a.download = `${username}_id_card.png`;
  a.click();
}
// ─── Office Location helpers ─────────────────────────────────────────────────

interface OfficeLocation {
  id: string;
  name: string;
  floor: string;
  desc: string;
}

const DEFAULT_OFFICE_LOCATIONS: OfficeLocation[] = [
  {
    id: "OFC-ALPHA",
    name: "ALPHA COMMAND",
    floor: "FLOOR 1",
    desc: "Primary executive nexus.",
  },
  {
    id: "OFC-BETA",
    name: "BETA OPERATIONS",
    floor: "FLOOR 2",
    desc: "Tactical planning hub.",
  },
  {
    id: "OFC-GAMMA",
    name: "GAMMA INTEL",
    floor: "FLOOR 3",
    desc: "Intelligence analysis unit.",
  },
  {
    id: "OFC-DELTA",
    name: "DELTA ARCHIVE",
    floor: "FLOOR 4",
    desc: "Records and data storage.",
  },
  {
    id: "OFC-OMEGA",
    name: "OMEGA SUMMIT",
    floor: "FLOOR 5",
    desc: "Sovereign council chamber.",
  },
];

function getOfficeLocations(): OfficeLocation[] {
  const stored = localStorage.getItem("x_office_locations_v1");
  if (stored) return JSON.parse(stored) as OfficeLocation[];
  return DEFAULT_OFFICE_LOCATIONS;
}

function setOfficeLocations(locations: OfficeLocation[]): void {
  localStorage.setItem("x_office_locations_v1", JSON.stringify(locations));
}

// ─── Per-office facility helpers ──────────────────────────────────────────────

interface OfficeFacility {
  id: string;
  name: string;
  icon: string;
  desc: string;
  logoUrl?: string;
}

const DEFAULT_OFFICE_FACILITIES: OfficeFacility[] = [
  {
    id: "Jail",
    icon: "⛓️",
    name: "Jail",
    desc: "Containment for unauthorized entities.",
  },
  {
    id: "Laboratory",
    icon: "🧪",
    name: "Laboratory",
    desc: "Primal alchemy and energy synthesis.",
  },
  {
    id: "Med Bay",
    icon: "⚕️",
    name: "Med Bay",
    desc: "Biological restoration.",
  },
  { id: "Bar", icon: "🍷", name: "Bar", desc: "Social decompression." },
  {
    id: "Restaurant",
    icon: "🍱",
    name: "Restaurant",
    desc: "High-tier nutritional sustenance.",
  },
  { id: "School", icon: "🎓", name: "School", desc: "Knowledge transfer." },
  {
    id: "Supply Drop",
    icon: "📦",
    name: "Supply Drop",
    desc: "External resource acquisition.",
  },
  {
    id: "Gift Shop",
    icon: "🎁",
    name: "Gift Shop",
    desc: "Sovereign artifacts.",
  },
  { id: "Flight Area", icon: "🚁", name: "Flight Area", desc: "Transit hub." },
  {
    id: "Training Area",
    icon: "⚔️",
    name: "Training Area",
    desc: "Combat simulation.",
  },
  {
    id: "Greenhouse",
    icon: "🌿",
    name: "Greenhouse",
    desc: "Resource cultivation.",
  },
  {
    id: "Surveillance",
    icon: "👁️",
    name: "Surveillance",
    desc: "Visibility monitoring.",
  },
  { id: "Offices", icon: "🏢", name: "Offices", desc: "Command nexus." },
  {
    id: "Tech Area",
    icon: "💻",
    name: "Tech Area",
    desc: "Mainframe encryption.",
  },
  { id: "Dorms", icon: "🛌", name: "Dorms", desc: "Residential quarters." },
];

function getOfficeFacilitiesKey(officeId: string): string {
  return `x_office_facilities_${officeId}`;
}

function getOfficeFacilities(officeId: string): OfficeFacility[] {
  const stored = localStorage.getItem(getOfficeFacilitiesKey(officeId));
  if (stored) return JSON.parse(stored) as OfficeFacility[];
  return [...DEFAULT_OFFICE_FACILITIES];
}

function saveOfficeFacilities(
  officeId: string,
  facilities: OfficeFacility[],
): void {
  localStorage.setItem(
    getOfficeFacilitiesKey(officeId),
    JSON.stringify(facilities),
  );
}

function getOfficeFavsKey(me: string): string {
  return `x_office_favs_${me}`;
}
function getOfficeFavs(me: string): string[] {
  return JSON.parse(localStorage.getItem(getOfficeFavsKey(me)) || "[]");
}
function toggleOfficeFav(me: string, officeId: string): string[] {
  const favs = getOfficeFavs(me);
  const idx = favs.indexOf(officeId);
  if (idx >= 0) {
    favs.splice(idx, 1);
  } else {
    favs.push(officeId);
  }
  localStorage.setItem(getOfficeFavsKey(me), JSON.stringify(favs));
  return [...favs];
}

// ─── Lockdown helpers ─────────────────────────────────────────────────────────

function getLockdown(): boolean {
  return localStorage.getItem("x_lockdown_v1") === "1";
}
function setLockdown(active: boolean): void {
  localStorage.setItem("x_lockdown_v1", active ? "1" : "0");
}

// ─── About/Credits content helpers ───────────────────────────────────────────

const DEFAULT_ABOUT_CONTENT = `Project Leader: Creature Subliminals
Aka: Unity
Co-Founder: Syndelious
Purpose: This platform was created because existing chat platforms did not honor user terms, lacked logic, and did not make sense for our workflow. Xution provides a fully functional hub for operations, member management, and sector control.`;

const DEFAULT_FEATURES_CONTENT = `Full authentication system with registration & login
Member management (levels, delete, IMMUTABLE for key IDs)
Sector access with logs, admin posts, and emergency broadcast
Activity feed showing last 24 hours of actions
Collapsible member directory with direct messaging
Facility directory with interactive tiles
Contact command quick-link via email
Emergency broadcast banner for critical alerts`;

const DEFAULT_CREDITS_CONTENT =
  "Code base written by Creature Subliminals (Unity) with assistance from ChatGPT. All local data is stored in browser localStorage for easy persistence and testing.";

function getAboutContent(key: string, defaultVal: string): string {
  return localStorage.getItem(key) ?? defaultVal;
}
function getContactLink(): string {
  return (
    localStorage.getItem("x_contact_link") ?? "mailto:Gameloverv@gmail.com"
  );
}
function setAboutContent(key: string, val: string): void {
  localStorage.setItem(key, val);
}

// ─── Profile picture helpers ──────────────────────────────────────────────────

function getAvatarKey(name: string): string {
  return `x_avatar_${name}`;
}
function getAvatar(name: string): string {
  return localStorage.getItem(getAvatarKey(name)) || "";
}
function setAvatar(name: string, dataUrl: string) {
  localStorage.setItem(getAvatarKey(name), dataUrl);
}

// ─── DM helpers ──────────────────────────────────────────────────────────────

function getDMKey(a: string, b: string): string {
  return `x_dm_${[a, b].sort().join("_")}`;
}
function getDMs(a: string, b: string): DMMessage[] {
  return JSON.parse(localStorage.getItem(getDMKey(a, b)) || "[]");
}
function addDM(
  a: string,
  b: string,
  from: string,
  text: string,
  attachments?: DMAttachment[],
) {
  const msgs = getDMs(a, b);
  msgs.push({ from, text, ts: new Date().toISOString(), attachments });
  localStorage.setItem(getDMKey(a, b), JSON.stringify(msgs));
}

// ─── DM unread helpers ────────────────────────────────────────────────────────

function getDMReadKey(me: string, other: string): string {
  return `x_dm_read_${me}_${other}`;
}
function getDMReadTs(me: string, other: string): number {
  return Number(localStorage.getItem(getDMReadKey(me, other)) || "0");
}
function markDMRead(me: string, other: string) {
  localStorage.setItem(getDMReadKey(me, other), String(Date.now()));
}
function getDMUnreadCount(me: string, other: string): number {
  const readTs = getDMReadTs(me, other);
  const msgs = getDMs(me, other);
  return msgs.filter((m) => m.from !== me && new Date(m.ts).getTime() > readTs)
    .length;
}

// ─── Presence helpers ─────────────────────────────────────────────────────────

function setPresence(name: string): void {
  localStorage.setItem(`x_presence_${name}`, String(Date.now()));
}

function getPresence(name: string): boolean {
  const ts = Number(localStorage.getItem(`x_presence_${name}`) || "0");
  return ts > 0 && Date.now() - ts < 60000;
}

// ─── Favourites helpers ───────────────────────────────────────────────────────

function getFavouritesKey(me: string): string {
  return `x_favs_${me}`;
}
function getFavourites(me: string): string[] {
  return JSON.parse(localStorage.getItem(getFavouritesKey(me)) || "[]");
}
function toggleFavourite(me: string, other: string): string[] {
  const favs = getFavourites(me);
  const idx = favs.indexOf(other);
  if (idx >= 0) {
    favs.splice(idx, 1);
  } else {
    favs.push(other);
  }
  localStorage.setItem(getFavouritesKey(me), JSON.stringify(favs));
  return [...favs];
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const S = {
  gold: "#d4af37",
  goldBr: "#f1d56e",
  blue: "#00d4ff",
  red: "#ef4444",
  bg: "#020202",
  card: "#0a0a0a",
  brd: "#222",
  green: "#00ff41",
  dim: "#666",
  white: "#e0e0e0",
} as const;

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "14px",
  margin: "8px 0",
  background: "#000",
  border: "1px solid #444",
  color: S.gold,
  fontFamily: "'JetBrains Mono', 'Courier New', monospace",
  fontWeight: 900,
  outline: "none",
  fontSize: "16px",
  textTransform: "uppercase",
  boxSizing: "border-box",
};

const selectStyle: React.CSSProperties = {
  ...inputStyle,
  cursor: "pointer",
};

const textareaStyle: React.CSSProperties = {
  ...inputStyle,
  resize: "vertical",
  minHeight: "80px",
};

const btnPrimary: React.CSSProperties = {
  background: S.gold,
  color: "#000",
  border: "none",
  padding: "16px",
  width: "100%",
  fontWeight: 900,
  cursor: "pointer",
  textTransform: "uppercase",
  fontFamily: "'JetBrains Mono', 'Courier New', monospace",
  fontSize: "14px",
  letterSpacing: "1px",
};

const btnSmall: React.CSSProperties = {
  padding: "8px",
  flex: 1,
  fontSize: "0.7rem",
  cursor: "pointer",
  border: "none",
  fontWeight: 900,
  fontFamily: "'JetBrains Mono', 'Courier New', monospace",
  textTransform: "uppercase",
  letterSpacing: "0.5px",
};

// ─── Scrollbar style injection ────────────────────────────────────────────────

const SCROLL_STYLE_ID = "xution-scroll-styles";
if (!document.getElementById(SCROLL_STYLE_ID)) {
  const style = document.createElement("style");
  style.id = SCROLL_STYLE_ID;
  style.textContent = `
    .xution-scroll::-webkit-scrollbar { width: 4px; height: 4px; }
    .xution-scroll::-webkit-scrollbar-track { background: #0a0a0a; }
    .xution-scroll::-webkit-scrollbar-thumb { background: #333; border-radius: 2px; }
    .xution-scroll::-webkit-scrollbar-thumb:hover { background: #555; }
  `;
  document.head.appendChild(style);
}

// ─── XutionCard ───────────────────────────────────────────────────────────────

function XutionCard({ currentUser }: { currentUser: CurrentUser }) {
  const cardNum = getCardNumber(currentUser.name);
  const expiry = getCardExpiry(currentUser.uid);
  const isSovereign = currentUser.lvl === 6;
  const [funds, setFundsState] = useState<number>(() =>
    getFunds(currentUser.name),
  );
  const [showQrModal, setShowQrModal] = useState(false);
  // Poll funds from localStorage in case they change (L6 admin update)
  useEffect(() => {
    const interval = setInterval(() => {
      const latest = getFunds(currentUser.name);
      setFundsState((prev) => (prev !== latest ? latest : prev));
    }, 2000);
    return () => clearInterval(interval);
  }, [currentUser.name]);

  return (
    <div
      style={{
        background:
          "linear-gradient(135deg, #0a0a0a 0%, #1a1500 60%, #0d0d00 100%)",
        border: `2px solid ${S.gold}`,
        borderRadius: "12px",
        width: "100%",
        maxWidth: "380px",
        aspectRatio: "1.586",
        margin: "0 auto",
        padding: "20px 22px",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        position: "relative",
        overflow: "hidden",
        boxShadow: `0 0 30px ${S.gold}22, 0 8px 32px rgba(0,0,0,0.8)`,
        fontFamily: "'JetBrains Mono', 'Courier New', monospace",
      }}
    >
      {/* Background shimmer lines */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          backgroundImage: `repeating-linear-gradient(
            45deg,
            transparent,
            transparent 20px,
            ${S.gold}08 20px,
            ${S.gold}08 21px
          )`,
          pointerEvents: "none",
        }}
      />

      {/* Top row: chip + logo */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          position: "relative",
          zIndex: 1,
        }}
      >
        {/* Chip */}
        <div
          style={{
            width: "38px",
            height: "28px",
            background: `linear-gradient(135deg, ${S.gold} 0%, ${S.goldBr} 50%, ${S.gold} 100%)`,
            borderRadius: "4px",
            border: `1px solid ${S.goldBr}`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            position: "relative",
            overflow: "hidden",
          }}
        >
          {/* Chip lines */}
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "grid",
              gridTemplateColumns: "1fr 1fr 1fr",
              gridTemplateRows: "1fr 1fr 1fr",
              gap: "2px",
              padding: "3px",
            }}
          >
            {(
              ["c0", "c1", "c2", "c3", "c4", "c5", "c6", "c7", "c8"] as const
            ).map((id) => (
              <div
                key={id}
                style={{
                  background: id === "c4" ? S.gold : `${S.gold}88`,
                  borderRadius: "1px",
                }}
              />
            ))}
          </div>
        </div>

        {/* Card brand */}
        <div style={{ textAlign: "right" }}>
          <div
            style={{
              color: S.gold,
              fontSize: "1rem",
              fontWeight: 900,
              letterSpacing: "4px",
              textShadow: `0 0 10px ${S.gold}88`,
            }}
          >
            XUTION
          </div>
          <div
            style={{
              color: `${S.gold}88`,
              fontSize: "0.45rem",
              letterSpacing: "2px",
              marginTop: "2px",
            }}
          >
            SOVEREIGN CREDIT
          </div>
          <button
            type="button"
            data-ocid="card.qr.button"
            onClick={() => setShowQrModal(true)}
            title="SHOW QR CODE"
            style={{
              background: "transparent",
              border: `1px solid ${S.gold}44`,
              color: S.gold,
              cursor: "pointer",
              fontSize: "0.55rem",
              padding: "2px 5px",
              marginTop: "4px",
              fontFamily: "inherit",
              letterSpacing: "1px",
            }}
          >
            📷 QR
          </button>
        </div>
      </div>
      {/* QR Modal */}
      {showQrModal && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.85)",
            zIndex: 9999,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <div
            style={{
              background: "#0a0a0a",
              border: `2px solid ${S.gold}`,
              padding: "24px",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: "12px",
              fontFamily: "'JetBrains Mono', 'Courier New', monospace",
            }}
          >
            <div
              style={{
                color: S.gold,
                fontSize: "0.7rem",
                letterSpacing: "3px",
                fontWeight: 900,
              }}
            >
              YOUR ID CARD
            </div>
            {getIdCardImage(currentUser.name) ? (
              <img
                src={getIdCardImage(currentUser.name)!}
                alt="ID Card"
                style={{
                  width: "200px",
                  maxHeight: "280px",
                  objectFit: "contain",
                  borderRadius: "6px",
                }}
              />
            ) : (
              <div
                style={{
                  color: "#555",
                  fontSize: "0.65rem",
                  letterSpacing: "2px",
                  textAlign: "center",
                  padding: "20px",
                }}
              >
                NO ID CARD IMPORTED YET
              </div>
            )}
            <div
              style={{ color: S.dim, fontSize: "0.6rem", letterSpacing: "2px" }}
            >
              {currentUser.name}
            </div>
            <button
              type="button"
              data-ocid="card.qr.close_button"
              onClick={() => setShowQrModal(false)}
              style={{
                background: "transparent",
                border: `1px solid ${S.gold}`,
                color: S.gold,
                cursor: "pointer",
                padding: "6px 20px",
                fontSize: "0.7rem",
                fontWeight: 900,
                letterSpacing: "2px",
                fontFamily: "inherit",
              }}
            >
              CLOSE
            </button>
          </div>
        </div>
      )}

      {/* Balance — center area */}
      <div
        style={{
          position: "relative",
          zIndex: 1,
          textAlign: "center",
        }}
      >
        <div
          style={{
            color: `${S.gold}88`,
            fontSize: "0.5rem",
            letterSpacing: "3px",
            marginBottom: "4px",
          }}
        >
          AVAILABLE FUNDS
        </div>
        <div
          style={{
            color: S.goldBr,
            fontSize: isSovereign ? "1.1rem" : "1.5rem",
            fontWeight: 900,
            letterSpacing: "2px",
            textShadow: `0 0 15px ${S.gold}66`,
          }}
        >
          {isSovereign ? "∞ UNLIMITED" : formatFunds(funds)}
        </div>
      </div>

      {/* Card number */}
      <div
        style={{
          position: "relative",
          zIndex: 1,
        }}
      >
        <div
          style={{
            color: S.white,
            fontSize: "0.75rem",
            letterSpacing: "3px",
            fontWeight: 900,
            textShadow: `0 0 8px ${S.gold}44`,
          }}
        >
          {cardNum}
        </div>
      </div>

      {/* Bottom row: name + expiry */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-end",
          position: "relative",
          zIndex: 1,
        }}
      >
        <div>
          <div
            style={{
              color: `${S.gold}88`,
              fontSize: "0.45rem",
              letterSpacing: "2px",
              marginBottom: "3px",
            }}
          >
            CARDHOLDER
          </div>
          <div
            style={{
              color: S.white,
              fontSize: "0.65rem",
              fontWeight: 900,
              letterSpacing: "2px",
              maxWidth: "180px",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {currentUser.name}
          </div>
          <div
            style={{
              color: S.gold,
              fontSize: "0.5rem",
              letterSpacing: "1px",
              marginTop: "2px",
            }}
          >
            {LEVEL_NAMES[currentUser.lvl] || `L${currentUser.lvl}`}
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div
            style={{
              color: `${S.gold}88`,
              fontSize: "0.45rem",
              letterSpacing: "2px",
              marginBottom: "3px",
            }}
          >
            VALID THRU
          </div>
          <div
            style={{
              color: S.white,
              fontSize: "0.65rem",
              fontWeight: 900,
              letterSpacing: "2px",
            }}
          >
            {expiry}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── FundManagement (L6 only) ─────────────────────────────────────────────────

function FundManagement({
  onUpdate,
  currentUser,
}: {
  onUpdate: () => void;
  currentUser: CurrentUser;
}) {
  const { actor } = useActor();
  const [expanded, setExpanded] = useState(false);
  const [db] = useState<UserDB>(getDB);
  const [inputVals, setInputVals] = useState<Record<string, string>>({});
  const memberNames = Object.keys(db);

  const [adjustSearch, setAdjustSearch] = useState("");
  const [adjustMember, setAdjustMember] = useState("");
  const [adjustAmount, setAdjustAmount] = useState("");
  const filteredMembers = adjustSearch.trim()
    ? memberNames.filter((n) =>
        n.toLowerCase().includes(adjustSearch.toLowerCase()),
      )
    : memberNames;

  const handleAdjust = (dir: "add" | "remove") => {
    const amt = Number.parseFloat(adjustAmount);
    if (!adjustMember || Number.isNaN(amt) || amt <= 0) return;
    const label = dir === "add" ? "ADD" : "REMOVE";
    if (
      !window.confirm(
        `${label} ${formatFunds(amt)} ${dir === "add" ? "TO" : "FROM"} ${adjustMember}?`,
      )
    )
      return;
    const prev = getFunds(adjustMember);
    const next = Number.parseFloat(
      (dir === "add" ? prev + amt : Math.max(0, prev - amt)).toFixed(2),
    );
    setFunds(adjustMember, next);
    const ts = new Date().toISOString();
    const desc =
      dir === "add"
        ? `ADD FUNDS TO ${adjustMember} BY ${currentUser.name}`
        : `REMOVE FUNDS FROM ${adjustMember} BY ${currentUser.name}`;
    addTransaction({
      member: adjustMember,
      prevAmount: prev,
      newAmount: next,
      changedBy: currentUser.name,
      ts,
      description: desc,
    });
    setAdjustAmount("");
    onUpdate();
    actor?.setMemberFunds(adjustMember, next).catch(() => {});
    actor
      ?.addTransaction(adjustMember, prev, next, currentUser.name, ts, desc)
      .catch(() => {});
  };

  const handleSet = (name: string) => {
    const val = Number.parseFloat(inputVals[name] || "");
    if (Number.isNaN(val) || val < 0) return;
    const prev = getFunds(name);
    const next = Number.parseFloat(val.toFixed(2));
    setFunds(name, next);
    const ts = new Date().toISOString();
    addTransaction({
      member: name,
      prevAmount: prev,
      newAmount: next,
      changedBy: currentUser.name,
      ts,
      description: `FUND SET FOR ${name} BY ${currentUser.name}`,
    });
    setInputVals((prev) => ({ ...prev, [name]: "" }));
    onUpdate();
    // Sync to canister
    actor?.setMemberFunds(name, next).catch(() => {});
    actor
      ?.addTransaction(
        name,
        prev,
        next,
        currentUser.name,
        ts,
        `FUND SET FOR ${name} BY ${currentUser.name}`,
      )
      .catch(() => {});
  };

  return (
    <div style={{ marginBottom: "20px" }}>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          width: "100%",
          background: "transparent",
          border: "none",
          borderLeft: `5px solid ${S.red}`,
          paddingLeft: "15px",
          paddingRight: "0",
          marginBottom: expanded ? "15px" : "0",
          cursor: "pointer",
          textAlign: "left",
        }}
      >
        <h3
          style={{
            margin: 0,
            fontSize: "0.85rem",
            letterSpacing: "3px",
            color: S.red,
            fontFamily: "'JetBrains Mono', 'Courier New', monospace",
            fontWeight: 900,
            textTransform: "uppercase",
          }}
        >
          FUND MANAGEMENT
        </h3>
        <span
          style={{
            color: S.red,
            fontSize: "0.75rem",
            fontFamily: "'JetBrains Mono', 'Courier New', monospace",
            fontWeight: 900,
            marginLeft: "10px",
          }}
        >
          {expanded ? "▲" : "▼"}
        </span>
      </button>

      {expanded && (
        <div
          style={{
            border: `1px solid ${S.red}44`,
            background: "#0a0000",
            padding: "10px 15px",
          }}
        >
          {/* Adjust Funds */}
          <div
            style={{
              marginBottom: "14px",
              paddingBottom: "12px",
              borderBottom: `1px solid ${S.red}44`,
            }}
          >
            <div
              style={{
                fontSize: "0.65rem",
                color: S.red,
                letterSpacing: "2px",
                marginBottom: "8px",
                fontWeight: 900,
              }}
            >
              ADJUST FUNDS
            </div>
            <input
              type="text"
              placeholder="SEARCH MEMBER..."
              value={adjustSearch}
              onChange={(e) => setAdjustSearch(e.target.value)}
              data-ocid="fund.adjust.search_input"
              style={{
                ...inputStyle,
                marginBottom: "6px",
                fontSize: "0.7rem",
                borderColor: `${S.red}66`,
              }}
            />
            <select
              value={adjustMember}
              onChange={(e) => setAdjustMember(e.target.value)}
              data-ocid="fund.adjust.select"
              style={{
                ...inputStyle,
                marginBottom: "6px",
                fontSize: "0.7rem",
                background: "#111",
                color: adjustMember ? S.white : S.dim,
                cursor: "pointer",
              }}
            >
              <option value="">-- SELECT MEMBER --</option>
              {filteredMembers.map((n) => (
                <option key={n} value={n}>
                  {n} ({formatFunds(getFunds(n))})
                </option>
              ))}
            </select>
            <div
              style={{
                display: "flex",
                gap: "8px",
                alignItems: "center",
                flexWrap: "wrap",
              }}
            >
              <input
                type="number"
                placeholder="AMOUNT"
                min={0}
                step={0.01}
                value={adjustAmount}
                onChange={(e) => setAdjustAmount(e.target.value)}
                data-ocid="fund.adjust.input"
                style={{
                  ...inputStyle,
                  margin: 0,
                  flex: 1,
                  minWidth: "80px",
                  fontSize: "0.7rem",
                  height: "32px",
                  padding: "6px 8px",
                }}
              />
              <button
                type="button"
                data-ocid="fund.adjust.primary_button"
                onClick={() => handleAdjust("add")}
                style={{
                  ...btnSmall,
                  background: "#0a2a0a",
                  color: S.green,
                  border: `1px solid ${S.green}66`,
                  fontWeight: 900,
                }}
              >
                + ADD
              </button>
              <button
                type="button"
                data-ocid="fund.adjust.delete_button"
                onClick={() => handleAdjust("remove")}
                style={{
                  ...btnSmall,
                  background: "#2a0a0a",
                  color: S.red,
                  border: `1px solid ${S.red}66`,
                  fontWeight: 900,
                }}
              >
                − REMOVE
              </button>
            </div>
          </div>

          {/* Per-member SET section */}
          {memberNames.length === 0 ? (
            <div
              style={{
                padding: "10px 0",
                color: S.dim,
                fontSize: "0.7rem",
                textTransform: "uppercase",
              }}
            >
              NO MEMBERS
            </div>
          ) : (
            memberNames.map((memberName) => {
              const currentFunds = getFunds(memberName);
              return (
                <div
                  key={memberName}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "10px",
                    padding: "8px 0",
                    borderBottom: `1px solid ${S.brd}`,
                    flexWrap: "wrap",
                  }}
                >
                  <div
                    style={{
                      flex: "1 1 120px",
                      fontSize: "0.7rem",
                      color: S.white,
                      fontWeight: 900,
                      letterSpacing: "1px",
                    }}
                  >
                    {memberName}
                  </div>
                  <div
                    style={{
                      fontSize: "0.7rem",
                      color: S.gold,
                      fontWeight: 900,
                      minWidth: "80px",
                    }}
                  >
                    {formatFunds(currentFunds)}
                  </div>
                  <div
                    style={{ display: "flex", gap: "6px", flex: "1 1 180px" }}
                  >
                    <input
                      type="number"
                      placeholder="NEW AMOUNT"
                      min={0}
                      step={0.01}
                      value={inputVals[memberName] || ""}
                      onChange={(e) =>
                        setInputVals((prev) => ({
                          ...prev,
                          [memberName]: e.target.value,
                        }))
                      }
                      onKeyDown={(e) =>
                        e.key === "Enter" && handleSet(memberName)
                      }
                      style={{
                        ...inputStyle,
                        margin: 0,
                        flex: 1,
                        fontSize: "0.7rem",
                        padding: "6px 8px",
                        height: "32px",
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => handleSet(memberName)}
                      style={{
                        ...btnSmall,
                        background: S.gold,
                        color: "#000",
                        padding: "6px 10px",
                        flex: "none",
                        fontSize: "0.65rem",
                      }}
                    >
                      SET
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

// ─── PersonalTransactionHistory ───────────────────────────────────────────────

function PersonalTransactionHistory({
  currentUser,
  transactions,
}: {
  currentUser: CurrentUser;
  transactions?: TransactionEntry[];
}) {
  const [expanded, setExpanded] = useState(false);
  const [localTxns, setLocalTxns] = useState<TransactionEntry[]>(() =>
    getMemberTransactions(currentUser.name),
  );
  const [txnSearch, setTxnSearch] = useState("");

  const refresh = () => setLocalTxns(getMemberTransactions(currentUser.name));

  // Poll for updates (e.g. L6 adjusts your balance) - fallback for offline
  useEffect(() => {
    const id = setInterval(refresh, 3000);
    return () => clearInterval(id);
  });

  // Merge canister-polled transactions with local ones so fund adjustments appear immediately
  const txns = (() => {
    const canisterFiltered = transactions
      ? transactions.filter((t) => t.member === currentUser.name)
      : null;
    if (!canisterFiltered) return localTxns;
    const canisterKeys = new Set(
      canisterFiltered.map((t) => `${t.ts}-${t.member}`),
    );
    const localExtra = localTxns.filter(
      (t) => !canisterKeys.has(`${t.ts}-${t.member}`),
    );
    return [...localExtra, ...canisterFiltered].sort((a, b) =>
      b.ts.localeCompare(a.ts),
    );
  })();

  const filteredTxns = txnSearch.trim()
    ? txns.filter(
        (t) =>
          (t.description || "")
            .toLowerCase()
            .includes(txnSearch.toLowerCase()) ||
          new Date(t.ts)
            .toLocaleString()
            .toLowerCase()
            .includes(txnSearch.toLowerCase()),
      )
    : txns;

  return (
    <div style={{ marginBottom: "16px" }}>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          width: "100%",
          background: "transparent",
          border: "none",
          borderLeft: `5px solid ${S.gold}`,
          paddingLeft: "15px",
          paddingRight: "0",
          marginBottom: expanded ? "12px" : "0",
          cursor: "pointer",
          textAlign: "left",
        }}
      >
        <h3
          style={{
            margin: 0,
            fontSize: "0.8rem",
            letterSpacing: "3px",
            color: S.gold,
            fontFamily: "'JetBrains Mono', 'Courier New', monospace",
            fontWeight: 900,
            textTransform: "uppercase",
          }}
        >
          MY TRANSACTION HISTORY
        </h3>
        <span
          style={{
            color: S.gold,
            fontSize: "0.75rem",
            fontFamily: "'JetBrains Mono', 'Courier New', monospace",
            fontWeight: 900,
            marginLeft: "10px",
          }}
        >
          {expanded ? "▲" : "▼"} [{txns.length}]
        </span>
      </button>

      {expanded && (
        <div
          className="xution-scroll"
          style={{
            border: `1px solid ${S.brd}`,
            background: "#080808",
            maxHeight: "220px",
            overflowY: "auto",
            padding: "10px 12px",
          }}
        >
          <input
            type="text"
            value={txnSearch}
            onChange={(e) => setTxnSearch(e.target.value)}
            placeholder="SEARCH TRANSACTIONS..."
            style={{
              width: "100%",
              background: "#111",
              border: `1px solid ${S.brd}`,
              color: S.white,
              padding: "5px 8px",
              fontSize: "0.6rem",
              letterSpacing: "2px",
              fontFamily: "inherit",
              marginBottom: "8px",
              boxSizing: "border-box",
            }}
          />
          {filteredTxns.length === 0 ? (
            <div
              style={{
                color: S.dim,
                fontSize: "0.65rem",
                textTransform: "uppercase",
                textAlign: "center",
                padding: "16px 0",
              }}
            >
              NO TRANSACTIONS YET
            </div>
          ) : (
            filteredTxns.map((t, i) => {
              const delta = t.newAmount - t.prevAmount;
              const isPositive = delta >= 0;
              return (
                <div
                  key={`ptx-${t.ts}-${i}`}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "flex-start",
                    padding: "7px 0",
                    borderBottom: `1px solid ${S.brd}`,
                    gap: "10px",
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: "0.65rem",
                        color: t.description?.startsWith("PURCHASE:")
                          ? S.gold
                          : S.white,
                        fontWeight: 900,
                        letterSpacing: "1px",
                        marginBottom: "2px",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        textDecoration: t.reversed ? "line-through" : "none",
                        opacity: t.reversed ? 0.6 : 1,
                      }}
                    >
                      {t.description || "FUND UPDATE"}
                      {t.reversed && (
                        <span
                          style={{
                            marginLeft: "6px",
                            color: S.red,
                            fontSize: "0.55rem",
                            fontWeight: 900,
                          }}
                        >
                          [REVERSED]
                        </span>
                      )}
                    </div>
                    <div
                      style={{
                        fontSize: "0.55rem",
                        color: S.dim,
                        letterSpacing: "1px",
                      }}
                    >
                      {new Date(t.ts).toLocaleString()}
                    </div>
                  </div>
                  <div style={{ textAlign: "right", flexShrink: 0 }}>
                    <div
                      style={{
                        fontSize: "0.7rem",
                        fontWeight: 900,
                        color: isPositive ? S.green : S.red,
                        letterSpacing: "1px",
                      }}
                    >
                      {isPositive ? "+" : ""}
                      {formatFunds(delta)}
                    </div>
                    <div
                      style={{
                        fontSize: "0.55rem",
                        color: S.gold,
                        letterSpacing: "1px",
                      }}
                    >
                      → {formatFunds(t.newAmount)}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

// ─── PersonalFundManagement ───────────────────────────────────────────────────

function PersonalFundManagement({
  currentUser,
  onPurchase,
}: {
  currentUser: CurrentUser;
  onPurchase: () => void;
}) {
  const { actor } = useActor();
  const [expanded, setExpanded] = useState(false);
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [funds, setFundsState] = useState<number>(() =>
    getFunds(currentUser.name),
  );
  const [pendingPurchase, setPendingPurchase] = useState<{
    description: string;
    cost: number;
  } | null>(null);

  const isSovereign = currentUser.lvl === 6;

  // Poll funds so balance stays fresh
  useEffect(() => {
    const id = setInterval(() => {
      const latest = getFunds(currentUser.name);
      setFundsState((prev) => (prev !== latest ? latest : prev));
    }, 2000);
    return () => clearInterval(id);
  }, [currentUser.name]);

  const handlePurchase = () => {
    setError("");
    const desc = description.trim();
    const cost = Number.parseFloat(amount);

    if (!desc) {
      setError("DESCRIPTION REQUIRED");
      return;
    }
    if (Number.isNaN(cost) || cost <= 0) {
      setError("INVALID AMOUNT");
      return;
    }
    if (!isSovereign && cost > funds) {
      setError("INSUFFICIENT FUNDS");
      return;
    }

    // Open confirmation modal
    setPendingPurchase({ description: desc, cost });
  };

  const executePersonalPurchase = (desc: string, cost: number) => {
    const prevAmount = funds;
    const newAmount = isSovereign
      ? prevAmount
      : Number.parseFloat((prevAmount - cost).toFixed(2));

    if (!isSovereign) {
      setFunds(currentUser.name, newAmount);
      setFundsState(newAmount);
      actor?.setMemberFunds(currentUser.name, newAmount).catch(() => {});
    }

    const ts = new Date().toISOString();
    addTransaction({
      member: currentUser.name,
      prevAmount,
      newAmount,
      changedBy: currentUser.name,
      ts,
      description: `PURCHASE: ${desc}`,
    });
    actor
      ?.addTransaction(
        currentUser.name,
        prevAmount,
        newAmount,
        currentUser.name,
        ts,
        `PURCHASE: ${desc}`,
      )
      .catch(() => {});
    addActivity(`PURCHASE: ${desc} BY ${currentUser.name}`);

    setDescription("");
    setAmount("");
    setSuccess(true);
    setPendingPurchase(null);
    onPurchase();

    setTimeout(() => setSuccess(false), 2000);
  };

  return (
    <>
      {pendingPurchase && (
        <PurchaseConfirmModal
          itemName={pendingPurchase.description}
          cost={pendingPurchase.cost}
          cardNumber={getCardNumber(currentUser.name)}
          balance={isSovereign ? null : funds}
          onConfirm={() =>
            executePersonalPurchase(
              pendingPurchase.description,
              pendingPurchase.cost,
            )
          }
          onCancel={() => setPendingPurchase(null)}
        />
      )}
      <div style={{ marginBottom: "16px" }}>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            width: "100%",
            background: "transparent",
            border: "none",
            borderLeft: `5px solid ${S.gold}`,
            paddingLeft: "15px",
            paddingRight: "0",
            marginBottom: expanded ? "12px" : "0",
            cursor: "pointer",
            textAlign: "left",
          }}
        >
          <h3
            style={{
              margin: 0,
              fontSize: "0.8rem",
              letterSpacing: "3px",
              color: S.gold,
              fontFamily: "'JetBrains Mono', 'Courier New', monospace",
              fontWeight: 900,
              textTransform: "uppercase",
            }}
          >
            PERSONAL FUND MANAGEMENT
          </h3>
          <span
            style={{
              color: S.gold,
              fontSize: "0.75rem",
              fontFamily: "'JetBrains Mono', 'Courier New', monospace",
              fontWeight: 900,
              marginLeft: "10px",
            }}
          >
            {expanded ? "▲" : "▼"}
          </span>
        </button>

        {expanded && (
          <div
            style={{
              border: `1px solid ${S.brd}`,
              background: "#080808",
              padding: "12px 15px",
            }}
          >
            {/* Balance display */}
            <div
              style={{
                marginBottom: "14px",
                padding: "10px 12px",
                background: "#0a0a0a",
                border: `1px solid ${S.gold}33`,
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <span
                style={{
                  fontSize: "0.6rem",
                  color: S.dim,
                  letterSpacing: "2px",
                }}
              >
                CURRENT BALANCE
              </span>
              <span
                style={{
                  fontSize: isSovereign ? "0.85rem" : "1rem",
                  color: S.gold,
                  fontWeight: 900,
                  letterSpacing: "2px",
                }}
              >
                {isSovereign ? "∞ UNLIMITED" : formatFunds(funds)}
              </span>
            </div>

            {/* Item description input */}
            <div
              style={{
                fontSize: "0.55rem",
                color: S.dim,
                letterSpacing: "2px",
                marginBottom: "2px",
              }}
            >
              ITEM / DESCRIPTION
            </div>
            <input
              type="text"
              placeholder="ENTER ITEM NAME..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handlePurchase()}
              style={{ ...inputStyle, marginBottom: "0" }}
            />

            {/* Amount input */}
            <div
              style={{
                fontSize: "0.55rem",
                color: S.dim,
                letterSpacing: "2px",
                marginTop: "10px",
                marginBottom: "2px",
              }}
            >
              AMOUNT
            </div>
            <input
              type="number"
              placeholder="0.00"
              min={0}
              step={0.01}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handlePurchase()}
              style={{ ...inputStyle, marginBottom: "0" }}
            />

            {/* Error / success messages */}
            {error && (
              <div
                style={{
                  marginTop: "8px",
                  fontSize: "0.65rem",
                  color: S.red,
                  letterSpacing: "2px",
                  fontWeight: 900,
                }}
              >
                ⚠ {error}
              </div>
            )}
            {success && (
              <div
                style={{
                  marginTop: "8px",
                  fontSize: "0.65rem",
                  color: S.green,
                  letterSpacing: "2px",
                  fontWeight: 900,
                }}
              >
                ✓ PURCHASE APPROVED
              </div>
            )}

            {/* Purchase button */}
            <button
              type="button"
              style={{ ...btnPrimary, marginTop: "12px" }}
              onClick={handlePurchase}
            >
              PURCHASE
            </button>
          </div>
        )}
      </div>
    </>
  );
}

// ─── GlobalTransactionHistory (L6 only) ──────────────────────────────────────

function GlobalTransactionHistory({
  transactions,
  currentUser,
  onReverse,
}: {
  transactions?: TransactionEntry[];
  currentUser: CurrentUser;
  onReverse?: () => void;
}) {
  const { actor } = useActor();
  const [expanded, setExpanded] = useState(false);
  const [localTxns, setLocalTxns] =
    useState<TransactionEntry[]>(getTransactions);
  const [ledgerSearch, setLedgerSearch] = useState("");

  const refresh = () => setLocalTxns(getTransactions());

  useEffect(() => {
    const id = setInterval(refresh, 3000);
    return () => clearInterval(id);
  });

  const handleReverse = (t: TransactionEntry, idx: number) => {
    if (t.reversed) return;
    const reversedBy = `${currentUser.name} @ ${new Date().toISOString()}`;
    // Update the original transaction
    const all = getTransactions();
    // Find the matching transaction by ts+member (use index as fallback)
    const txIdx = all.findIndex(
      (tx, i) => tx.ts === t.ts && tx.member === t.member && i === idx,
    );
    const targetIdx =
      txIdx !== -1
        ? txIdx
        : all.findIndex((tx) => tx.ts === t.ts && tx.member === t.member);
    if (targetIdx !== -1) {
      all[targetIdx] = { ...all[targetIdx], reversed: true, reversedBy };
      localStorage.setItem("x_transactions_v1", JSON.stringify(all));
    }
    // Create offsetting reversal transaction
    const ts = new Date().toISOString();
    const reversalEntry: TransactionEntry = {
      member: t.member,
      prevAmount: t.newAmount,
      newAmount: t.prevAmount,
      changedBy: currentUser.name,
      ts,
      description: `REVERSED: ${t.description || "FUND UPDATE"} (original: ${t.ts})`,
    };
    addTransaction(reversalEntry);
    // Restore member balance
    setFunds(t.member, t.prevAmount);
    actor?.setMemberFunds(t.member, t.prevAmount).catch(() => {});
    actor
      ?.addTransaction(
        t.member,
        t.newAmount,
        t.prevAmount,
        currentUser.name,
        ts,
        reversalEntry.description || "",
      )
      .catch(() => {});
    onReverse?.();
    refresh();
  };

  // Merge canister-polled transactions with local ones for immediate visibility
  const allTxns = (() => {
    if (!transactions) return localTxns;
    const canisterKeys = new Set(
      transactions.map((t) => `${t.ts}-${t.member}`),
    );
    const localExtra = localTxns.filter(
      (t) => !canisterKeys.has(`${t.ts}-${t.member}`),
    );
    return [...localExtra, ...transactions].sort((a, b) =>
      b.ts.localeCompare(a.ts),
    );
  })();
  const txns = ledgerSearch.trim()
    ? allTxns.filter((t) =>
        t.member.toLowerCase().includes(ledgerSearch.toLowerCase()),
      )
    : allTxns;

  return (
    <div style={{ marginBottom: "30px" }}>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          width: "100%",
          background: "transparent",
          border: "none",
          borderLeft: `5px solid ${S.red}`,
          paddingLeft: "15px",
          paddingRight: "0",
          marginBottom: expanded ? "15px" : "0",
          cursor: "pointer",
          textAlign: "left",
        }}
      >
        <h3
          style={{
            margin: 0,
            fontSize: "0.85rem",
            letterSpacing: "3px",
            color: S.red,
            fontFamily: "'JetBrains Mono', 'Courier New', monospace",
            fontWeight: 900,
            textTransform: "uppercase",
          }}
        >
          GLOBAL TRANSACTION LEDGER
        </h3>
        <span
          style={{
            color: S.red,
            fontSize: "0.75rem",
            fontFamily: "'JetBrains Mono', 'Courier New', monospace",
            fontWeight: 900,
            marginLeft: "10px",
          }}
        >
          {expanded ? "▲" : "▼"} [{txns.length}]
        </span>
      </button>

      {expanded && (
        <div
          style={{
            border: `1px solid ${S.red}44`,
            background: "#0a0000",
            padding: "10px 15px",
          }}
        >
          {/* User search */}
          <input
            type="text"
            placeholder="SEARCH BY USERNAME..."
            value={ledgerSearch}
            onChange={(e) => setLedgerSearch(e.target.value)}
            data-ocid="fund.ledger.search_input"
            style={{
              ...inputStyle,
              marginBottom: "10px",
              fontSize: "0.7rem",
              borderColor: `${S.red}66`,
            }}
          />
          {/* Column headers */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 2fr 1fr 1.5fr 80px",
              gap: "8px",
              paddingBottom: "8px",
              borderBottom: `1px solid ${S.red}44`,
              marginBottom: "6px",
            }}
          >
            {["MEMBER", "DESCRIPTION", "AMOUNT", "BY / DATE", "ACTION"].map(
              (col) => (
                <div
                  key={col}
                  style={{
                    fontSize: "0.55rem",
                    color: S.red,
                    fontWeight: 900,
                    letterSpacing: "1px",
                    textTransform: "uppercase",
                  }}
                >
                  {col}
                </div>
              ),
            )}
          </div>

          <div
            className="xution-scroll"
            style={{
              maxHeight: "300px",
              overflowY: "auto",
            }}
          >
            {txns.length === 0 ? (
              <div
                style={{
                  color: S.dim,
                  fontSize: "0.65rem",
                  textTransform: "uppercase",
                  textAlign: "center",
                  padding: "16px 0",
                }}
              >
                NO TRANSACTIONS RECORDED
              </div>
            ) : (
              txns.map((t, i) => {
                const delta = t.newAmount - t.prevAmount;
                const isPositive = delta >= 0;
                return (
                  <div
                    key={`gtx-${t.ts}-${i}`}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1fr 2fr 1fr 1.5fr 80px",
                      gap: "8px",
                      padding: "6px 0",
                      borderBottom: `1px solid ${S.brd}`,
                      alignItems: "center",
                      opacity: t.reversed ? 0.6 : 1,
                    }}
                  >
                    <div
                      style={{
                        fontSize: "0.65rem",
                        color: t.reversed ? S.dim : S.white,
                        fontWeight: 900,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        textDecoration: t.reversed ? "line-through" : "none",
                      }}
                    >
                      {t.member}
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <div
                        style={{
                          fontSize: "0.6rem",
                          color: t.description?.startsWith("PURCHASE:")
                            ? S.gold
                            : t.description?.startsWith("REVERSED:")
                              ? S.red
                              : S.dim,
                          fontWeight: 700,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                          textDecoration: t.reversed ? "line-through" : "none",
                        }}
                      >
                        {t.description || "FUND UPDATE"}
                      </div>
                      {t.reversed && (
                        <div
                          style={{
                            fontSize: "0.5rem",
                            color: S.red,
                            fontWeight: 900,
                          }}
                        >
                          [REVERSED]
                        </div>
                      )}
                    </div>
                    <div
                      style={{
                        fontSize: "0.65rem",
                        fontWeight: 900,
                        color: isPositive ? S.green : S.red,
                        textDecoration: t.reversed ? "line-through" : "none",
                      }}
                    >
                      {formatFunds(t.newAmount)}
                      <span
                        style={{
                          fontSize: "0.5rem",
                          marginLeft: "3px",
                          color: isPositive ? S.green : S.red,
                          opacity: 0.8,
                        }}
                      >
                        ({isPositive ? "+" : ""}
                        {formatFunds(delta)})
                      </span>
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <div
                        style={{
                          fontSize: "0.55rem",
                          color: S.gold,
                          fontWeight: 900,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {t.changedBy}
                      </div>
                      <div
                        style={{
                          fontSize: "0.5rem",
                          color: S.dim,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {new Date(t.ts).toLocaleString()}
                      </div>
                    </div>
                    <div>
                      <button
                        type="button"
                        disabled={!!t.reversed}
                        onClick={() => handleReverse(t, i)}
                        style={{
                          background: t.reversed ? "#1a0000" : "#2a0000",
                          border: `1px solid ${t.reversed ? "#330000" : S.red}`,
                          color: t.reversed ? "#550000" : S.red,
                          cursor: t.reversed ? "not-allowed" : "pointer",
                          fontFamily:
                            "'JetBrains Mono', 'Courier New', monospace",
                          fontWeight: 900,
                          fontSize: "0.5rem",
                          padding: "3px 6px",
                          textTransform: "uppercase",
                          letterSpacing: "1px",
                          width: "100%",
                        }}
                      >
                        {t.reversed ? "DONE" : "REVERSE"}
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── AuthScreen ───────────────────────────────────────────────────────────────

// ─── QR Login Scanner ────────────────────────────────────────────────────────

function QRLoginScanner({ onScan }: { onScan: (username: string) => void }) {
  const scanner = useQRScanner({ facingMode: "environment" });
  const [manualValue, setManualValue] = React.useState("");
  const [scanned, setScanned] = React.useState(false);

  // biome-ignore lint/correctness/useExhaustiveDependencies: intentionally run once on mount
  React.useEffect(() => {
    scanner.startScanning();
    return () => {
      scanner.stopScanning();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  React.useEffect(() => {
    if (scanner.qrResults.length > 0 && !scanned) {
      const raw = scanner.qrResults[0].data;
      setScanned(true);
      scanner.stopScanning();
      try {
        const parsed = JSON.parse(raw);
        if (parsed.username) {
          onScan(parsed.username.toUpperCase());
          return;
        }
      } catch {}
      onScan(raw.trim().toUpperCase());
    }
  }, [scanner.qrResults, scanner.stopScanning, scanned, onScan]);

  const handleManual = () => {
    const u = manualValue.trim();
    if (!u) return;
    try {
      const parsed = JSON.parse(u);
      if (parsed.username) {
        onScan(parsed.username.toUpperCase());
        return;
      }
    } catch {}
    onScan(u.toUpperCase());
  };

  return (
    <div
      style={{
        background: "#080808",
        border: "1px solid #00cfff",
        padding: "12px",
        marginTop: "8px",
      }}
    >
      {scanner.isSupported === false ? (
        <p
          style={{
            color: "#ff4444",
            fontSize: "0.65rem",
            letterSpacing: "1px",
            textAlign: "center",
          }}
        >
          ⚠ CAMERA NOT SUPPORTED ON THIS DEVICE
        </p>
      ) : scanner.error ? (
        <p
          style={{
            color: "#ff4444",
            fontSize: "0.65rem",
            letterSpacing: "1px",
            textAlign: "center",
          }}
        >
          ⚠ {String(scanner.error)}
        </p>
      ) : scanner.isLoading ? (
        <p
          style={{
            color: "#888",
            fontSize: "0.65rem",
            letterSpacing: "2px",
            textAlign: "center",
            padding: "20px 0",
          }}
        >
          INITIALIZING CAMERA...
        </p>
      ) : null}
      {scanner.isSupported !== false && (
        <div
          style={{ position: "relative", width: "100%", marginBottom: "10px" }}
        >
          <video
            ref={scanner.videoRef}
            autoPlay
            playsInline
            muted
            style={{
              width: "100%",
              height: "220px",
              objectFit: "cover",
              display: "block",
              background: "#111",
            }}
          />
          <canvas ref={scanner.canvasRef} style={{ display: "none" }} />
          {scanner.isScanning && (
            <div
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                border: "2px solid #00cfff44",
                pointerEvents: "none",
              }}
            >
              <div
                style={{
                  position: "absolute",
                  top: "50%",
                  left: "50%",
                  transform: "translate(-50%,-50%)",
                  width: "120px",
                  height: "120px",
                  border: "2px solid #00cfff",
                  boxShadow: "0 0 0 9999px rgba(0,0,0,0.35)",
                }}
              />
            </div>
          )}
        </div>
      )}
      <p
        style={{
          color: "#888",
          fontSize: "0.6rem",
          letterSpacing: "1px",
          marginBottom: "6px",
        }}
      >
        OR ENTER USERNAME MANUALLY:
      </p>
      <div style={{ display: "flex", gap: "6px" }}>
        <input
          type="text"
          placeholder='USERNAME OR {"username":"..."}'
          value={manualValue}
          onChange={(e) => setManualValue(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleManual()}
          data-ocid="auth.qr.input"
          style={{
            flex: 1,
            background: "#111",
            border: "1px solid #00cfff44",
            color: "#fff",
            padding: "7px 10px",
            fontSize: "0.7rem",
            fontFamily: "'JetBrains Mono', monospace",
            outline: "none",
          }}
        />
        <button
          type="button"
          data-ocid="auth.qr.submit_button"
          onClick={handleManual}
          style={{
            background: "#00cfff22",
            border: "1px solid #00cfff",
            color: "#00cfff",
            padding: "7px 12px",
            fontSize: "0.65rem",
            fontWeight: 900,
            letterSpacing: "1px",
            cursor: "pointer",
            fontFamily: "inherit",
          }}
        >
          USE
        </button>
      </div>
    </div>
  );
}

function AuthScreen({
  onLogin,
}: {
  onLogin: (user: CurrentUser, isOnline: boolean) => void;
}) {
  const [mode, setMode] = useState<"up" | "in">("up");
  const [name, setName] = useState("");
  const [lvl, setLvl] = useState(1);
  const [q, setQ] = useState("");
  const [a, setA] = useState("");
  const [loginA, setLoginA] = useState("");
  const [qDisp, setQDisp] = useState("");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);
  const [offlineMode, setOfflineMode] = useState(false);
  const [showQrScanner, setShowQrScanner] = useState(false);
  // Actor for backend calls (anonymous actor — no II required for auth)
  const { actor, isFetching: actorFetching } = useActor();

  // Debounce ref for security question lookup
  const qLookupTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleNameChange = useCallback(
    (val: string) => {
      setName(val);
      if (mode === "in") {
        const upper = val.trim().toUpperCase();

        // Clear previous timer
        if (qLookupTimer.current) clearTimeout(qLookupTimer.current);

        if (!upper) {
          setQDisp("");
          return;
        }

        // Try backend first, debounced 500ms, fall back to localStorage
        qLookupTimer.current = setTimeout(async () => {
          try {
            if (actor) {
              const question = await actor.getSecurityQuestion(upper);
              if (question) {
                setQDisp(`CHALLENGE: ${question}`);
                return;
              }
            }
            // Fallback to localStorage
            const db = getDB();
            if (db[upper]) {
              setQDisp(`CHALLENGE: ${db[upper].q}`);
            } else {
              setQDisp("NOT FOUND");
            }
          } catch {
            // Network offline — use localStorage
            const db = getDB();
            if (db[upper]) {
              setQDisp(`CHALLENGE: ${db[upper].q}`);
            } else {
              setQDisp("NOT FOUND");
            }
          }
        }, 500);
      }
    },
    [mode, actor],
  );

  const switchMode = (m: "up" | "in") => {
    setMode(m);
    setErr("");
    setQDisp("");
    setOfflineMode(false);
    if (qLookupTimer.current) clearTimeout(qLookupTimer.current);
  };

  const runAuth = async () => {
    const n = name.trim().toUpperCase();
    const db = getDB();
    setErr("");
    setOfflineMode(false);
    if (!n) return;

    if (mode === "up") {
      // Pre-validate locally first
      if (db[n]) {
        setErr("NAME CLAIMED");
        return;
      }
      if (!q || !a) {
        setErr("DATA MISSING");
        return;
      }

      setLoading(true);
      try {
        if (!actor) throw new Error("no actor");

        // Try backend registration
        await actor.registerUser(n, q, a.trim().toLowerCase());

        // Backend registers at level 1 by default; update if higher level selected
        if (lvl > 1) {
          await actor.updateUserLevel(n, BigInt(lvl));
        }

        // Fetch back the user to get the canonical UID
        try {
          const loggedUser = await actor.loginUser(n, a.trim().toLowerCase());
          const uid = loggedUser.uid;
          // Cache to localStorage with backend-provided uid
          const updatedDb = getDB();
          updatedDb[n] = {
            lvl: Number(loggedUser.level),
            q: loggedUser.question,
            a: loggedUser.answer,
            uid,
          };
          setDB(updatedDb);
          addActivity(`NEW ID REGISTERED: ${n}`);
          setLoading(false);
          onLogin(
            {
              name: n,
              lvl: Number(loggedUser.level),
              q: loggedUser.question,
              a: loggedUser.answer,
              uid,
            },
            true,
          );
        } catch {
          // loginUser failed after registration; generate local uid and cache
          const uid = generateUID();
          const updatedDb = getDB();
          updatedDb[n] = { lvl, q, a: a.trim().toLowerCase(), uid };
          setDB(updatedDb);
          addActivity(`NEW ID REGISTERED: ${n}`);
          setLoading(false);
          onLogin({ name: n, lvl, q, a: a.trim().toLowerCase(), uid }, true);
        }
      } catch {
        // Backend offline or error — register locally only
        setOfflineMode(true);
        const uid = generateUID();
        const record: UserRecord = { lvl, q, a: a.trim().toLowerCase(), uid };
        db[n] = record;
        setDB(db);
        addActivity(`NEW ID REGISTERED: ${n} (OFFLINE)`);
        setLoading(false);
        onLogin({ name: n, ...record }, false);
      }
    } else {
      // LOGIN mode
      const effectiveLoginA =
        n === "UNITY" ? "bacon" : loginA.trim().toLowerCase();
      setLoading(true);

      // UNITY: always bypass backend entirely — hardcoded to "bacon"
      if (n === "UNITY") {
        if (effectiveLoginA !== "bacon") {
          setErr("DENIED");
          setLoading(false);
          return;
        }
        if (!db[n]) {
          db[n] = {
            lvl: 6,
            q: "SECRET ANSWER",
            a: "bacon",
            uid: generateUID(),
          };
          setDB(db);
        } else {
          db[n].a = "bacon";
          db[n].lvl = 6;
          setDB(db);
        }
        addActivity(`ID LOGGED IN: ${n}`);
        setLoading(false);
        onLogin({ name: n, ...db[n] }, false);
        return;
      }

      try {
        if (!actor) throw new Error("no actor");

        // Try backend login
        const loggedUser = await actor.loginUser(n, effectiveLoginA);

        // Update localStorage cache with backend data
        const updatedDb = getDB();
        updatedDb[n] = {
          lvl: Number(loggedUser.level),
          q: loggedUser.question,
          a: loggedUser.answer,
          uid: loggedUser.uid,
        };
        setDB(updatedDb);
        addActivity(`ID LOGGED IN: ${n}`);
        setLoading(false);
        onLogin(
          {
            name: n,
            lvl: Number(loggedUser.level),
            q: loggedUser.question,
            a: loggedUser.answer,
            uid: loggedUser.uid,
          },
          true,
        );
      } catch {
        // Backend offline or invalid credentials — try localStorage fallback
        // UNITY always bypasses backend and password check
        if (n === "UNITY") {
          if (!db[n]) {
            db[n] = {
              lvl: 6,
              q: "SECRET ANSWER",
              a: "bacon",
              uid: generateUID(),
            };
            setDB(db);
          }
          setOfflineMode(true);
          addActivity(`ID LOGGED IN: ${n} (OFFLINE)`);
          setLoading(false);
          onLogin({ name: n, ...db[n] }, false);
          return;
        }
        if (!db[n]) {
          setErr("NOT FOUND");
          setLoading(false);
          return;
        }
        if (db[n].a !== effectiveLoginA) {
          setErr("DENIED");
          setLoading(false);
          return;
        }
        setOfflineMode(true);
        addActivity(`ID LOGGED IN: ${n} (OFFLINE)`);
        setLoading(false);
        onLogin({ name: n, ...db[n] }, false);
      }
    }
  };

  const isButtonDisabled = loading || actorFetching;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "#000",
        zIndex: 10000,
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        padding: "15px",
      }}
    >
      <div
        style={{
          border: `2px solid ${S.gold}`,
          padding: "25px",
          background: S.card,
          width: "100%",
          maxWidth: "400px",
          textAlign: "center",
          maxHeight: "90vh",
          overflowY: "auto",
        }}
      >
        <h1
          style={{
            color: S.gold,
            letterSpacing: "5px",
            marginBottom: "20px",
            margin: "0 0 20px 0",
            fontFamily: "'JetBrains Mono', 'Courier New', monospace",
          }}
        >
          XUTION
        </h1>

        {/* Tabs */}
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            marginBottom: "20px",
            borderBottom: `1px solid ${S.brd}`,
          }}
        >
          {(["up", "in"] as const).map((m) => (
            <button
              type="button"
              key={m}
              onClick={() => switchMode(m)}
              style={{
                padding: "12px",
                cursor: "pointer",
                color: mode === m ? S.gold : S.dim,
                flex: 1,
                fontSize: "0.8rem",
                background: "transparent",
                border: "none",
                borderBottom:
                  mode === m ? `3px solid ${S.gold}` : "3px solid transparent",
                fontFamily: "'JetBrains Mono', 'Courier New', monospace",
                fontWeight: 900,
                textTransform: "uppercase",
              }}
            >
              {m === "up" ? "REGISTER" : "LOGIN"}
            </button>
          ))}
        </div>

        <input
          type="text"
          placeholder="IDENTITY NAME"
          value={name}
          onChange={(e) => handleNameChange(e.target.value)}
          style={inputStyle}
          onKeyDown={(e) => e.key === "Enter" && runAuth()}
        />

        {mode === "up" && (
          <>
            <select
              value={lvl}
              onChange={(e) => setLvl(Number.parseInt(e.target.value))}
              style={selectStyle}
            >
              {Object.entries(LEVEL_NAMES).map(([val, label]) => (
                <option key={val} value={val}>
                  {label}
                </option>
              ))}
            </select>
            <input
              type="text"
              placeholder="SECURITY QUESTION"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              style={inputStyle}
            />
            <input
              type="password"
              placeholder="SECRET ANSWER"
              value={a}
              onChange={(e) => setA(e.target.value)}
              style={inputStyle}
              onKeyDown={(e) => e.key === "Enter" && runAuth()}
            />
          </>
        )}

        {mode === "in" && (
          <>
            {qDisp && (
              <p
                style={{
                  color: S.blue,
                  fontSize: "0.7rem",
                  marginBottom: "10px",
                  textAlign: "left",
                }}
              >
                {qDisp}
              </p>
            )}
            <input
              type="password"
              placeholder="SECRET ANSWER"
              value={loginA}
              onChange={(e) => setLoginA(e.target.value)}
              style={inputStyle}
              onKeyDown={(e) => e.key === "Enter" && runAuth()}
            />
          </>
        )}

        <button
          type="button"
          disabled={isButtonDisabled}
          style={{
            ...btnPrimary,
            marginTop: "15px",
            opacity: isButtonDisabled ? 0.6 : 1,
            cursor: isButtonDisabled ? "not-allowed" : "pointer",
          }}
          onClick={runAuth}
        >
          {actorFetching
            ? "INITIALIZING..."
            : loading
              ? "CONNECTING..."
              : "INITIALIZE"}
        </button>
        {(loading || actorFetching) && (
          <p
            style={{
              color: S.gold,
              fontSize: "0.7rem",
              marginTop: "12px",
              minHeight: "1.2em",
              letterSpacing: "2px",
            }}
          >
            {actorFetching
              ? "ESTABLISHING LINK..."
              : "CONNECTING TO NETWORK..."}
          </p>
        )}
        {!loading && offlineMode && (
          <p
            style={{
              color: S.blue,
              fontSize: "0.65rem",
              marginTop: "12px",
              minHeight: "1.2em",
              letterSpacing: "1px",
              opacity: 0.8,
            }}
          >
            ⚡ OFFLINE MODE — SAVED LOCALLY
          </p>
        )}
        {!loading && err && (
          <p
            style={{
              color: S.red,
              fontSize: "0.7rem",
              marginTop: "15px",
              minHeight: "1.2em",
            }}
          >
            {err}
          </p>
        )}

        {/* Divider */}
        {mode === "in" && (
          <>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "10px",
                margin: "16px 0 4px",
              }}
            >
              <div style={{ flex: 1, height: "1px", background: S.brd }} />
              <span
                style={{
                  color: S.dim,
                  fontSize: "0.6rem",
                  letterSpacing: "2px",
                }}
              >
                OR
              </span>
              <div style={{ flex: 1, height: "1px", background: S.brd }} />
            </div>
            <button
              type="button"
              data-ocid="auth.qr.button"
              onClick={() => setShowQrScanner((v) => !v)}
              style={{
                width: "100%",
                padding: "10px",
                background: showQrScanner ? S.blue : "transparent",
                border: `2px solid ${S.blue}`,
                color: showQrScanner ? "#000" : S.blue,
                fontSize: "0.7rem",
                fontWeight: 900,
                cursor: "pointer",
                letterSpacing: "2px",
                fontFamily: "inherit",
                marginTop: "4px",
              }}
            >
              📷 LOGIN WITH QR CODE
            </button>
            {showQrScanner && (
              <QRLoginScanner
                onScan={(username) => {
                  handleNameChange(username);
                  setShowQrScanner(false);
                }}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ─── Saved Emoji / GIF helpers ───────────────────────────────────────────────

function getSavedEmojis(): string[] {
  return JSON.parse(localStorage.getItem("x_saved_emojis_v1") || "[]");
}
function setSavedEmojis(list: string[]): void {
  localStorage.setItem("x_saved_emojis_v1", JSON.stringify(list));
}
function toggleSavedEmoji(emoji: string): string[] {
  const list = getSavedEmojis();
  const idx = list.indexOf(emoji);
  if (idx >= 0) list.splice(idx, 1);
  else list.unshift(emoji);
  setSavedEmojis(list);
  return [...list];
}

interface SavedGif {
  url: string;
  label: string;
}
function getSavedGifs(): SavedGif[] {
  return JSON.parse(localStorage.getItem("x_saved_gifs_v1") || "[]");
}
function setSavedGifs(list: SavedGif[]): void {
  localStorage.setItem("x_saved_gifs_v1", JSON.stringify(list));
}
function addSavedGif(url: string, label: string): SavedGif[] {
  const list = getSavedGifs();
  if (list.some((g) => g.url === url)) return list;
  list.unshift({ url, label: label || url });
  setSavedGifs(list);
  return [...list];
}
function removeSavedGif(url: string): SavedGif[] {
  const list = getSavedGifs().filter((g) => g.url !== url);
  setSavedGifs(list);
  return [...list];
}

// ─── DM Group helpers ─────────────────────────────────────────────────────────

interface CustomEmoji {
  id: string;
  name: string;
  dataUrl: string;
}
function getCustomEmojis(): CustomEmoji[] {
  return JSON.parse(localStorage.getItem("x_custom_emojis_v1") || "[]");
}
function saveCustomEmojis(list: CustomEmoji[]): void {
  localStorage.setItem("x_custom_emojis_v1", JSON.stringify(list));
}

function getDMGroups(): DMGroup[] {
  return JSON.parse(localStorage.getItem("x_dm_groups_v1") || "[]");
}
function saveDMGroups(groups: DMGroup[]): void {
  localStorage.setItem("x_dm_groups_v1", JSON.stringify(groups));
}

// ─── DMPanel ──────────────────────────────────────────────────────────────────

const EMOJI_LIST = [
  "😀",
  "😂",
  "😍",
  "😎",
  "🤔",
  "😢",
  "😡",
  "🥳",
  "🤩",
  "😴",
  "😇",
  "🥺",
  "😏",
  "🤗",
  "🤯",
  "😱",
  "🤣",
  "😜",
  "😋",
  "😬",
  "👍",
  "👎",
  "👏",
  "🙌",
  "🤝",
  "👋",
  "✌️",
  "🤞",
  "🖖",
  "💪",
  "🙏",
  "👀",
  "💀",
  "🔥",
  "💯",
  "❤️",
  "💔",
  "⭐",
  "🌟",
  "💥",
  "🎉",
  "🎊",
  "🏆",
  "🚀",
  "💡",
  "🔑",
  "🎯",
  "⚡",
  "🌈",
  "🍀",
  "🐱",
  "🐶",
  "🦁",
  "🐍",
  "🦋",
  "🌸",
  "🍕",
  "🎮",
  "📱",
  "💻",
];

function DMPanel({
  currentUser,
  target,
  onClose,
}: {
  currentUser: CurrentUser;
  target: string;
  onClose: () => void;
}) {
  const [messages, setMessages] = useState<DMMessage[]>(() =>
    getDMs(currentUser.name, target),
  );
  const [input, setInput] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [pendingAttachments, setPendingAttachments] = useState<
    (DMAttachment & { _key: number })[]
  >([]);
  const pendingKeyRef = useRef(0);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [emojiTab, setEmojiTab] = useState<"all" | "saved" | "custom">("all");
  const [savedEmojis, setSavedEmojisState] = useState<string[]>(getSavedEmojis);
  const [customEmojis, setCustomEmojisState] =
    useState<CustomEmoji[]>(getCustomEmojis);
  const customEmojiInputRef = useRef<HTMLInputElement>(null);
  const [showGifPanel, setShowGifPanel] = useState(false);
  const [gifTab, setGifTab] = useState<"add" | "saved">("add");
  const [savedGifs, setSavedGifsState] = useState<SavedGif[]>(getSavedGifs);
  const [gifUrl, setGifUrl] = useState("");
  const [gifLabel, setGifLabel] = useState("");
  const [isRecording, setIsRecording] = useState(false);
  const [recordingError, setRecordingError] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const [isFav, setIsFav] = useState(() =>
    getFavourites(currentUser.name).includes(target),
  );
  const [targetOnline, setTargetOnline] = useState(() => getPresence(target));

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const audioInputRef = useRef<HTMLInputElement>(null);

  // Poll target presence every 5 seconds
  useEffect(() => {
    const id = setInterval(() => {
      setTargetOnline(getPresence(target));
    }, 5000);
    return () => clearInterval(id);
  }, [target]);

  const handleFavToggle = () => {
    const next = toggleFavourite(currentUser.name, target);
    setIsFav(next.includes(target));
  };

  const refresh = useCallback(() => {
    setMessages(getDMs(currentUser.name, target));
  }, [currentUser.name, target]);

  // Mark as read when panel opens or new messages arrive
  // biome-ignore lint/correctness/useExhaustiveDependencies: mark read on messages change is intentional
  useEffect(() => {
    markDMRead(currentUser.name, target);
  }, [messages, currentUser.name, target]);

  // Scroll to bottom on new messages
  // biome-ignore lint/correctness/useExhaustiveDependencies: scrolling on messages change is intentional
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSend = () => {
    const text = input.trim();
    if (!text && pendingAttachments.length === 0) return;
    const attachmentsToSend: DMAttachment[] = pendingAttachments.map(
      ({ _key: _k, ...rest }) => rest,
    );
    addDM(
      currentUser.name,
      target,
      currentUser.name,
      text,
      attachmentsToSend.length > 0 ? attachmentsToSend : undefined,
    );
    setInput("");
    setPendingAttachments([]);
    setShowEmojiPicker(false);
    setShowGifPanel(false);
    refresh();
  };

  const readFileAsDataUrl = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const dataUrl = await readFileAsDataUrl(file);
    setPendingAttachments((prev) => [
      ...prev,
      {
        type: "image",
        dataUrl,
        name: file.name,
        mimeType: file.type,
        _key: ++pendingKeyRef.current,
      },
    ]);
    e.target.value = "";
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const dataUrl = await readFileAsDataUrl(file);
    setPendingAttachments((prev) => [
      ...prev,
      {
        type: "file",
        dataUrl,
        name: file.name,
        mimeType: file.type,
        _key: ++pendingKeyRef.current,
      },
    ]);
    e.target.value = "";
  };

  const handleVideoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const dataUrl = await readFileAsDataUrl(file);
    setPendingAttachments((prev) => [
      ...prev,
      {
        type: "video",
        dataUrl,
        name: file.name,
        mimeType: file.type,
        _key: ++pendingKeyRef.current,
      },
    ]);
    e.target.value = "";
  };

  const handleAudioUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const dataUrl = await readFileAsDataUrl(file);
    setPendingAttachments((prev) => [
      ...prev,
      {
        type: "audio",
        dataUrl,
        name: file.name,
        mimeType: file.type,
        _key: ++pendingKeyRef.current,
      },
    ]);
    e.target.value = "";
  };

  const handleAddGif = () => {
    if (!gifUrl.trim()) return;
    setPendingAttachments((prev) => [
      ...prev,
      { type: "gif", url: gifUrl.trim(), _key: ++pendingKeyRef.current },
    ]);
    setGifUrl("");
    setGifLabel("");
    setShowGifPanel(false);
  };

  const handleSaveGif = () => {
    if (!gifUrl.trim()) return;
    const updated = addSavedGif(
      gifUrl.trim(),
      gifLabel.trim() || gifUrl.trim(),
    );
    setSavedGifsState(updated);
    setGifUrl("");
    setGifLabel("");
  };

  const handleDeleteSavedGif = (url: string) => {
    const updated = removeSavedGif(url);
    setSavedGifsState(updated);
  };

  const handleToggleSavedEmoji = (emoji: string) => {
    const updated = toggleSavedEmoji(emoji);
    setSavedEmojisState(updated);
  };

  const handleEmojiClick = (emoji: string) => {
    setInput((prev) => prev + emoji);
  };

  const startRecording = async () => {
    setRecordingError("");
    if (!navigator.mediaDevices?.getUserMedia) {
      setRecordingError("MIC NOT SUPPORTED");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      audioChunksRef.current = [];
      mr.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };
      mr.start();
      mediaRecorderRef.current = mr;
      setIsRecording(true);
    } catch {
      setRecordingError("MIC ACCESS DENIED");
    }
  };

  const stopRecording = () => {
    const mr = mediaRecorderRef.current;
    if (!mr) return;
    mr.onstop = () => {
      const blob = new Blob(audioChunksRef.current, { type: "audio/webm" });
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result as string;
        setPendingAttachments((prev) => [
          ...prev,
          {
            type: "voice",
            dataUrl,
            mimeType: "audio/webm",
            _key: ++pendingKeyRef.current,
          },
        ]);
      };
      reader.readAsDataURL(blob);
      for (const t of mr.stream.getTracks()) t.stop();
      mediaRecorderRef.current = null;
    };
    mr.stop();
    setIsRecording(false);
  };

  const removePending = (key: number) => {
    setPendingAttachments((prev) => prev.filter((a) => a._key !== key));
  };

  const toolbarBtnStyle: React.CSSProperties = {
    width: "28px",
    height: "28px",
    background: "#111",
    border: `1px solid ${S.brd}`,
    color: S.dim,
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: "0.85rem",
    flexShrink: 0,
    padding: 0,
    fontFamily: "inherit",
  };

  // Filter messages by search
  const displayedMessages =
    searchOpen && searchQuery.trim()
      ? messages.filter(
          (m) =>
            m.text.toLowerCase().includes(searchQuery.toLowerCase()) ||
            m.from.toLowerCase().includes(searchQuery.toLowerCase()),
        )
      : messages;

  const renderAttachment = (att: DMAttachment, key: string) => {
    if (att.type === "image" || att.type === "gif") {
      const src = att.dataUrl || att.url || "";
      return (
        <img
          key={key}
          src={src}
          alt={att.name || "image"}
          style={{
            maxWidth: "100%",
            maxHeight: "180px",
            objectFit: "contain",
            display: "block",
            marginTop: "4px",
          }}
        />
      );
    }
    if (att.type === "video") {
      return (
        // biome-ignore lint/a11y/useMediaCaption: user-sent video in DM
        <video
          key={key}
          controls
          src={att.dataUrl}
          style={{
            maxWidth: "100%",
            maxHeight: "160px",
            display: "block",
            marginTop: "4px",
          }}
        />
      );
    }
    if (att.type === "audio") {
      return (
        // biome-ignore lint/a11y/useMediaCaption: user-sent audio in DM
        <audio
          key={key}
          controls
          src={att.dataUrl}
          style={{ width: "100%", marginTop: "4px" }}
        />
      );
    }
    if (att.type === "voice") {
      return (
        <div key={key} style={{ marginTop: "4px" }}>
          <div
            style={{
              fontSize: "0.55rem",
              color: S.blue,
              marginBottom: "2px",
              letterSpacing: "1px",
            }}
          >
            🎤 VOICE MSG
          </div>
          {/* biome-ignore lint/a11y/useMediaCaption: user-sent voice message in DM */}
          <audio controls src={att.dataUrl} style={{ width: "100%" }} />
        </div>
      );
    }
    if (att.type === "file") {
      return (
        <a
          key={key}
          href={att.dataUrl}
          download={att.name || "file"}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "4px",
            color: S.blue,
            fontSize: "0.65rem",
            marginTop: "4px",
            textDecoration: "none",
            fontWeight: 900,
            letterSpacing: "1px",
          }}
        >
          📁 {att.name || "FILE"}
        </a>
      );
    }
    return null;
  };

  return (
    <div
      style={{
        position: "fixed",
        bottom: "70px",
        right: "20px",
        width: "340px",
        maxWidth: "calc(100vw - 40px)",
        background: "#0a0a0a",
        border: `2px solid ${S.gold}`,
        zIndex: 9999,
        display: "flex",
        flexDirection: "column",
        fontFamily: "'JetBrains Mono', 'Courier New', monospace",
        maxHeight: "calc(100vh - 120px)",
      }}
    >
      {/* Hidden file inputs */}
      <input
        ref={imageInputRef}
        type="file"
        accept="image/*"
        style={{ display: "none" }}
        onChange={handleImageUpload}
      />
      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf,.doc,.docx,.txt,.csv,.xlsx,.zip"
        style={{ display: "none" }}
        onChange={handleFileUpload}
      />
      <input
        ref={videoInputRef}
        type="file"
        accept="video/*"
        style={{ display: "none" }}
        onChange={handleVideoUpload}
      />
      <input
        ref={audioInputRef}
        type="file"
        accept="audio/*"
        style={{ display: "none" }}
        onChange={handleAudioUpload}
      />

      {/* Header */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "10px 12px",
          borderBottom: `1px solid ${S.brd}`,
          background: "#080808",
          flexShrink: 0,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "6px",
            flex: 1,
            minWidth: 0,
            overflow: "hidden",
          }}
        >
          <span
            style={{
              color: S.gold,
              fontSize: "0.75rem",
              fontWeight: 900,
              letterSpacing: "2px",
              textTransform: "uppercase",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            DM: {target}
          </span>
          <span
            style={{
              fontSize: "0.5rem",
              fontWeight: 900,
              letterSpacing: "1px",
              color: targetOnline ? S.green : "#444",
              flexShrink: 0,
              whiteSpace: "nowrap",
            }}
          >
            {targetOnline ? "● ONLINE" : "○ OFFLINE"}
          </span>
        </div>
        {/* Search toggle */}
        <button
          type="button"
          title="SEARCH MESSAGES"
          onClick={() => {
            setSearchOpen((o) => !o);
            setSearchQuery("");
          }}
          style={{
            ...toolbarBtnStyle,
            background: searchOpen ? "#1a1500" : "#111",
            color: searchOpen ? S.gold : S.dim,
            border: "none",
            marginRight: "2px",
          }}
        >
          🔍
        </button>
        <button
          type="button"
          title={isFav ? "REMOVE FAVOURITE" : "ADD FAVOURITE"}
          onClick={handleFavToggle}
          style={{
            background: "transparent",
            border: "none",
            cursor: "pointer",
            padding: "2px 6px",
            color: isFav ? S.gold : S.dim,
            fontSize: "1rem",
            lineHeight: 1,
            flexShrink: 0,
          }}
        >
          {isFav ? "★" : "☆"}
        </button>
        <button
          type="button"
          onClick={onClose}
          style={{
            background: "transparent",
            border: "none",
            color: S.dim,
            cursor: "pointer",
            fontFamily: "'JetBrains Mono', 'Courier New', monospace",
            fontWeight: 900,
            fontSize: "0.85rem",
            padding: "2px 6px",
            textTransform: "uppercase",
            flexShrink: 0,
          }}
        >
          [X]
        </button>
      </div>

      {/* Search bar */}
      {searchOpen && (
        <div
          style={{
            padding: "6px 10px",
            borderBottom: `1px solid ${S.brd}`,
            background: "#080808",
            flexShrink: 0,
          }}
        >
          <input
            type="text"
            placeholder="SEARCH MESSAGES..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{
              ...inputStyle,
              margin: 0,
              fontSize: "0.7rem",
              padding: "6px 8px",
            }}
          />
        </div>
      )}

      {/* Message history */}
      <div
        ref={scrollRef}
        className="xution-scroll"
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "10px 12px",
          display: "flex",
          flexDirection: "column",
          gap: "6px",
          minHeight: 0,
          maxHeight: "280px",
        }}
      >
        {displayedMessages.length === 0 ? (
          <div
            style={{
              color: S.dim,
              fontSize: "0.65rem",
              textAlign: "center",
              padding: "20px 0",
              textTransform: "uppercase",
            }}
          >
            {searchOpen && searchQuery ? "NO RESULTS" : "NO MESSAGES YET"}
          </div>
        ) : (
          displayedMessages.map((msg, i) => {
            const isOwn = msg.from === currentUser.name;
            return (
              <div
                key={`dm-${msg.ts}-${i}`}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: isOwn ? "flex-end" : "flex-start",
                }}
              >
                <div
                  style={{
                    fontSize: "0.6rem",
                    color: S.dim,
                    marginBottom: "2px",
                    textTransform: "uppercase",
                  }}
                >
                  {msg.from}
                </div>
                <div
                  style={{
                    fontSize: "0.7rem",
                    color: isOwn ? S.gold : S.white,
                    background: isOwn ? "#1a1500" : "#111",
                    padding: "5px 8px",
                    maxWidth: "90%",
                    wordBreak: "break-word",
                    textTransform: "uppercase",
                    fontWeight: 900,
                    border: isOwn
                      ? `1px solid ${S.gold}33`
                      : `1px solid ${S.brd}`,
                  }}
                >
                  {msg.text && <span>{msg.text}</span>}
                  {msg.attachments?.map((att, ai) =>
                    renderAttachment(att, `att-${i}-${ai}`),
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Input area */}
      <div style={{ borderTop: `1px solid ${S.brd}`, flexShrink: 0 }}>
        {/* Pending attachments preview */}
        {pendingAttachments.length > 0 && (
          <div
            style={{
              padding: "6px 10px",
              borderBottom: `1px solid ${S.brd}`,
              display: "flex",
              flexWrap: "wrap",
              gap: "5px",
            }}
          >
            {pendingAttachments.map((att) => (
              <div
                key={att._key}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "3px",
                  border: `1px solid ${S.gold}55`,
                  background: "#0a0800",
                  padding: "3px 6px",
                  fontSize: "0.6rem",
                  color: S.gold,
                  letterSpacing: "0.5px",
                }}
              >
                {att.type === "image" && att.dataUrl && (
                  <img
                    src={att.dataUrl}
                    alt=""
                    style={{
                      width: "32px",
                      height: "32px",
                      objectFit: "cover",
                    }}
                  />
                )}
                {att.type === "gif" && (
                  <img
                    src={att.url}
                    alt="gif"
                    style={{
                      width: "32px",
                      height: "32px",
                      objectFit: "cover",
                    }}
                  />
                )}
                {att.type === "video" && <span>🎬</span>}
                {att.type === "audio" && <span>🎵</span>}
                {att.type === "voice" && <span>🎤</span>}
                {att.type === "file" && <span>📁</span>}
                <span
                  style={{
                    maxWidth: "60px",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {att.name || att.type.toUpperCase()}
                </span>
                <button
                  type="button"
                  onClick={() => removePending(att._key)}
                  style={{
                    background: "none",
                    border: "none",
                    color: S.red,
                    cursor: "pointer",
                    padding: "0 2px",
                    fontSize: "0.7rem",
                    lineHeight: 1,
                  }}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}

        {/* GIF panel */}
        {showGifPanel && (
          <div
            style={{
              borderBottom: `1px solid ${S.brd}`,
              background: "#080808",
            }}
          >
            {/* Tabs */}
            <div
              style={{ display: "flex", borderBottom: `1px solid ${S.brd}` }}
            >
              {(["add", "saved"] as const).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setGifTab(tab)}
                  style={{
                    flex: 1,
                    padding: "5px",
                    background: "transparent",
                    border: "none",
                    borderBottom:
                      gifTab === tab
                        ? `2px solid ${S.gold}`
                        : "2px solid transparent",
                    color: gifTab === tab ? S.gold : S.dim,
                    fontSize: "0.6rem",
                    fontWeight: 900,
                    cursor: "pointer",
                    fontFamily: "inherit",
                    textTransform: "uppercase",
                    letterSpacing: "1px",
                  }}
                >
                  {tab === "add" ? "ADD GIF" : `SAVED (${savedGifs.length})`}
                </button>
              ))}
            </div>

            {gifTab === "add" && (
              <div
                style={{
                  padding: "6px 10px",
                  display: "flex",
                  flexDirection: "column",
                  gap: "4px",
                }}
              >
                <input
                  type="text"
                  placeholder="PASTE GIF URL..."
                  value={gifUrl}
                  onChange={(e) => setGifUrl(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleAddGif()}
                  style={{
                    ...inputStyle,
                    margin: 0,
                    fontSize: "0.65rem",
                    padding: "5px 7px",
                  }}
                />
                <input
                  type="text"
                  placeholder="LABEL (OPTIONAL)..."
                  value={gifLabel}
                  onChange={(e) => setGifLabel(e.target.value)}
                  style={{
                    ...inputStyle,
                    margin: 0,
                    fontSize: "0.65rem",
                    padding: "5px 7px",
                  }}
                />
                <div style={{ display: "flex", gap: "5px" }}>
                  <button
                    type="button"
                    onClick={handleAddGif}
                    style={{
                      flex: 1,
                      background: S.gold,
                      color: "#000",
                      border: "none",
                      padding: "5px",
                      fontWeight: 900,
                      cursor: "pointer",
                      fontSize: "0.65rem",
                      letterSpacing: "1px",
                      fontFamily: "inherit",
                      textTransform: "uppercase",
                    }}
                  >
                    SEND
                  </button>
                  <button
                    type="button"
                    onClick={handleSaveGif}
                    style={{
                      flex: 1,
                      background: "#1a1500",
                      color: S.gold,
                      border: `1px solid ${S.gold}55`,
                      padding: "5px",
                      fontWeight: 900,
                      cursor: "pointer",
                      fontSize: "0.65rem",
                      letterSpacing: "1px",
                      fontFamily: "inherit",
                      textTransform: "uppercase",
                    }}
                  >
                    SAVE
                  </button>
                </div>
              </div>
            )}

            {gifTab === "saved" && (
              <div
                className="xution-scroll"
                style={{
                  maxHeight: "160px",
                  overflowY: "auto",
                  padding: "6px 10px",
                }}
              >
                {savedGifs.length === 0 ? (
                  <div
                    style={{
                      color: S.dim,
                      fontSize: "0.6rem",
                      textAlign: "center",
                      padding: "12px 0",
                      letterSpacing: "1px",
                    }}
                  >
                    NO SAVED GIFS
                  </div>
                ) : (
                  savedGifs.map((gif) => (
                    <div
                      key={gif.url}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "6px",
                        padding: "4px 0",
                        borderBottom: `1px solid ${S.brd}`,
                      }}
                    >
                      <button
                        type="button"
                        onClick={() => {
                          setPendingAttachments((prev) => [
                            ...prev,
                            {
                              type: "gif",
                              url: gif.url,
                              _key: ++pendingKeyRef.current,
                            },
                          ]);
                          setShowGifPanel(false);
                        }}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "6px",
                          flex: 1,
                          background: "none",
                          border: "none",
                          cursor: "pointer",
                          padding: 0,
                          minWidth: 0,
                        }}
                      >
                        <img
                          src={gif.url}
                          alt={gif.label}
                          style={{
                            width: "40px",
                            height: "40px",
                            objectFit: "cover",
                            flexShrink: 0,
                          }}
                        />
                        <span
                          style={{
                            flex: 1,
                            fontSize: "0.6rem",
                            color: S.white,
                            letterSpacing: "0.5px",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                            textAlign: "left",
                          }}
                        >
                          {gif.label}
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteSavedGif(gif.url)}
                        style={{
                          background: "none",
                          border: "none",
                          color: S.red,
                          cursor: "pointer",
                          fontSize: "0.7rem",
                          padding: "2px 4px",
                          flexShrink: 0,
                        }}
                        title="DELETE"
                      >
                        ✕
                      </button>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        )}

        {/* Emoji picker */}
        {showEmojiPicker && (
          <div
            style={{
              borderBottom: `1px solid ${S.brd}`,
              background: "#080808",
            }}
          >
            {/* Tabs */}
            <div
              style={{ display: "flex", borderBottom: `1px solid ${S.brd}` }}
            >
              {(["all", "saved", "custom"] as const).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setEmojiTab(tab)}
                  style={{
                    flex: 1,
                    padding: "5px",
                    background: "transparent",
                    border: "none",
                    borderBottom:
                      emojiTab === tab
                        ? `2px solid ${S.gold}`
                        : "2px solid transparent",
                    color: emojiTab === tab ? S.gold : S.dim,
                    fontSize: "0.6rem",
                    fontWeight: 900,
                    cursor: "pointer",
                    fontFamily: "inherit",
                    textTransform: "uppercase",
                    letterSpacing: "1px",
                  }}
                >
                  {tab === "all"
                    ? "ALL"
                    : tab === "saved"
                      ? `SAVED (${savedEmojis.length})`
                      : `CUSTOM (${customEmojis.length})`}
                </button>
              ))}
            </div>

            <div
              className="xution-scroll"
              style={{
                padding: "6px 10px",
                maxHeight: "130px",
                overflowY: "auto",
              }}
            >
              {emojiTab === "custom" ? (
                <div>
                  {/* Upload custom emoji */}
                  <div
                    style={{
                      display: "flex",
                      gap: "6px",
                      padding: "6px 0 8px",
                    }}
                  >
                    <input
                      ref={customEmojiInputRef}
                      type="file"
                      accept="image/*"
                      style={{ display: "none" }}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        const reader = new FileReader();
                        reader.onload = () => {
                          const dataUrl = reader.result as string;
                          const name =
                            file.name.replace(/\.[^.]+$/, "") || "emoji";
                          const newEmoji: CustomEmoji = {
                            id: `ce_${Date.now()}`,
                            name,
                            dataUrl,
                          };
                          const updated = [...customEmojis, newEmoji];
                          saveCustomEmojis(updated);
                          setCustomEmojisState(updated);
                        };
                        reader.readAsDataURL(file);
                        e.target.value = "";
                      }}
                    />
                    <button
                      type="button"
                      data-ocid="emoji.upload_button"
                      onClick={() => customEmojiInputRef.current?.click()}
                      style={{
                        background: S.gold,
                        border: "none",
                        color: "#000",
                        cursor: "pointer",
                        fontSize: "0.65rem",
                        fontWeight: 900,
                        padding: "4px 10px",
                        fontFamily: "inherit",
                        letterSpacing: "1px",
                        flex: 1,
                      }}
                    >
                      + UPLOAD EMOJI
                    </button>
                  </div>
                  {customEmojis.length === 0 ? (
                    <div
                      style={{
                        color: S.dim,
                        fontSize: "0.6rem",
                        textAlign: "center",
                        padding: "8px 0",
                        letterSpacing: "1px",
                      }}
                    >
                      NO CUSTOM EMOJIS YET
                    </div>
                  ) : (
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "repeat(5, 1fr)",
                        gap: "4px",
                      }}
                    >
                      {customEmojis.map((ce) => (
                        <div key={ce.id} style={{ position: "relative" }}>
                          <button
                            type="button"
                            title={ce.name}
                            onClick={() => {
                              setPendingAttachments((prev) => [
                                ...prev,
                                {
                                  _key: pendingKeyRef.current++,
                                  type: "image" as const,
                                  dataUrl: ce.dataUrl,
                                  name: ce.name,
                                },
                              ]);
                              setShowEmojiPicker(false);
                            }}
                            style={{
                              background: "transparent",
                              border: "1px solid #333",
                              cursor: "pointer",
                              padding: "2px",
                              width: "100%",
                              aspectRatio: "1",
                            }}
                          >
                            <img
                              src={ce.dataUrl}
                              alt={ce.name}
                              style={{
                                width: "100%",
                                height: "100%",
                                objectFit: "contain",
                              }}
                            />
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              const updated = customEmojis.filter(
                                (x) => x.id !== ce.id,
                              );
                              saveCustomEmojis(updated);
                              setCustomEmojisState(updated);
                            }}
                            style={{
                              position: "absolute",
                              top: "-3px",
                              right: "-3px",
                              background: S.red,
                              border: "none",
                              color: "#fff",
                              fontSize: "0.45rem",
                              width: "12px",
                              height: "12px",
                              borderRadius: "50%",
                              cursor: "pointer",
                              padding: 0,
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                            }}
                          >
                            ✕
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ) : emojiTab === "saved" && savedEmojis.length === 0 ? (
                <div
                  style={{
                    color: S.dim,
                    fontSize: "0.6rem",
                    textAlign: "center",
                    padding: "12px 0",
                    letterSpacing: "1px",
                  }}
                >
                  NO SAVED EMOJIS — HOLD ANY EMOJI TO SAVE
                </div>
              ) : (
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(6, 1fr)",
                    gap: "3px",
                  }}
                >
                  {(emojiTab === "all" ? EMOJI_LIST : savedEmojis).map(
                    (emoji) => {
                      const isSaved = savedEmojis.includes(emoji);
                      return (
                        <div key={emoji} style={{ position: "relative" }}>
                          <button
                            type="button"
                            onClick={() => handleEmojiClick(emoji)}
                            onContextMenu={(e) => {
                              e.preventDefault();
                              handleToggleSavedEmoji(emoji);
                            }}
                            title={
                              isSaved
                                ? "Right-click to unsave"
                                : "Right-click to save"
                            }
                            style={{
                              background: isSaved ? "#1a1500" : "transparent",
                              border: isSaved
                                ? `1px solid ${S.gold}33`
                                : "none",
                              cursor: "pointer",
                              fontSize: "1.1rem",
                              padding: "3px",
                              textAlign: "center",
                              borderRadius: "3px",
                              width: "100%",
                            }}
                            onMouseEnter={(e) => {
                              if (!isSaved)
                                (
                                  e.currentTarget as HTMLButtonElement
                                ).style.background = "#222";
                            }}
                            onMouseLeave={(e) => {
                              if (!isSaved)
                                (
                                  e.currentTarget as HTMLButtonElement
                                ).style.background = "transparent";
                            }}
                          >
                            {emoji}
                          </button>
                          {isSaved && emojiTab === "saved" && (
                            <button
                              type="button"
                              onClick={() => handleToggleSavedEmoji(emoji)}
                              style={{
                                position: "absolute",
                                top: "-3px",
                                right: "-3px",
                                background: S.red,
                                border: "none",
                                color: "#fff",
                                fontSize: "0.45rem",
                                width: "12px",
                                height: "12px",
                                borderRadius: "50%",
                                cursor: "pointer",
                                padding: 0,
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                lineHeight: 1,
                              }}
                            >
                              ✕
                            </button>
                          )}
                        </div>
                      );
                    },
                  )}
                </div>
              )}
            </div>
            {emojiTab === "all" && (
              <div
                style={{
                  padding: "3px 10px 5px",
                  fontSize: "0.5rem",
                  color: S.dim,
                  letterSpacing: "0.5px",
                }}
              >
                RIGHT-CLICK ANY EMOJI TO SAVE/UNSAVE IT
              </div>
            )}
          </div>
        )}

        {/* Recording indicator */}
        {isRecording && (
          <div
            style={{
              padding: "5px 10px",
              background: "#1a0000",
              borderBottom: `1px solid ${S.red}`,
              fontSize: "0.6rem",
              color: S.red,
              letterSpacing: "2px",
              fontWeight: 900,
            }}
          >
            ● RECORDING...
          </div>
        )}
        {recordingError && (
          <div
            style={{
              padding: "4px 10px",
              background: "#1a0000",
              borderBottom: `1px solid ${S.red}`,
              fontSize: "0.55rem",
              color: S.red,
              letterSpacing: "1px",
            }}
          >
            {recordingError}
          </div>
        )}

        {/* Attachment toolbar */}
        <div
          style={{
            display: "flex",
            gap: "4px",
            padding: "6px 10px",
            borderBottom: `1px solid ${S.brd}`,
            overflowX: "auto",
            background: "#060606",
            flexShrink: 0,
          }}
        >
          <button
            type="button"
            title="IMAGE"
            onClick={() => imageInputRef.current?.click()}
            style={toolbarBtnStyle}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLButtonElement).style.color = S.gold;
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.color = S.dim;
            }}
          >
            📷
          </button>
          <button
            type="button"
            title="FILE"
            onClick={() => fileInputRef.current?.click()}
            style={toolbarBtnStyle}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLButtonElement).style.color = S.gold;
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.color = S.dim;
            }}
          >
            📁
          </button>
          <button
            type="button"
            title="VIDEO"
            onClick={() => videoInputRef.current?.click()}
            style={toolbarBtnStyle}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLButtonElement).style.color = S.gold;
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.color = S.dim;
            }}
          >
            🎬
          </button>
          <button
            type="button"
            title="AUDIO"
            onClick={() => audioInputRef.current?.click()}
            style={toolbarBtnStyle}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLButtonElement).style.color = S.gold;
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.color = S.dim;
            }}
          >
            🎵
          </button>
          <button
            type="button"
            title="GIF"
            onClick={() => {
              setShowGifPanel((o) => !o);
              setShowEmojiPicker(false);
            }}
            style={{
              ...toolbarBtnStyle,
              ...(showGifPanel ? { background: "#1a1500", color: S.gold } : {}),
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLButtonElement).style.color = S.gold;
            }}
            onMouseLeave={(e) => {
              if (!showGifPanel)
                (e.currentTarget as HTMLButtonElement).style.color = S.dim;
            }}
          >
            🌀
          </button>
          <button
            type="button"
            title="EMOJI"
            onClick={() => {
              setShowEmojiPicker((o) => !o);
              setShowGifPanel(false);
            }}
            style={{
              ...toolbarBtnStyle,
              ...(showEmojiPicker
                ? { background: "#1a1500", color: S.gold }
                : {}),
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLButtonElement).style.color = S.gold;
            }}
            onMouseLeave={(e) => {
              if (!showEmojiPicker)
                (e.currentTarget as HTMLButtonElement).style.color = S.dim;
            }}
          >
            😊
          </button>
          <button
            type="button"
            title="HOLD TO RECORD VOICE"
            onMouseDown={startRecording}
            onMouseUp={stopRecording}
            onTouchStart={startRecording}
            onTouchEnd={stopRecording}
            style={{
              ...toolbarBtnStyle,
              ...(isRecording
                ? {
                    background: "#1a0000",
                    color: S.red,
                    border: `1px solid ${S.red}`,
                  }
                : {}),
            }}
            onMouseEnter={(e) => {
              if (!isRecording)
                (e.currentTarget as HTMLButtonElement).style.color = S.gold;
            }}
            onMouseLeave={(e) => {
              if (!isRecording)
                (e.currentTarget as HTMLButtonElement).style.color = S.dim;
            }}
          >
            🎤
          </button>
        </div>

        {/* Text input + send */}
        <div
          style={{
            display: "flex",
            gap: 0,
          }}
        >
          <input
            type="text"
            placeholder="TYPE MESSAGE..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSend()}
            style={{
              ...inputStyle,
              margin: 0,
              flex: 1,
              fontSize: "0.75rem",
              padding: "10px",
              border: "none",
              borderRight: `1px solid ${S.brd}`,
            }}
          />
          <button
            type="button"
            onClick={handleSend}
            style={{
              background: S.gold,
              color: "#000",
              border: "none",
              padding: "10px 14px",
              fontWeight: 900,
              cursor: "pointer",
              fontFamily: "'JetBrains Mono', 'Courier New', monospace",
              fontSize: "0.7rem",
              textTransform: "uppercase",
              letterSpacing: "1px",
              flexShrink: 0,
            }}
          >
            SEND
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── MemberRow ────────────────────────────────────────────────────────────────

function MemberRow({
  memberName,
  db,
  currentUser,
  isFav,
  onDM,
  onFavToggle,
  xutNumbers,
}: {
  memberName: string;
  db: UserDB;
  currentUser: CurrentUser;
  isFav: boolean;
  lockdown: boolean;
  onDM: (name: string) => void;
  onFavToggle: (name: string) => void;
  onChangeLvl: (name: string, change: number) => void;
  onDel: (name: string) => void;
  xutNumbers?: Record<string, string>;
}) {
  const isSelf = memberName === currentUser.name;
  const [unread, setUnread] = useState(() =>
    isSelf ? 0 : getDMUnreadCount(currentUser.name, memberName),
  );
  const [memberOnline, setMemberOnline] = useState(() =>
    getPresence(memberName),
  );

  // Poll for new messages every 3 seconds
  useEffect(() => {
    if (isSelf) return;
    const id = setInterval(() => {
      setUnread(getDMUnreadCount(currentUser.name, memberName));
    }, 3000);
    return () => clearInterval(id);
  }, [memberName, currentUser.name, isSelf]);

  // Poll presence every 5 seconds
  useEffect(() => {
    const id = setInterval(() => {
      setMemberOnline(getPresence(memberName));
    }, 5000);
    return () => clearInterval(id);
  }, [memberName]);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        padding: "12px 15px",
        borderBottom: `1px solid ${S.brd}`,
        gap: "8px",
        background: isFav ? "#0a0800" : "transparent",
      }}
    >
      {/* Name + tags row */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: "8px",
        }}
      >
        {/* Star favourite button */}
        {!isSelf && (
          <button
            type="button"
            title={isFav ? "REMOVE FAVOURITE" : "ADD FAVOURITE"}
            onClick={() => onFavToggle(memberName)}
            style={{
              background: "transparent",
              border: "none",
              cursor: "pointer",
              padding: "0 4px 0 0",
              color: isFav ? S.gold : S.dim,
              fontSize: "1rem",
              lineHeight: 1,
              flexShrink: 0,
            }}
          >
            {isFav ? "★" : "☆"}
          </button>
        )}

        <span
          role={isSelf ? undefined : "button"}
          tabIndex={isSelf ? undefined : 0}
          onClick={() => !isSelf && onDM(memberName)}
          onKeyDown={(e) => {
            if (!isSelf && (e.key === "Enter" || e.key === " "))
              onDM(memberName);
          }}
          style={{
            fontSize: "0.85rem",
            color: isSelf ? S.gold : S.blue,
            fontWeight: 900,
            cursor: isSelf ? "default" : "pointer",
            textDecoration: isSelf ? "none" : "underline",
            textUnderlineOffset: "3px",
            flex: 1,
            minWidth: 0,
          }}
          title={isSelf ? undefined : `DM ${memberName}`}
        >
          {memberName} [L{db[memberName]?.lvl ?? "?"}]
          {(db[memberName]?.lvl ?? 0) >= 5 && xutNumbers?.[memberName] && (
            <span
              style={{
                color: S.gold,
                fontSize: "0.55rem",
                marginLeft: "6px",
                fontWeight: 900,
                letterSpacing: "1px",
              }}
            >
              XUT#{xutNumbers[memberName]}
            </span>
          )}
          {/* Presence badge */}
          <span
            style={{
              color: memberOnline ? "#00ff41" : "#444",
              fontSize: "0.55rem",
              marginLeft: "8px",
              fontWeight: 900,
              letterSpacing: "0.5px",
            }}
          >
            {memberOnline ? "● ONLINE" : "○ OFFLINE"}
          </span>
          {isSelf && (
            <span
              style={{
                color: S.green,
                fontSize: "0.6rem",
                marginLeft: "8px",
              }}
            >
              ◈ YOU
            </span>
          )}
        </span>

        {/* Unread badge */}
        {!isSelf && unread > 0 && (
          <span
            style={{
              background: S.red,
              color: "#fff",
              fontSize: "0.55rem",
              fontWeight: 900,
              borderRadius: "10px",
              padding: "2px 6px",
              letterSpacing: "0.5px",
              flexShrink: 0,
            }}
          >
            {unread} NEW
          </span>
        )}

        {IMMUNE.includes(memberName) && (
          <span
            style={{
              color: S.blue,
              fontSize: "0.6rem",
              border: `1px solid ${S.blue}`,
              padding: "2px 5px",
              flexShrink: 0,
            }}
          >
            IMMUTABLE
          </span>
        )}
      </div>

      {/* Action buttons */}
      {!isSelf && (
        <div style={{ display: "flex", gap: "5px", width: "100%" }}>
          <button
            type="button"
            style={{
              ...btnSmall,
              background: S.blue,
              color: "#000",
            }}
            onClick={() => onDM(memberName)}
          >
            DM
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Total unread DM helper ───────────────────────────────────────────────────

function getTotalUnreadDMs(me: string): number {
  const db = getDB();
  return Object.keys(db)
    .filter((n) => n !== me)
    .reduce((sum, n) => sum + getDMUnreadCount(me, n), 0);
}

// ─── OfficeLocations ──────────────────────────────────────────────────────────

function OfficeLocations({
  currentUser,
  onSelect,
  selectedId,
}: {
  currentUser: CurrentUser;
  onSelect?: (office: OfficeLocation | null) => void;
  selectedId?: string | null;
}) {
  const { actor } = useActor();
  const isSovereign = currentUser.lvl === 6;
  const [locations, setLocations] =
    useState<OfficeLocation[]>(getOfficeLocations);
  const [favs, setFavs] = useState<string[]>(() =>
    getOfficeFavs(currentUser.name),
  );
  const [addOpen, setAddOpen] = useState(false);
  const [addName, setAddName] = useState("");
  const [addFloor, setAddFloor] = useState("");
  const [addDesc, setAddDesc] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editFloor, setEditFloor] = useState("");
  const [editDesc, setEditDesc] = useState("");

  const handleToggle = (officeId: string) => {
    const next = toggleOfficeFav(currentUser.name, officeId);
    setFavs(next);
  };

  const handleAdd = () => {
    const name = addName.trim();
    const floor = addFloor.trim();
    if (!name) return;
    const newOffice: OfficeLocation = {
      id: `OFC-${Date.now()}`,
      name,
      floor: floor || "–",
      desc: addDesc.trim(),
    };
    const updated = [...locations, newOffice];
    setOfficeLocations(updated);
    setLocations(updated);
    setAddName("");
    setAddFloor("");
    setAddDesc("");
    setAddOpen(false);
    actor?.setOfficeLocations(JSON.stringify(updated)).catch(() => {});
  };

  const startEdit = (office: OfficeLocation) => {
    setEditingId(office.id);
    setEditName(office.name);
    setEditFloor(office.floor);
    setEditDesc(office.desc);
  };

  const saveEdit = (officeId: string) => {
    const name = editName.trim();
    if (!name) return;
    const updated = locations.map((o) =>
      o.id === officeId
        ? { ...o, name, floor: editFloor.trim() || "–", desc: editDesc.trim() }
        : o,
    );
    setOfficeLocations(updated);
    setLocations(updated);
    setEditingId(null);
    actor?.setOfficeLocations(JSON.stringify(updated)).catch(() => {});
  };

  const handleDelete = (officeId: string) => {
    if (!window.confirm("DELETE THIS OFFICE LOCATION?")) return;
    const updated = locations.filter((o) => o.id !== officeId);
    setOfficeLocations(updated);
    setLocations(updated);
    const newFavs = favs.filter((f) => f !== officeId);
    if (newFavs.length !== favs.length) {
      localStorage.setItem(
        getOfficeFavsKey(currentUser.name),
        JSON.stringify(newFavs),
      );
      setFavs(newFavs);
    }
    actor?.setOfficeLocations(JSON.stringify(updated)).catch(() => {});
  };

  const favourites = locations.filter((o) => favs.includes(o.id));
  const others = locations.filter((o) => !favs.includes(o.id));
  const ordered = [...favourites, ...others];

  return (
    <div
      style={{
        borderTop: `1px solid ${S.brd}`,
        paddingTop: "15px",
        marginBottom: "20px",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: "12px",
        }}
      >
        <p
          style={{
            color: S.gold,
            fontSize: "0.7rem",
            margin: 0,
            letterSpacing: "3px",
            fontWeight: 900,
          }}
        >
          OFFICE LOCATIONS
        </p>
        {isSovereign && (
          <button
            type="button"
            data-ocid="office.add_button"
            onClick={() => setAddOpen((v) => !v)}
            style={{
              ...btnSmall,
              background: addOpen ? "#0a0800" : S.gold,
              color: addOpen ? S.gold : "#000",
              border: `1px solid ${S.gold}`,
              padding: "4px 10px",
              flex: "none",
              fontSize: "0.6rem",
            }}
          >
            {addOpen ? "CANCEL ▲" : "+ ADD OFFICE"}
          </button>
        )}
      </div>

      {isSovereign && addOpen && (
        <div
          style={{
            border: `1px solid ${S.gold}44`,
            background: "#0a0800",
            padding: "12px",
            marginBottom: "12px",
          }}
        >
          <input
            type="text"
            placeholder="OFFICE NAME"
            value={addName}
            onChange={(e) => setAddName(e.target.value)}
            data-ocid="office.add.name_input"
            style={{ ...inputStyle, marginBottom: "0" }}
          />
          <input
            type="text"
            placeholder="FLOOR / LOCATION"
            value={addFloor}
            onChange={(e) => setAddFloor(e.target.value)}
            data-ocid="office.add.floor_input"
            style={{ ...inputStyle, marginBottom: "0" }}
          />
          <input
            type="text"
            placeholder="DESCRIPTION (OPTIONAL)"
            value={addDesc}
            onChange={(e) => setAddDesc(e.target.value)}
            data-ocid="office.add.desc_input"
            style={{ ...inputStyle, marginBottom: "0" }}
            onKeyDown={(e) => e.key === "Enter" && handleAdd()}
          />
          <button
            type="button"
            data-ocid="office.add.submit_button"
            style={{ ...btnPrimary, marginTop: "10px" }}
            onClick={handleAdd}
          >
            ADD OFFICE
          </button>
        </div>
      )}

      {favourites.length > 0 && (
        <div
          style={{
            padding: "4px 10px",
            background: "#0d0b00",
            border: `1px solid ${S.gold}33`,
            fontSize: "0.55rem",
            color: S.gold,
            letterSpacing: "3px",
            fontWeight: 900,
            marginBottom: "6px",
          }}
        >
          ★ FAVOURITES
        </div>
      )}

      {ordered.length === 0 && (
        <p style={{ color: S.dim, fontSize: "0.65rem", letterSpacing: "2px" }}>
          NO OFFICE LOCATIONS
        </p>
      )}

      {ordered.map((office, idx) => {
        const isFav = favs.includes(office.id);
        const isEditing = editingId === office.id;
        const isSelected = selectedId === office.id;
        return (
          <div
            key={office.id}
            data-ocid={`office.item.${idx + 1}`}
            style={{
              padding: "10px 12px",
              marginBottom: "6px",
              background: isSelected
                ? "#0d1a00"
                : isFav
                  ? "#0a0800"
                  : "#050505",
              border: `1px solid ${isSelected ? S.green : isFav ? `${S.gold}55` : S.brd}`,
              cursor: onSelect && !isEditing ? "pointer" : "default",
            }}
            onClick={() => {
              if (!onSelect || isEditing) return;
              onSelect(isSelected ? null : office);
            }}
            onKeyDown={(e) => {
              if (!onSelect || isEditing) return;
              if (e.key === "Enter" || e.key === " ")
                onSelect(isSelected ? null : office);
            }}
          >
            {isEditing ? (
              <div
                style={{ display: "flex", flexDirection: "column", gap: "6px" }}
              >
                <input
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  placeholder="OFFICE NAME"
                  data-ocid={`office.edit.name_input.${idx + 1}`}
                  style={{
                    ...inputStyle,
                    margin: 0,
                    fontSize: "0.75rem",
                    padding: "6px 10px",
                  }}
                />
                <input
                  type="text"
                  value={editFloor}
                  onChange={(e) => setEditFloor(e.target.value)}
                  placeholder="FLOOR / LOCATION"
                  data-ocid={`office.edit.floor_input.${idx + 1}`}
                  style={{
                    ...inputStyle,
                    margin: 0,
                    fontSize: "0.75rem",
                    padding: "6px 10px",
                  }}
                />
                <input
                  type="text"
                  value={editDesc}
                  onChange={(e) => setEditDesc(e.target.value)}
                  placeholder="DESCRIPTION"
                  data-ocid={`office.edit.desc_input.${idx + 1}`}
                  style={{
                    ...inputStyle,
                    margin: 0,
                    fontSize: "0.75rem",
                    padding: "6px 10px",
                  }}
                  onKeyDown={(e) => e.key === "Enter" && saveEdit(office.id)}
                />
                <div style={{ display: "flex", gap: "6px" }}>
                  <button
                    type="button"
                    data-ocid={`office.edit.save_button.${idx + 1}`}
                    style={{
                      ...btnSmall,
                      background: S.gold,
                      color: "#000",
                      padding: "6px 12px",
                      flex: "none",
                    }}
                    onClick={(e) => {
                      e.stopPropagation();
                      saveEdit(office.id);
                    }}
                  >
                    SAVE
                  </button>
                  <button
                    type="button"
                    data-ocid={`office.edit.cancel_button.${idx + 1}`}
                    style={{
                      ...btnSmall,
                      background: "#222",
                      color: S.dim,
                      padding: "6px 12px",
                      flex: "none",
                    }}
                    onClick={(e) => {
                      e.stopPropagation();
                      setEditingId(null);
                    }}
                  >
                    CANCEL
                  </button>
                </div>
              </div>
            ) : (
              <div
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: "10px",
                }}
              >
                <button
                  type="button"
                  title={isFav ? "REMOVE FAVOURITE" : "ADD FAVOURITE"}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleToggle(office.id);
                  }}
                  data-ocid={`office.fav_toggle.${idx + 1}`}
                  style={{
                    background: "transparent",
                    border: "none",
                    cursor: "pointer",
                    padding: "0 4px 0 0",
                    color: isFav ? S.gold : S.dim,
                    fontSize: "1rem",
                    lineHeight: 1,
                    flexShrink: 0,
                    marginTop: "2px",
                  }}
                >
                  {isFav ? "★" : "☆"}
                </button>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: "0.75rem",
                      color: isSelected ? S.green : isFav ? S.gold : S.white,
                      fontWeight: 900,
                      letterSpacing: "1px",
                    }}
                  >
                    {office.name}
                    {isSelected && (
                      <span
                        style={{
                          color: S.green,
                          fontSize: "0.55rem",
                          marginLeft: "8px",
                        }}
                      >
                        ◈ ACTIVE
                      </span>
                    )}
                  </div>
                  <div
                    style={{
                      fontSize: "0.55rem",
                      color: S.blue,
                      letterSpacing: "2px",
                      marginTop: "2px",
                    }}
                  >
                    {office.floor}
                  </div>
                  {office.desc && (
                    <div
                      style={{
                        fontSize: "0.6rem",
                        color: S.dim,
                        letterSpacing: "1px",
                        marginTop: "2px",
                      }}
                    >
                      {office.desc}
                    </div>
                  )}
                </div>
                {isSovereign && (
                  <div style={{ display: "flex", gap: "5px", flexShrink: 0 }}>
                    <button
                      type="button"
                      data-ocid={`office.edit_button.${idx + 1}`}
                      style={{
                        ...btnSmall,
                        background: "#1a1500",
                        color: S.gold,
                        border: `1px solid ${S.gold}44`,
                        padding: "4px 8px",
                        flex: "none",
                        fontSize: "0.6rem",
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                        startEdit(office);
                      }}
                    >
                      EDIT
                    </button>
                    <button
                      type="button"
                      data-ocid={`office.delete_button.${idx + 1}`}
                      style={{
                        ...btnSmall,
                        background: S.red,
                        color: "#fff",
                        padding: "4px 8px",
                        flex: "none",
                        fontSize: "0.6rem",
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDelete(office.id);
                      }}
                    >
                      DELETE
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── MemberList (collapsible, all users) ─────────────────────────────────────

function MemberList({
  currentUser,
  onActivity,
  onDM,
  lockdown,
  xutNumbers,
}: {
  currentUser: CurrentUser;
  onActivity: () => void;
  onDM: (name: string) => void;
  lockdown: boolean;
  xutNumbers?: Record<string, string>;
}) {
  const { actor } = useActor();
  const [db, setDbState] = useState<UserDB>(getDB);
  const [expanded, setExpanded] = useState(false);
  const [favs, setFavs] = useState<string[]>(() =>
    getFavourites(currentUser.name),
  );
  const [totalUnread, setTotalUnread] = useState(() =>
    getTotalUnreadDMs(currentUser.name),
  );

  useEffect(() => {
    const id = setInterval(() => {
      setTotalUnread(getTotalUnreadDMs(currentUser.name));
    }, 3000);
    return () => clearInterval(id);
  }, [currentUser.name]);

  const [memberSearch, setMemberSearch] = useState("");
  const refresh = () => setDbState(getDB());

  const handleFavToggle = (name: string) => {
    const next = toggleFavourite(currentUser.name, name);
    setFavs(next);
  };

  const changeLvl = (name: string, change: number) => {
    if (lockdown || IMMUNE.includes(name)) return;
    const d = getDB();
    const newLvl = d[name].lvl + change;
    if (newLvl < 1 || newLvl > 6) return;
    d[name].lvl = newLvl;
    setDB(d);
    addActivity(`MODIFIED ${name} TO L${newLvl}`);
    refresh();
    onActivity();
    // Sync to backend
    actor?.updateUserLevel(name, BigInt(newLvl)).catch(() => {});
  };

  const delMem = (name: string) => {
    if (lockdown || name === currentUser.name || IMMUNE.includes(name)) return;
    if (window.confirm(`TERMINATE IDENTITY: ${name}?`)) {
      const d = getDB();
      delete d[name];
      setDB(d);
      addActivity(`DELETED IDENTITY: ${name}`);
      refresh();
      onActivity();
      // Background sync to backend (fire-and-forget)
      if (actor) {
        actor.deleteUser(name).catch(() => {});
      }
    }
  };

  const allMemberNames = Object.keys(db);
  const memberNames = memberSearch.trim()
    ? allMemberNames.filter((n) =>
        n.toLowerCase().includes(memberSearch.toLowerCase()),
      )
    : allMemberNames;
  const favouriteNames = favs.filter((n) => memberNames.includes(n));
  const otherNames = memberNames.filter((n) => !favs.includes(n));

  const sharedRowProps = {
    db,
    currentUser,
    lockdown,
    onDM,
    onFavToggle: handleFavToggle,
    onChangeLvl: changeLvl,
    onDel: delMem,
    xutNumbers,
  };

  return (
    <div style={{ marginBottom: "30px" }}>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          width: "100%",
          background: "transparent",
          border: "none",
          borderLeft: `5px solid ${S.gold}`,
          paddingLeft: "15px",
          paddingRight: "0",
          marginBottom: expanded ? "15px" : "0",
          cursor: "pointer",
          textAlign: "left",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <h3
            style={{
              margin: 0,
              fontSize: "0.9rem",
              letterSpacing: "3px",
              color: S.white,
              fontFamily: "'JetBrains Mono', 'Courier New', monospace",
              fontWeight: 900,
              textTransform: "uppercase",
            }}
          >
            MEMBER DIRECTORY
          </h3>
          {totalUnread > 0 && (
            <span
              style={{
                background: S.red,
                color: "#fff",
                fontSize: "0.55rem",
                fontWeight: 900,
                borderRadius: "10px",
                padding: "2px 7px",
                letterSpacing: "0.5px",
                flexShrink: 0,
                fontFamily: "'JetBrains Mono', 'Courier New', monospace",
              }}
            >
              {totalUnread} NEW
            </span>
          )}
        </div>
        <span
          style={{
            color: S.gold,
            fontSize: "0.75rem",
            fontFamily: "'JetBrains Mono', 'Courier New', monospace",
            fontWeight: 900,
            marginLeft: "10px",
          }}
        >
          {expanded ? "▲" : "▼"} [{memberNames.length}]
          {favouriteNames.length > 0 && (
            <span style={{ color: S.gold, marginLeft: "6px" }}>
              ★{favouriteNames.length}
            </span>
          )}
        </span>
      </button>

      {expanded && (
        <>
          <div
            style={{
              padding: "8px 12px",
              background: "#0a0a0a",
              borderLeft: `5px solid ${S.gold}`,
              borderBottom: `1px solid ${S.brd}`,
            }}
          >
            <input
              type="text"
              placeholder="SEARCH MEMBERS..."
              value={memberSearch}
              onChange={(e) => setMemberSearch(e.target.value)}
              style={{
                width: "100%",
                background: "transparent",
                border: "none",
                outline: "none",
                color: S.white,
                fontSize: "0.7rem",
                fontFamily: "'JetBrains Mono', 'Courier New', monospace",
                letterSpacing: "1px",
                fontWeight: 900,
              }}
            />
          </div>
          <div
            className="xution-scroll"
            style={{
              border: `1px solid ${S.brd}`,
              background: "#080808",
              maxHeight: "400px",
              overflowY: "auto",
            }}
          >
            {memberNames.length === 0 ? (
              <div
                style={{
                  padding: "15px",
                  color: S.dim,
                  fontSize: "0.7rem",
                  textAlign: "center",
                  textTransform: "uppercase",
                }}
              >
                NO MEMBERS REGISTERED
              </div>
            ) : (
              <>
                {favouriteNames.length > 0 && (
                  <>
                    <div
                      style={{
                        padding: "6px 15px",
                        background: "#0d0b00",
                        borderBottom: `1px solid ${S.gold}33`,
                        fontSize: "0.55rem",
                        color: S.gold,
                        letterSpacing: "3px",
                        fontWeight: 900,
                      }}
                    >
                      ★ FAVOURITES
                    </div>
                    {favouriteNames.map((memberName) => (
                      <MemberRow
                        key={`fav-${memberName}`}
                        memberName={memberName}
                        isFav={true}
                        {...sharedRowProps}
                      />
                    ))}
                    {otherNames.length > 0 && (
                      <div
                        style={{
                          padding: "6px 15px",
                          background: "#0a0a0a",
                          borderBottom: `1px solid ${S.brd}`,
                          fontSize: "0.55rem",
                          color: S.dim,
                          letterSpacing: "3px",
                          fontWeight: 900,
                        }}
                      >
                        ALL MEMBERS
                      </div>
                    )}
                  </>
                )}
                {otherNames.map((memberName) => (
                  <MemberRow
                    key={memberName}
                    memberName={memberName}
                    isFav={false}
                    {...sharedRowProps}
                  />
                ))}
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ─── PurchaseConfirmModal ──────────────────────────────────────────────────────

interface PurchaseConfirmProps {
  itemName: string;
  cost: number;
  cardNumber: string;
  balance: number | null; // null = unlimited (L6)
  onConfirm: () => void;
  onCancel: () => void;
}

function PurchaseConfirmModal({
  itemName,
  cost,
  cardNumber,
  balance,
  onConfirm,
  onCancel,
}: PurchaseConfirmProps) {
  const last4 = cardNumber.replace(/\s/g, "").slice(-4);
  const isUnlimited = balance === null;
  const remaining = isUnlimited
    ? null
    : Number.parseFloat(((balance ?? 0) - cost).toFixed(2));

  // Close on Escape key
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onCancel]);

  return (
    <div
      data-ocid="purchase.modal"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.85)",
        zIndex: 99999,
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        padding: "20px",
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
      onKeyDown={(e) => {
        if (e.target === e.currentTarget && e.key === "Enter") onCancel();
      }}
    >
      <div
        style={{
          background: "#0a0a0a",
          border: `2px solid ${S.gold}`,
          padding: "28px 24px",
          width: "100%",
          maxWidth: "380px",
          fontFamily: "'JetBrains Mono', 'Courier New', monospace",
          fontWeight: 900,
          textTransform: "uppercase",
          boxShadow: `0 0 40px ${S.gold}22, 0 8px 40px rgba(0,0,0,0.9)`,
        }}
      >
        {/* Header */}
        <div
          style={{
            fontSize: "0.6rem",
            letterSpacing: "4px",
            color: S.gold,
            borderBottom: `1px solid ${S.brd}`,
            paddingBottom: "12px",
            marginBottom: "20px",
          }}
        >
          ⚡ CONFIRM PURCHASE
        </div>

        {/* Item details */}
        <div style={{ marginBottom: "20px" }}>
          <div
            style={{
              padding: "14px",
              background: "#050505",
              border: `1px solid ${S.brd}`,
              display: "flex",
              flexDirection: "column",
              gap: "10px",
            }}
          >
            {/* Item name */}
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: "10px",
              }}
            >
              <span
                style={{
                  fontSize: "0.55rem",
                  color: S.dim,
                  letterSpacing: "2px",
                }}
              >
                ITEM
              </span>
              <span
                style={{
                  fontSize: "0.75rem",
                  color: S.white,
                  letterSpacing: "1px",
                  textAlign: "right",
                  flex: 1,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {itemName}
              </span>
            </div>

            {/* Cost */}
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <span
                style={{
                  fontSize: "0.55rem",
                  color: S.dim,
                  letterSpacing: "2px",
                }}
              >
                COST
              </span>
              <span
                style={{
                  fontSize: "0.9rem",
                  color: S.gold,
                  letterSpacing: "2px",
                  fontWeight: 900,
                }}
              >
                {formatFunds(cost)}
              </span>
            </div>

            {/* Current balance */}
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <span
                style={{
                  fontSize: "0.55rem",
                  color: S.dim,
                  letterSpacing: "2px",
                }}
              >
                BALANCE
              </span>
              <span
                style={{
                  fontSize: "0.75rem",
                  color: S.goldBr,
                  letterSpacing: "1px",
                }}
              >
                {isUnlimited ? "∞ UNLIMITED" : formatFunds(balance ?? 0)}
              </span>
            </div>

            {/* Remaining after */}
            {!isUnlimited && remaining !== null && (
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  borderTop: `1px solid ${S.brd}`,
                  paddingTop: "8px",
                }}
              >
                <span
                  style={{
                    fontSize: "0.55rem",
                    color: S.dim,
                    letterSpacing: "2px",
                  }}
                >
                  AFTER
                </span>
                <span
                  style={{
                    fontSize: "0.75rem",
                    color: remaining < 0 ? S.red : S.green,
                    letterSpacing: "1px",
                  }}
                >
                  {formatFunds(remaining)}
                </span>
              </div>
            )}
          </div>

          {/* Card info */}
          <div
            style={{
              marginTop: "10px",
              padding: "10px 14px",
              background: "#080808",
              border: `1px solid ${S.gold}33`,
              display: "flex",
              alignItems: "center",
              gap: "10px",
            }}
          >
            <span
              style={{
                fontSize: "0.55rem",
                color: S.dim,
                letterSpacing: "2px",
              }}
            >
              CHARGED TO
            </span>
            <span
              style={{
                fontSize: "0.7rem",
                color: S.gold,
                letterSpacing: "2px",
                fontWeight: 900,
              }}
            >
              XUTION CARD ****{last4}
            </span>
          </div>
        </div>

        {/* Action buttons */}
        <div style={{ display: "flex", gap: "10px" }}>
          <button
            type="button"
            data-ocid="purchase.confirm_button"
            onClick={onConfirm}
            style={{
              ...btnPrimary,
              flex: 1,
              padding: "14px",
              fontSize: "0.75rem",
              letterSpacing: "2px",
            }}
          >
            ✓ CONFIRM
          </button>
          <button
            type="button"
            data-ocid="purchase.cancel_button"
            onClick={onCancel}
            style={{
              flex: 1,
              padding: "14px",
              background: "#222",
              color: S.dim,
              border: "none",
              fontFamily: "'JetBrains Mono', 'Courier New', monospace",
              fontWeight: 900,
              fontSize: "0.75rem",
              textTransform: "uppercase",
              letterSpacing: "2px",
              cursor: "pointer",
            }}
          >
            ✕ CANCEL
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── FacilityMenu ─────────────────────────────────────────────────────────────

function FacilityMenu({
  currentUser,
  facility,
  onActivity,
}: {
  currentUser: CurrentUser;
  facility: string;
  onActivity: () => void;
}) {
  const { actor } = useActor();
  const isSovereign = currentUser.lvl === 6;
  const [items, setItemsState] = useState<MenuItem[]>(() =>
    getFacilityMenu(facility),
  );
  const [addOpen, setAddOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [newPrice, setNewPrice] = useState("");
  const [newStock, setNewStock] = useState(""); // empty = unlimited
  const [newItemImage, setNewItemImage] = useState<string | undefined>(
    undefined,
  );
  const [newSupplies, setNewSupplies] = useState<MenuItemSupply[]>([]);
  const [extrasMap, setExtrasMap] = useState<Record<string, MenuItemExtras>>(
    () => getAllMenuItemExtrasMapLocal(),
  );
  const [stockInputs, setStockInputs] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [successIds, setSuccessIds] = useState<Record<string, boolean>>({});
  const [funds, setFundsState] = useState<number>(() =>
    getFunds(currentUser.name),
  );
  const [pendingItem, setPendingItem] = useState<MenuItem | null>(null);
  const [facilityCategories, setFacilityCategoriesState] = useState<string[]>(
    () => getFacilityCategories(facility),
  );
  const [selectedCategoryFilter, setSelectedCategoryFilter] =
    useState<string>("ALL");
  const [newCategoryName, setNewCategoryName] = useState("");
  const [selectedItemCategory, setSelectedItemCategory] = useState<string>("");
  const [catMgrOpen, setCatMgrOpen] = useState(false);

  useEffect(() => {
    setFacilityCategoriesState(getFacilityCategories(facility));
    setSelectedCategoryFilter("ALL");
  }, [facility]);

  useEffect(() => {
    setItemsState(getFacilityMenu(facility));
  }, [facility]);

  useEffect(() => {
    const id = setInterval(() => {
      const latest = getFunds(currentUser.name);
      setFundsState((prev) => (prev !== latest ? latest : prev));
    }, 2000);
    return () => clearInterval(id);
  }, [currentUser.name]);

  const refreshItems = () => setItemsState(getFacilityMenu(facility));

  const handlePurchase = (item: MenuItem) => {
    setErrors((prev) => ({ ...prev, [item.id]: "" }));
    if (!isSovereign && item.price > funds) {
      setErrors((prev) => ({ ...prev, [item.id]: "INSUFFICIENT FUNDS" }));
      setTimeout(() => setErrors((prev) => ({ ...prev, [item.id]: "" })), 2000);
      return;
    }
    // Open confirmation modal
    setPendingItem(item);
  };

  const executePurchase = (item: MenuItem) => {
    const prevAmount = funds;
    const newAmount = isSovereign
      ? prevAmount
      : Number.parseFloat((prevAmount - item.price).toFixed(2));
    if (!isSovereign) {
      setFunds(currentUser.name, newAmount);
      setFundsState(newAmount);
      // Sync funds to canister
      actor?.setMemberFunds(currentUser.name, newAmount).catch(() => {});
    }
    // Decrement stock if tracked
    if (item.stock !== undefined) {
      decrementMenuItemStock(item.id);
      // Sync new stock to canister
      const newStock = Math.max(0, item.stock - 1);
      actor
        ?.updateMenuItemStock(item.id, localStockToCanister(newStock))
        .catch(() => {});
    }
    // Decrement supplies if any
    const currentExtras = extrasMap[item.id] || {};
    if (currentExtras.supplies && currentExtras.supplies.length > 0) {
      const updatedSupplies = currentExtras.supplies.map((s) => ({
        ...s,
        currentStock: Math.max(0, s.currentStock - s.neededPerPurchase),
      }));
      const updatedExtras: MenuItemExtras = {
        ...currentExtras,
        supplies: updatedSupplies,
      };
      setMenuItemExtrasLocal(item.id, updatedExtras);
      setExtrasMap((prev) => ({ ...prev, [item.id]: updatedExtras }));
      actor
        ?.setMenuItemExtras(item.id, JSON.stringify(updatedExtras))
        .catch(() => {});
    }
    const ts = new Date().toISOString();
    addTransaction({
      member: currentUser.name,
      prevAmount,
      newAmount,
      changedBy: currentUser.name,
      ts,
      description: `PURCHASE: ${item.name} @ ${facility}`,
    });
    // Sync transaction to canister
    actor
      ?.addTransaction(
        currentUser.name,
        prevAmount,
        newAmount,
        currentUser.name,
        ts,
        `PURCHASE: ${item.name} @ ${facility}`,
      )
      .catch(() => {});
    addActivity(
      `PURCHASE: ${item.name} FROM ${facility} BY ${currentUser.name}`,
    );
    onActivity();
    refreshItems();
    setSuccessIds((prev) => ({ ...prev, [item.id]: true }));
    setTimeout(
      () => setSuccessIds((prev) => ({ ...prev, [item.id]: false })),
      2000,
    );
    setPendingItem(null);
  };

  const handleAddItem = () => {
    const name = newName.trim();
    const price = Number.parseFloat(newPrice);
    if (!name) return;
    if (Number.isNaN(price) || price < 0) return;
    const stockVal = newStock.trim();
    const parsedStock =
      stockVal === "" ? undefined : Number.parseInt(stockVal, 10);
    if (
      parsedStock !== undefined &&
      (Number.isNaN(parsedStock) || parsedStock < 0)
    )
      return;
    const allItems = getMenuItems();
    const newItem: MenuItem = {
      id: Date.now().toString(),
      facility,
      name,
      price: Number.parseFloat(price.toFixed(2)),
      description: newDesc.trim(),
      createdBy: currentUser.name,
      stock: parsedStock,
      category: selectedItemCategory || undefined,
    };
    allItems.push(newItem);
    setMenuItems(allItems);
    // Save extras (image + supplies)
    const newExtras: MenuItemExtras = {
      imageUrl: newItemImage,
      supplies: newSupplies,
    };
    setMenuItemExtrasLocal(newItem.id, newExtras);
    setExtrasMap((prev) => ({ ...prev, [newItem.id]: newExtras }));
    setNewName("");
    setNewDesc("");
    setNewPrice("");
    setNewStock("");
    setNewItemImage(undefined);
    setNewSupplies([]);
    setSelectedItemCategory("");
    addActivity(`MENU ITEM ADDED: ${name} TO ${facility}`);
    onActivity();
    refreshItems();
    // Sync to canister
    actor
      ?.addMenuItem(
        facility,
        name,
        newItem.price,
        newItem.description,
        currentUser.name,
        localStockToCanister(parsedStock),
      )
      .then(() => {
        actor
          ?.setMenuItemExtras(newItem.id, JSON.stringify(newExtras))
          .catch(() => {});
      })
      .catch(() => {});
  };

  const handleSetStock = (item: MenuItem) => {
    const raw = stockInputs[item.id]?.trim() ?? "";
    if (raw === "") return;
    const val = Number.parseInt(raw, 10);
    if (Number.isNaN(val) || val < 0) return;
    updateMenuItemStock(item.id, val);
    setStockInputs((prev) => ({ ...prev, [item.id]: "" }));
    refreshItems();
    // Sync to canister
    actor
      ?.updateMenuItemStock(item.id, localStockToCanister(val))
      .catch(() => {});
  };

  const handleDeleteItem = (itemId: string) => {
    const allItems = getMenuItems().filter((i) => i.id !== itemId);
    setMenuItems(allItems);
    addActivity(`MENU ITEM DELETED FROM ${facility}`);
    onActivity();
    refreshItems();
    // Sync to canister
    actor?.deleteMenuItem(itemId).catch(() => {});
  };

  return (
    <>
      {pendingItem && (
        <PurchaseConfirmModal
          itemName={pendingItem.name}
          cost={pendingItem.price}
          cardNumber={getCardNumber(currentUser.name)}
          balance={isSovereign ? null : funds}
          onConfirm={() => executePurchase(pendingItem)}
          onCancel={() => setPendingItem(null)}
        />
      )}
      <div
        style={{
          borderTop: `1px solid ${S.brd}`,
          paddingTop: "15px",
          marginBottom: "20px",
        }}
      >
        <p
          style={{
            color: S.gold,
            fontSize: "0.7rem",
            marginBottom: "12px",
            letterSpacing: "3px",
            fontWeight: 900,
          }}
        >
          FACILITY MENU
        </p>

        {/* L6: Category Management */}
        {isSovereign && (
          <div style={{ marginBottom: "12px" }}>
            <button
              type="button"
              onClick={() => setCatMgrOpen((v) => !v)}
              style={{
                background: "transparent",
                border: "none",
                color: S.dim,
                cursor: "pointer",
                fontSize: "0.6rem",
                letterSpacing: "2px",
                padding: "0 0 6px 0",
                fontFamily: "'JetBrains Mono', 'Courier New', monospace",
              }}
            >
              {catMgrOpen ? "▲" : "▼"} CATEGORIES [{facilityCategories.length}]
            </button>
            {catMgrOpen && (
              <div
                style={{
                  background: "#0a0a0a",
                  border: `1px solid ${S.brd}`,
                  padding: "8px",
                  marginBottom: "8px",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    gap: "4px",
                    marginBottom: "8px",
                  }}
                >
                  {facilityCategories.length === 0 && (
                    <span style={{ fontSize: "0.6rem", color: S.dim }}>
                      NO CATEGORIES YET
                    </span>
                  )}
                  {facilityCategories.map((cat) => (
                    <span
                      key={cat}
                      style={{
                        background: "#1a1a1a",
                        border: "1px solid #333",
                        borderRadius: "4px",
                        padding: "2px 8px",
                        fontSize: "0.7rem",
                        color: "#aaa",
                        display: "flex",
                        alignItems: "center",
                        gap: "4px",
                      }}
                    >
                      {cat}
                      <button
                        type="button"
                        onClick={() => {
                          const updated = facilityCategories.filter(
                            (c) => c !== cat,
                          );
                          setFacilityCategories(facility, updated);
                          setFacilityCategoriesState(updated);
                        }}
                        style={{
                          background: "none",
                          border: "none",
                          color: S.red,
                          cursor: "pointer",
                          fontSize: "0.7rem",
                          padding: "0",
                          lineHeight: 1,
                        }}
                      >
                        ✕
                      </button>
                    </span>
                  ))}
                </div>
                <div style={{ display: "flex", gap: "6px" }}>
                  <input
                    type="text"
                    placeholder="NEW CATEGORY..."
                    value={newCategoryName}
                    onChange={(e) => setNewCategoryName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && newCategoryName.trim()) {
                        const cat = newCategoryName.trim().toUpperCase();
                        if (!facilityCategories.includes(cat)) {
                          const updated = [...facilityCategories, cat];
                          setFacilityCategories(facility, updated);
                          setFacilityCategoriesState(updated);
                        }
                        setNewCategoryName("");
                      }
                    }}
                    style={{
                      ...inputStyle,
                      flex: 1,
                      fontSize: "0.65rem",
                      marginBottom: 0,
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => {
                      const cat = newCategoryName.trim().toUpperCase();
                      if (cat && !facilityCategories.includes(cat)) {
                        const updated = [...facilityCategories, cat];
                        setFacilityCategories(facility, updated);
                        setFacilityCategoriesState(updated);
                      }
                      setNewCategoryName("");
                    }}
                    style={{
                      ...btnSmall,
                      background: "#1a1500",
                      color: S.gold,
                      border: `1px solid ${S.gold}44`,
                      fontSize: "0.65rem",
                    }}
                  >
                    ADD
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Category filter tabs */}
        {facilityCategories.length > 0 && (
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: "4px",
              marginBottom: "12px",
            }}
          >
            {["ALL", ...facilityCategories].map((cat) => (
              <button
                key={cat}
                type="button"
                onClick={() => setSelectedCategoryFilter(cat)}
                style={{
                  background:
                    selectedCategoryFilter === cat ? "#1a1500" : "#111",
                  border: `1px solid ${selectedCategoryFilter === cat ? S.gold : "#333"}`,
                  color: selectedCategoryFilter === cat ? S.gold : "#aaa",
                  borderRadius: "4px",
                  padding: "2px 10px",
                  fontSize: "0.6rem",
                  fontFamily: "'JetBrains Mono', 'Courier New', monospace",
                  fontWeight: 900,
                  cursor: "pointer",
                  letterSpacing: "1px",
                }}
              >
                {cat}
              </button>
            ))}
          </div>
        )}

        {items.filter(
          (item) =>
            selectedCategoryFilter === "ALL" ||
            item.category === selectedCategoryFilter,
        ).length === 0 && items.length > 0 ? (
          <p
            style={{
              color: S.dim,
              fontSize: "0.65rem",
              letterSpacing: "2px",
              marginBottom: "12px",
            }}
          >
            NO ITEMS IN THIS CATEGORY
          </p>
        ) : null}

        {items.length === 0 ? (
          <p
            style={{
              color: S.dim,
              fontSize: "0.65rem",
              letterSpacing: "2px",
              marginBottom: "12px",
            }}
          >
            NO ITEMS AVAILABLE
          </p>
        ) : (
          <div style={{ marginBottom: "12px" }}>
            {items
              .filter(
                (item) =>
                  selectedCategoryFilter === "ALL" ||
                  item.category === selectedCategoryFilter,
              )
              .map((item) => {
                const itemExtras = extrasMap[item.id] || {};
                const supplySoldOut = (itemExtras.supplies || []).some(
                  (s) => s.currentStock < s.neededPerPurchase,
                );
                const isSoldOut =
                  (item.stock !== undefined && item.stock <= 0) ||
                  supplySoldOut;
                return (
                  <div
                    key={item.id}
                    style={{
                      padding: "10px 12px",
                      marginBottom: "8px",
                      background: isSoldOut ? "#0a0505" : "#050505",
                      border: `1px solid ${isSoldOut ? `${S.red}55` : S.brd}`,
                      display: "flex",
                      flexDirection: "column",
                      gap: "6px",
                      opacity: isSoldOut ? 0.75 : 1,
                    }}
                  >
                    {itemExtras.imageUrl && (
                      <img
                        src={itemExtras.imageUrl}
                        alt={item.name}
                        style={{
                          width: "100%",
                          maxHeight: "120px",
                          objectFit: "cover",
                          borderRadius: "4px",
                          marginBottom: "4px",
                          opacity: isSoldOut ? 0.5 : 1,
                        }}
                      />
                    )}
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        gap: "10px",
                      }}
                    >
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div
                          style={{
                            fontSize: "0.75rem",
                            color: isSoldOut ? S.dim : S.white,
                            fontWeight: 900,
                            letterSpacing: "1px",
                            display: "flex",
                            alignItems: "center",
                            gap: "8px",
                            flexWrap: "wrap",
                          }}
                        >
                          {item.name}
                          {isSoldOut && (
                            <span
                              style={{
                                fontSize: "0.55rem",
                                color: S.red,
                                border: `1px solid ${S.red}`,
                                padding: "1px 5px",
                                letterSpacing: "2px",
                                fontWeight: 900,
                              }}
                            >
                              SOLD OUT
                            </span>
                          )}
                        </div>
                        {item.description && (
                          <div
                            style={{
                              fontSize: "0.6rem",
                              color: S.dim,
                              letterSpacing: "1px",
                              marginTop: "2px",
                            }}
                          >
                            {item.description}
                          </div>
                        )}
                        {/* Stock indicator */}
                        {item.stock !== undefined && (
                          <div
                            style={{
                              fontSize: "0.55rem",
                              color: isSoldOut
                                ? S.red
                                : item.stock <= 5
                                  ? "#ffaa00"
                                  : S.green,
                              letterSpacing: "1px",
                              marginTop: "3px",
                              fontWeight: 900,
                            }}
                          >
                            STOCK: {item.stock}
                          </div>
                        )}
                        {/* Supplies indicator */}
                        {itemExtras.supplies &&
                          itemExtras.supplies.length > 0 && (
                            <div style={{ marginTop: "4px" }}>
                              {itemExtras.supplies.map((s) => {
                                const low =
                                  s.currentStock < s.neededPerPurchase;
                                return (
                                  <div
                                    key={s.id}
                                    style={{
                                      display: "flex",
                                      alignItems: "center",
                                      gap: "6px",
                                      marginBottom: "3px",
                                    }}
                                  >
                                    {s.imageUrl && (
                                      <img
                                        src={s.imageUrl}
                                        alt={s.name}
                                        style={{
                                          width: "20px",
                                          height: "20px",
                                          objectFit: "cover",
                                          borderRadius: "2px",
                                        }}
                                      />
                                    )}
                                    <span
                                      style={{
                                        fontSize: "0.55rem",
                                        color: low ? S.red : S.dim,
                                        letterSpacing: "0.5px",
                                      }}
                                    >
                                      {s.name}: {s.currentStock}/
                                      {s.neededPerPurchase} per sale
                                      {low && (
                                        <span
                                          style={{
                                            color: S.red,
                                            marginLeft: "4px",
                                            fontWeight: 900,
                                          }}
                                        >
                                          ⚠ LOW
                                        </span>
                                      )}
                                    </span>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                      </div>
                      <div
                        style={{
                          fontSize: "0.8rem",
                          color: S.gold,
                          fontWeight: 900,
                          letterSpacing: "1px",
                          flexShrink: 0,
                        }}
                      >
                        {formatFunds(item.price)}
                      </div>
                    </div>
                    <div
                      style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}
                    >
                      <button
                        type="button"
                        disabled={isSoldOut}
                        style={{
                          ...btnSmall,
                          background: isSoldOut ? S.dim : S.gold,
                          color: isSoldOut ? "#888" : "#000",
                          flex: "none",
                          padding: "7px 14px",
                          cursor: isSoldOut ? "not-allowed" : "pointer",
                        }}
                        onClick={() => !isSoldOut && handlePurchase(item)}
                      >
                        {isSoldOut ? "SOLD OUT" : "PURCHASE"}
                      </button>
                      {isSovereign && (
                        <>
                          {/* Stock adjustment controls */}
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: "4px",
                            }}
                          >
                            <button
                              type="button"
                              title="Decrease stock by 1"
                              style={{
                                ...btnSmall,
                                background: "#222",
                                color: S.white,
                                flex: "none",
                                padding: "7px 8px",
                                fontSize: "0.8rem",
                              }}
                              onClick={() => {
                                if (item.stock !== undefined) {
                                  const newStk = Math.max(0, item.stock - 1);
                                  updateMenuItemStock(item.id, newStk);
                                  refreshItems();
                                  actor
                                    ?.updateMenuItemStock(
                                      item.id,
                                      localStockToCanister(newStk),
                                    )
                                    .catch(() => {});
                                }
                              }}
                            >
                              -
                            </button>
                            <input
                              type="number"
                              min={0}
                              placeholder="QTY"
                              value={stockInputs[item.id] ?? ""}
                              onChange={(e) =>
                                setStockInputs((prev) => ({
                                  ...prev,
                                  [item.id]: e.target.value,
                                }))
                              }
                              onKeyDown={(e) =>
                                e.key === "Enter" && handleSetStock(item)
                              }
                              style={{
                                ...inputStyle,
                                margin: 0,
                                width: "60px",
                                padding: "6px 6px",
                                fontSize: "0.65rem",
                                height: "32px",
                                textAlign: "center",
                              }}
                            />
                            <button
                              type="button"
                              title="Increase stock by 1"
                              style={{
                                ...btnSmall,
                                background: "#222",
                                color: S.white,
                                flex: "none",
                                padding: "7px 8px",
                                fontSize: "0.8rem",
                              }}
                              onClick={() => {
                                const cur = item.stock ?? 0;
                                const newStk = cur + 1;
                                updateMenuItemStock(item.id, newStk);
                                refreshItems();
                                actor
                                  ?.updateMenuItemStock(
                                    item.id,
                                    localStockToCanister(newStk),
                                  )
                                  .catch(() => {});
                              }}
                            >
                              +
                            </button>
                            <button
                              type="button"
                              title="Set stock to entered value"
                              style={{
                                ...btnSmall,
                                background: S.blue,
                                color: "#000",
                                flex: "none",
                                padding: "7px 8px",
                                fontSize: "0.6rem",
                              }}
                              onClick={() => handleSetStock(item)}
                            >
                              SET
                            </button>
                          </div>
                          <button
                            type="button"
                            style={{
                              ...btnSmall,
                              background: S.red,
                              color: "#fff",
                              flex: "none",
                              padding: "7px 10px",
                            }}
                            onClick={() => handleDeleteItem(item.id)}
                          >
                            DELETE
                          </button>
                        </>
                      )}
                      {errors[item.id] && (
                        <span
                          style={{
                            fontSize: "0.6rem",
                            color: S.red,
                            fontWeight: 900,
                            letterSpacing: "1px",
                            alignSelf: "center",
                          }}
                        >
                          ⚠ {errors[item.id]}
                        </span>
                      )}
                      {successIds[item.id] && (
                        <span
                          style={{
                            fontSize: "0.6rem",
                            color: S.green,
                            fontWeight: 900,
                            letterSpacing: "1px",
                            alignSelf: "center",
                          }}
                        >
                          ✓ APPROVED
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
          </div>
        )}
        {/* Sold Out Log */}
        {(() => {
          const soldOutItems = items.filter(
            (item) => item.stock !== undefined && item.stock <= 0,
          );
          return (
            <div style={{ marginBottom: "16px" }}>
              <p
                style={{
                  color: S.red,
                  fontSize: "0.7rem",
                  marginBottom: "8px",
                  letterSpacing: "3px",
                  fontWeight: 900,
                }}
              >
                SOLD OUT ({soldOutItems.length})
              </p>
              <div
                className="xution-scroll"
                style={{
                  height: "150px",
                  overflowY: "scroll",
                  border: `1px solid ${S.brd}`,
                  padding: "10px",
                  background: "#050505",
                }}
              >
                {soldOutItems.length === 0 ? (
                  <p
                    style={{
                      opacity: 0.4,
                      fontSize: "0.7rem",
                      letterSpacing: "1px",
                    }}
                  >
                    NO ITEMS SOLD OUT
                  </p>
                ) : (
                  soldOutItems.map((item) => (
                    <div
                      key={`so-${item.id}`}
                      style={{
                        marginBottom: "8px",
                        borderBottom: "1px solid #300",
                        paddingBottom: "6px",
                        fontSize: "0.7rem",
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                        }}
                      >
                        <strong
                          style={{ color: S.white, letterSpacing: "1px" }}
                        >
                          {item.name}
                        </strong>
                        <span
                          style={{
                            color: S.red,
                            fontSize: "0.6rem",
                            fontWeight: 900,
                            letterSpacing: "2px",
                            border: `1px solid ${S.red}`,
                            padding: "1px 5px",
                          }}
                        >
                          SOLD OUT
                        </span>
                      </div>
                      {item.description && (
                        <div
                          style={{
                            color: S.dim,
                            fontSize: "0.6rem",
                            marginTop: "2px",
                          }}
                        >
                          {item.description}
                        </div>
                      )}
                      <div
                        style={{
                          color: S.gold,
                          fontSize: "0.6rem",
                          marginTop: "2px",
                        }}
                      >
                        {formatFunds(item.price)}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          );
        })()}

        {isSovereign && (
          <div>
            <button
              type="button"
              onClick={() => setAddOpen((v) => !v)}
              style={{
                background: "transparent",
                border: "none",
                color: S.gold,
                fontSize: "0.65rem",
                fontWeight: 900,
                fontFamily: "'JetBrains Mono', 'Courier New', monospace",
                textTransform: "uppercase",
                letterSpacing: "2px",
                cursor: "pointer",
                padding: "6px 0",
                marginBottom: addOpen ? "10px" : "0",
              }}
            >
              ADD MENU ITEM {addOpen ? "▲" : "▼"}
            </button>
            {addOpen && (
              <div
                style={{
                  border: `1px solid ${S.gold}44`,
                  background: "#0a0800",
                  padding: "12px",
                }}
              >
                <input
                  type="text"
                  placeholder="ITEM NAME"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  style={{ ...inputStyle, marginBottom: "0" }}
                />
                <input
                  type="text"
                  placeholder="DESCRIPTION (OPTIONAL)"
                  value={newDesc}
                  onChange={(e) => setNewDesc(e.target.value)}
                  style={{ ...inputStyle, marginBottom: "0" }}
                />
                <input
                  type="number"
                  placeholder="PRICE (0.00)"
                  min={0}
                  step={0.01}
                  value={newPrice}
                  onChange={(e) => setNewPrice(e.target.value)}
                  style={{ ...inputStyle, marginBottom: "0" }}
                />
                <input
                  type="number"
                  placeholder="STOCK QTY (leave blank = unlimited)"
                  min={0}
                  step={1}
                  value={newStock}
                  onChange={(e) => setNewStock(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleAddItem()}
                  style={{ ...inputStyle, marginBottom: "0" }}
                />
                {/* Item Image */}
                <div style={{ marginTop: "8px" }}>
                  <p
                    style={{
                      color: S.dim,
                      fontSize: "0.6rem",
                      letterSpacing: "2px",
                      margin: "0 0 4px 0",
                    }}
                  >
                    ITEM IMAGE (OPTIONAL)
                  </p>
                  {newItemImage && (
                    <div
                      style={{
                        position: "relative",
                        display: "inline-block",
                        marginBottom: "6px",
                      }}
                    >
                      <img
                        src={newItemImage}
                        alt="preview"
                        style={{
                          width: "80px",
                          height: "60px",
                          objectFit: "cover",
                          borderRadius: "4px",
                          border: `1px solid ${S.gold}44`,
                        }}
                      />
                      <button
                        type="button"
                        onClick={() => setNewItemImage(undefined)}
                        style={{
                          position: "absolute",
                          top: "-6px",
                          right: "-6px",
                          background: S.red,
                          color: "#fff",
                          border: "none",
                          borderRadius: "50%",
                          width: "16px",
                          height: "16px",
                          fontSize: "0.55rem",
                          cursor: "pointer",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        ✕
                      </button>
                    </div>
                  )}
                  <label
                    style={{
                      ...btnSmall,
                      background: "#1a1500",
                      color: S.gold,
                      border: `1px solid ${S.gold}44`,
                      cursor: "pointer",
                      display: "inline-block",
                    }}
                  >
                    {newItemImage ? "CHANGE IMAGE" : "UPLOAD IMAGE"}
                    <input
                      type="file"
                      accept="image/*"
                      style={{ display: "none" }}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        const reader = new FileReader();
                        reader.onload = (ev) =>
                          setNewItemImage(ev.target?.result as string);
                        reader.readAsDataURL(file);
                        e.target.value = "";
                      }}
                    />
                  </label>
                </div>
                {/* Supplies */}
                <div style={{ marginTop: "10px" }}>
                  <p
                    style={{
                      color: S.dim,
                      fontSize: "0.6rem",
                      letterSpacing: "2px",
                      margin: "0 0 6px 0",
                    }}
                  >
                    SUPPLIES NEEDED PER PURCHASE
                  </p>
                  {newSupplies.map((supply, idx) => (
                    <div
                      key={supply.id}
                      style={{
                        background: "#0a0a0a",
                        border: `1px solid ${S.brd}`,
                        padding: "8px",
                        marginBottom: "6px",
                        display: "flex",
                        flexDirection: "column",
                        gap: "4px",
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          gap: "6px",
                          alignItems: "center",
                        }}
                      >
                        {supply.imageUrl && (
                          <img
                            src={supply.imageUrl}
                            alt={supply.name}
                            style={{
                              width: "32px",
                              height: "32px",
                              objectFit: "cover",
                              borderRadius: "3px",
                            }}
                          />
                        )}
                        <input
                          type="text"
                          placeholder="SUPPLY NAME"
                          value={supply.name}
                          onChange={(e) =>
                            setNewSupplies((prev) =>
                              prev.map((s, i) =>
                                i === idx ? { ...s, name: e.target.value } : s,
                              ),
                            )
                          }
                          style={{
                            ...inputStyle,
                            margin: 0,
                            flex: 1,
                            padding: "4px 6px",
                            fontSize: "0.6rem",
                            height: "26px",
                          }}
                        />
                        <button
                          type="button"
                          onClick={() =>
                            setNewSupplies((prev) =>
                              prev.filter((_, i) => i !== idx),
                            )
                          }
                          style={{
                            ...btnSmall,
                            background: "#2a0000",
                            color: S.red,
                            border: `1px solid ${S.red}44`,
                            padding: "4px 8px",
                          }}
                        >
                          ✕
                        </button>
                      </div>
                      <div style={{ display: "flex", gap: "6px" }}>
                        <input
                          type="number"
                          placeholder="CURRENT STOCK"
                          min={0}
                          value={
                            supply.currentStock === 0 ? "" : supply.currentStock
                          }
                          onChange={(e) =>
                            setNewSupplies((prev) =>
                              prev.map((s, i) =>
                                i === idx
                                  ? {
                                      ...s,
                                      currentStock: Number(e.target.value) || 0,
                                    }
                                  : s,
                              ),
                            )
                          }
                          style={{
                            ...inputStyle,
                            margin: 0,
                            flex: 1,
                            padding: "4px 6px",
                            fontSize: "0.6rem",
                            height: "26px",
                          }}
                        />
                        <input
                          type="number"
                          placeholder="NEEDED/PURCHASE"
                          min={1}
                          value={
                            supply.neededPerPurchase === 0
                              ? ""
                              : supply.neededPerPurchase
                          }
                          onChange={(e) =>
                            setNewSupplies((prev) =>
                              prev.map((s, i) =>
                                i === idx
                                  ? {
                                      ...s,
                                      neededPerPurchase:
                                        Number(e.target.value) || 1,
                                    }
                                  : s,
                              ),
                            )
                          }
                          style={{
                            ...inputStyle,
                            margin: 0,
                            flex: 1,
                            padding: "4px 6px",
                            fontSize: "0.6rem",
                            height: "26px",
                          }}
                        />
                      </div>
                      <label
                        style={{
                          ...btnSmall,
                          background: "#0a0a1a",
                          color: S.blue,
                          border: `1px solid ${S.blue}44`,
                          cursor: "pointer",
                          display: "inline-block",
                          fontSize: "0.55rem",
                        }}
                      >
                        {supply.imageUrl ? "CHANGE IMG" : "ADD IMG"}
                        <input
                          type="file"
                          accept="image/*"
                          style={{ display: "none" }}
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (!file) return;
                            const reader = new FileReader();
                            reader.onload = (ev) =>
                              setNewSupplies((prev) =>
                                prev.map((s, i) =>
                                  i === idx
                                    ? {
                                        ...s,
                                        imageUrl: ev.target?.result as string,
                                      }
                                    : s,
                                ),
                              );
                            reader.readAsDataURL(file);
                            e.target.value = "";
                          }}
                        />
                      </label>
                    </div>
                  ))}
                  <button
                    type="button"
                    style={{
                      ...btnSmall,
                      background: "#001a0a",
                      color: S.green,
                      border: `1px solid ${S.green}44`,
                    }}
                    onClick={() =>
                      setNewSupplies((prev) => [
                        ...prev,
                        {
                          id: Date.now().toString(),
                          name: "",
                          imageUrl: undefined,
                          currentStock: 0,
                          neededPerPurchase: 1,
                        },
                      ])
                    }
                  >
                    + ADD SUPPLY
                  </button>
                </div>
                {facilityCategories.length > 0 && (
                  <select
                    value={selectedItemCategory}
                    onChange={(e) => setSelectedItemCategory(e.target.value)}
                    style={{ ...selectStyle, marginTop: "8px" }}
                  >
                    <option value="">NO CATEGORY</option>
                    {facilityCategories.map((cat) => (
                      <option key={cat} value={cat}>
                        {cat}
                      </option>
                    ))}
                  </select>
                )}
                <button
                  type="button"
                  style={{ ...btnPrimary, marginTop: "10px" }}
                  onClick={handleAddItem}
                >
                  ADD ITEM
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
}

// ─── SectorWorkspace ──────────────────────────────────────────────────────────

function SectorWorkspace({
  currentUser,
  selectedSector,
  onActivity,
  activeOffice,
  lockdown,
}: {
  currentUser: CurrentUser;
  selectedSector: string;
  onActivity: () => void;
  activeOffice: OfficeLocation | null;
  lockdown: boolean;
}) {
  const { actor } = useActor();
  const [logs, setLogs] = useState<SectorLog[]>(getSectorLogs);
  const [adminPosts, setAdminPostsState] = useState<AdminPost[]>(getAdminPosts);
  // Selected office within the Offices sector (for browsing the list)
  const [selectedOffice, setSelectedOffice] = useState<OfficeLocation | null>(
    null,
  );

  // Log form state
  const [logTitle, setLogTitle] = useState("");
  const [logBody, setLogBody] = useState("");
  const [logLevel, setLogLevel] = useState(1);
  const [logAttachments, setLogAttachments] = useState<LogAttachment[]>([]);
  const [showLogEmojiPicker, setShowLogEmojiPicker] = useState(false);
  const [showLogGifPanel, setShowLogGifPanel] = useState(false);
  const [logGifUrl, setLogGifUrl] = useState("");
  const logImageRef = useRef<HTMLInputElement>(null);
  const logFileRef = useRef<HTMLInputElement>(null);
  const logVideoRef = useRef<HTMLInputElement>(null);
  const logAudioRef = useRef<HTMLInputElement>(null);

  // Post form state
  const [postTxt, setPostTxt] = useState("");
  const [postMinLvl, setPostMinLvl] = useState(1);
  const [postAttachments, setPostAttachments] = useState<LogAttachment[]>([]);
  const [showPostEmojiPicker, setShowPostEmojiPicker] = useState(false);
  const [showPostGifPanel, setShowPostGifPanel] = useState(false);
  const [postGifUrl, setPostGifUrl] = useState("");
  const postImageRef = useRef<HTMLInputElement>(null);
  const postFileRef = useRef<HTMLInputElement>(null);
  const postVideoRef = useRef<HTMLInputElement>(null);
  const postAudioRef = useRef<HTMLInputElement>(null);

  // Post edit state: maps post id -> edit draft text (undefined = not editing)
  const [editingPost, setEditingPost] = useState<Record<string, string>>({});

  // Log edit state: maps log id -> edit draft body (undefined = not editing)
  const [editingLog, setEditingLog] = useState<Record<string, string>>({});

  // Sector category state
  const [sectorCategories, setSectorCategoriesState] = useState<string[]>([]);
  const [selectedLogCategory, setSelectedLogCategory] = useState<string>("");
  const [logCategoryFilter, setLogCategoryFilter] = useState<string>("ALL");
  const [sectorLogSearch, setSectorLogSearch] = useState("");
  const [adminFeedSearch, setAdminFeedSearch] = useState("");
  const [newSectorCatName, setNewSectorCatName] = useState("");
  const [sectorCatMgrOpen, setSectorCatMgrOpen] = useState(false);

  const refreshLogs = () => setLogs(getSectorLogs());
  const refreshPosts = () => setAdminPostsState(getAdminPosts());

  const readFileAsDataUrl2 = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });

  const handleLogFileUpload = async (
    e: React.ChangeEvent<HTMLInputElement>,
    type: LogAttachment["type"],
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const dataUrl = await readFileAsDataUrl2(file);
    setLogAttachments((prev) => [
      ...prev,
      { type, dataUrl, name: file.name, mimeType: file.type },
    ]);
    e.target.value = "";
  };

  const handlePostFileUpload = async (
    e: React.ChangeEvent<HTMLInputElement>,
    type: LogAttachment["type"],
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const dataUrl = await readFileAsDataUrl2(file);
    setPostAttachments((prev) => [
      ...prev,
      { type, dataUrl, name: file.name, mimeType: file.type },
    ]);
    e.target.value = "";
  };

  const submitLog = () => {
    if (!logTitle || !logBody) return;
    const id = Date.now().toString();
    const date = new Date().toLocaleString();
    const allLogs = getSectorLogs();
    allLogs.push({
      id,
      sector: activeSectorKey,
      title: logTitle,
      body: logBody,
      author: currentUser.name,
      level: logLevel,
      date,
      attachments: logAttachments.length > 0 ? logAttachments : undefined,
      category: selectedLogCategory || undefined,
    });
    setSectorLogs(allLogs);
    setLogTitle("");
    setLogBody("");
    setLogAttachments([]);
    setSelectedLogCategory("");
    setShowLogEmojiPicker(false);
    setShowLogGifPanel(false);
    refreshLogs();
    // Sync to canister
    actor
      ?.addSectorLog(
        activeSectorKey,
        logTitle,
        logBody,
        currentUser.name,
        BigInt(logLevel),
        date,
      )
      .catch(() => {});
  };

  const makePost = () => {
    if (!postTxt && postAttachments.length === 0) return;
    const date = new Date().toLocaleString();
    const posts = getAdminPosts();
    posts.push({
      id: Date.now().toString(),
      author: currentUser.name,
      content: postTxt,
      minLvl: postMinLvl,
      date,
      sector: activeSectorKey,
      attachments: postAttachments.length > 0 ? postAttachments : undefined,
    });
    setAdminPosts(posts);
    setPostTxt("");
    setPostAttachments([]);
    setShowPostEmojiPicker(false);
    setShowPostGifPanel(false);
    addActivity("ADMIN POST TRANSMITTED");
    refreshPosts();
    onActivity();
    // Sync to canister
    actor
      ?.addAdminPost(
        currentUser.name,
        postTxt,
        BigInt(postMinLvl),
        date,
        activeSectorKey,
      )
      .catch(() => {});
  };

  const deletePost = (postId: string) => {
    const posts = getAdminPosts().filter((p) => p.id !== postId);
    setAdminPosts(posts);
    addActivity("ADMIN POST DELETED");
    refreshPosts();
    onActivity();
    actor?.deleteAdminPost(postId).catch(() => {});
  };

  const saveEditPost = (postId: string, newContent: string) => {
    const posts = getAdminPosts().map((p) =>
      p.id === postId ? { ...p, content: newContent } : p,
    );
    setAdminPosts(posts);
    refreshPosts();
    onActivity();
    actor?.updateAdminPost(postId, newContent).catch(() => {});
  };

  const deleteLog = (logId: string) => {
    const logs = getSectorLogs().filter((l) => l.id !== logId);
    setSectorLogs(logs);
    addActivity("SECTOR LOG DELETED");
    refreshLogs();
    onActivity();
    actor?.deleteSectorLog(logId).catch(() => {});
  };

  const saveEditLog = (logId: string, newBody: string) => {
    const logs = getSectorLogs().map((l) =>
      l.id === logId ? { ...l, body: newBody } : l,
    );
    setSectorLogs(logs);
    refreshLogs();
    onActivity();
    actor?.updateSectorLog(logId, newBody).catch(() => {});
  };

  // Reset selected office when sector changes
  // biome-ignore lint/correctness/useExhaustiveDependencies: selectedSector is a prop that drives this reset
  useEffect(() => {
    setSelectedOffice(null);
  }, [selectedSector]);

  // Use the global active office (if set) as a namespace prefix for facility data.
  // Within the Offices sector, a locally-selected office overrides for browsing.
  const activeSectorKey = activeOffice
    ? `${activeOffice.name}::${selectedSector}`
    : selectedOffice
      ? selectedOffice.name
      : selectedSector;

  const filteredLogs = logs
    .filter((l) => l.sector === activeSectorKey)
    .filter(
      (l) => logCategoryFilter === "ALL" || l.category === logCategoryFilter,
    )
    .filter(
      (l) =>
        !sectorLogSearch.trim() ||
        l.body?.toLowerCase().includes(sectorLogSearch.toLowerCase()) ||
        l.author?.toLowerCase().includes(sectorLogSearch.toLowerCase()) ||
        l.title?.toLowerCase().includes(sectorLogSearch.toLowerCase()),
    )
    .slice()
    .reverse();

  const filteredPosts = adminPosts.filter(
    (p) =>
      p.minLvl <= currentUser.lvl &&
      (!p.sector || p.sector === activeSectorKey) &&
      (!adminFeedSearch.trim() ||
        p.content?.toLowerCase().includes(adminFeedSearch.toLowerCase()) ||
        p.author?.toLowerCase().includes(adminFeedSearch.toLowerCase())),
  );

  // Load sector categories when activeSectorKey changes
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional
  useEffect(() => {
    setSectorCategoriesState(getSectorCategories(activeSectorKey));
    setLogCategoryFilter("ALL");
  }, [activeSectorKey]);

  return (
    <div
      className="xution-scroll"
      style={{
        border: `1px solid ${S.brd}`,
        padding: "15px",
        marginBottom: "20px",
        background: "#080808",
        maxHeight: "600px",
        overflowY: "auto",
      }}
    >
      <h3
        style={{
          color: S.gold,
          marginBottom: "4px",
          fontSize: "0.9rem",
          letterSpacing: "2px",
        }}
      >
        {selectedSector}
        {selectedOffice && (
          <span
            style={{
              color: S.green,
              fontSize: "0.75rem",
              marginLeft: "10px",
              letterSpacing: "1px",
            }}
          >
            › {selectedOffice.name}
          </span>
        )}
      </h3>
      {selectedOffice && (
        <div style={{ marginBottom: "15px" }}>
          <div
            style={{
              fontSize: "0.6rem",
              color: S.blue,
              letterSpacing: "2px",
              marginBottom: "2px",
            }}
          >
            {selectedOffice.floor}
          </div>
          {selectedOffice.desc && (
            <div
              style={{ fontSize: "0.6rem", color: S.dim, letterSpacing: "1px" }}
            >
              {selectedOffice.desc}
            </div>
          )}
          <button
            type="button"
            onClick={() => setSelectedOffice(null)}
            style={{
              ...btnSmall,
              background: "transparent",
              color: S.dim,
              border: `1px solid ${S.brd}`,
              padding: "3px 8px",
              flex: "none",
              fontSize: "0.55rem",
              marginTop: "6px",
            }}
          >
            ← BACK TO OFFICES
          </button>
        </div>
      )}

      {/* Sector Logs */}
      <p
        style={{
          color: S.blue,
          fontSize: "0.7rem",
          marginBottom: "8px",
          letterSpacing: "3px",
          fontWeight: 900,
        }}
      >
        SECTOR LOGS
      </p>

      {/* Category filter tabs for sector logs */}
      {sectorCategories.length > 0 && (
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: "4px",
            marginBottom: "8px",
          }}
        >
          {["ALL", ...sectorCategories].map((cat) => (
            <button
              key={cat}
              type="button"
              onClick={() => setLogCategoryFilter(cat)}
              style={{
                background: logCategoryFilter === cat ? "#1a1500" : "#111",
                border: `1px solid ${logCategoryFilter === cat ? S.gold : "#333"}`,
                color: logCategoryFilter === cat ? S.gold : "#aaa",
                borderRadius: "4px",
                padding: "2px 10px",
                fontSize: "0.6rem",
                fontFamily: "'JetBrains Mono', 'Courier New', monospace",
                fontWeight: 900,
                cursor: "pointer",
                letterSpacing: "1px",
              }}
            >
              {cat}
            </button>
          ))}
        </div>
      )}

      <input
        type="text"
        value={sectorLogSearch}
        onChange={(e) => setSectorLogSearch(e.target.value)}
        placeholder="SEARCH SECTOR LOGS..."
        data-ocid="sector_logs.search_input"
        style={{
          width: "100%",
          background: "#0a0a0a",
          border: "1px solid #333",
          color: "#e0e0e0",
          padding: "6px 10px",
          fontSize: "0.65rem",
          fontFamily:
            "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
          fontWeight: 700,
          letterSpacing: "1px",
          marginBottom: "8px",
          outline: "none",
          boxSizing: "border-box",
        }}
      />
      <div
        className="xution-scroll"
        style={{
          height: "250px",
          overflowY: "scroll",
          marginBottom: "20px",
          border: `1px solid ${S.brd}`,
          padding: "10px",
          background: "#050505",
        }}
      >
        {filteredLogs.length === 0 ? (
          <p style={{ opacity: 0.4, fontSize: "0.75rem" }}>
            No historical data logs found for this sector.
          </p>
        ) : (
          filteredLogs.map((l, i) => {
            const logId = l.id || `${l.sector}-${l.author}-${l.date}-${i}`;
            const redacted = lockdown || currentUser.lvl < l.level;
            const canModify =
              currentUser.lvl === 6 || l.author === currentUser.name;
            const isEditingLog = logId in editingLog;
            return (
              <div
                key={`log-${logId}`}
                style={{
                  marginBottom: "12px",
                  borderBottom: "1px solid #222",
                  paddingBottom: "8px",
                  fontSize: "0.75rem",
                }}
              >
                {/* Log header row */}
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "flex-start",
                    gap: "8px",
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <strong style={{ color: S.gold }}>
                      L{l.level} - {l.title}
                    </strong>
                    <br />
                    <small style={{ color: S.dim }}>
                      {l.author} | {l.date}
                    </small>
                  </div>
                  {canModify && !redacted && !isEditingLog && (
                    <div style={{ display: "flex", gap: "5px", flexShrink: 0 }}>
                      <button
                        type="button"
                        style={{
                          ...btnSmall,
                          background: "#1a1500",
                          color: S.gold,
                          border: `1px solid ${S.gold}44`,
                          padding: "4px 8px",
                          flex: "none",
                        }}
                        onClick={() =>
                          setEditingLog((prev) => ({
                            ...prev,
                            [logId]: l.body,
                          }))
                        }
                      >
                        EDIT
                      </button>
                      <button
                        type="button"
                        style={{
                          ...btnSmall,
                          background: S.red,
                          color: "#fff",
                          padding: "4px 8px",
                          flex: "none",
                        }}
                        onClick={() => l.id && deleteLog(l.id)}
                      >
                        DELETE
                      </button>
                    </div>
                  )}
                </div>

                {/* Log body or inline edit */}
                {isEditingLog ? (
                  <div style={{ marginTop: "6px" }}>
                    <textarea
                      value={editingLog[logId]}
                      onChange={(e) =>
                        setEditingLog((prev) => ({
                          ...prev,
                          [logId]: e.target.value,
                        }))
                      }
                      style={{
                        ...textareaStyle,
                        margin: "0 0 6px 0",
                        minHeight: "60px",
                        fontSize: "0.75rem",
                      }}
                    />
                    <div style={{ display: "flex", gap: "6px" }}>
                      <button
                        type="button"
                        style={{
                          ...btnSmall,
                          background: S.gold,
                          color: "#000",
                          padding: "6px 12px",
                          flex: "none",
                        }}
                        onClick={() => {
                          if (l.id) saveEditLog(l.id, editingLog[logId]);
                          setEditingLog((prev) => {
                            const next = { ...prev };
                            delete next[logId];
                            return next;
                          });
                        }}
                      >
                        SAVE
                      </button>
                      <button
                        type="button"
                        style={{
                          ...btnSmall,
                          background: "#222",
                          color: S.dim,
                          padding: "6px 12px",
                          flex: "none",
                        }}
                        onClick={() =>
                          setEditingLog((prev) => {
                            const next = { ...prev };
                            delete next[logId];
                            return next;
                          })
                        }
                      >
                        CANCEL
                      </button>
                    </div>
                  </div>
                ) : redacted ? (
                  <p style={{ opacity: 0.5, margin: "4px 0 0" }}>[REDACTED]</p>
                ) : (
                  <div style={{ margin: "4px 0 0" }}>
                    <p style={{ color: S.white, margin: 0 }}>{l.body}</p>
                    {l.attachments?.map((att, ai) => {
                      const akey = `log-att-${logId}-${ai}`;
                      if (att.type === "image" || att.type === "gif") {
                        return (
                          <img
                            key={akey}
                            src={att.dataUrl || att.url}
                            alt={att.name || "media"}
                            style={{
                              maxWidth: "100%",
                              maxHeight: "200px",
                              objectFit: "contain",
                              display: "block",
                              marginTop: "6px",
                            }}
                          />
                        );
                      }
                      if (att.type === "video") {
                        return (
                          // biome-ignore lint/a11y/useMediaCaption: user-generated content
                          <video
                            key={akey}
                            controls
                            src={att.dataUrl}
                            style={{
                              maxWidth: "100%",
                              maxHeight: "180px",
                              display: "block",
                              marginTop: "6px",
                            }}
                          />
                        );
                      }
                      if (att.type === "audio") {
                        return (
                          // biome-ignore lint/a11y/useMediaCaption: user-generated content
                          <audio
                            key={akey}
                            controls
                            src={att.dataUrl}
                            style={{ width: "100%", marginTop: "6px" }}
                          />
                        );
                      }
                      if (att.type === "file") {
                        return (
                          <a
                            key={akey}
                            href={att.dataUrl}
                            download={att.name || "file"}
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: "4px",
                              color: S.blue,
                              fontSize: "0.65rem",
                              marginTop: "6px",
                              textDecoration: "none",
                              fontWeight: 900,
                            }}
                          >
                            📁 {att.name || "FILE"}
                          </a>
                        );
                      }
                      return null;
                    })}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Office Locations (Offices sector only) */}
      {selectedSector === "Offices" && !selectedOffice && (
        <OfficeLocations
          currentUser={currentUser}
          onSelect={setSelectedOffice}
          selectedId={
            selectedOffice ? (selectedOffice as OfficeLocation).id : null
          }
        />
      )}

      {/* Facility Menu */}
      <FacilityMenu
        currentUser={currentUser}
        facility={activeSectorKey}
        onActivity={onActivity}
      />

      {/* L4+ Log Submission */}
      {currentUser.lvl >= 4 && (
        <div
          style={{
            borderTop: `1px solid ${S.brd}`,
            paddingTop: "15px",
            marginBottom: "20px",
          }}
        >
          <p
            style={{ color: S.blue, fontSize: "0.7rem", marginBottom: "10px" }}
          >
            SUBMIT SECTOR LOG
          </p>
          <input
            type="text"
            placeholder="LOG TITLE"
            value={logTitle}
            onChange={(e) => setLogTitle(e.target.value)}
            style={inputStyle}
          />
          <textarea
            placeholder="LOG BODY"
            value={logBody}
            onChange={(e) => setLogBody(e.target.value)}
            style={textareaStyle}
          />
          {/* Log attachment toolbar */}
          <div
            style={{
              display: "flex",
              gap: "4px",
              marginBottom: "6px",
              flexWrap: "wrap",
            }}
          >
            <button
              type="button"
              data-ocid="log.upload_button"
              title="IMAGE"
              onClick={() => logImageRef.current?.click()}
              style={{ ...btnSmall, padding: "4px 7px", fontSize: "0.8rem" }}
            >
              🖼️
            </button>
            <button
              type="button"
              title="VIDEO"
              onClick={() => logVideoRef.current?.click()}
              style={{ ...btnSmall, padding: "4px 7px", fontSize: "0.8rem" }}
            >
              🎬
            </button>
            <button
              type="button"
              title="AUDIO"
              onClick={() => logAudioRef.current?.click()}
              style={{ ...btnSmall, padding: "4px 7px", fontSize: "0.8rem" }}
            >
              🎵
            </button>
            <button
              type="button"
              title="FILE"
              onClick={() => logFileRef.current?.click()}
              style={{ ...btnSmall, padding: "4px 7px", fontSize: "0.8rem" }}
            >
              📁
            </button>
            <button
              type="button"
              title="GIF"
              onClick={() => {
                setShowLogGifPanel((o) => !o);
                setShowLogEmojiPicker(false);
              }}
              style={{
                ...btnSmall,
                padding: "4px 7px",
                fontSize: "0.8rem",
                background: showLogGifPanel ? "#1a1500" : "#111",
                color: showLogGifPanel ? S.gold : S.dim,
              }}
            >
              GIF
            </button>
            <button
              type="button"
              title="EMOJI"
              onClick={() => {
                setShowLogEmojiPicker((o) => !o);
                setShowLogGifPanel(false);
              }}
              style={{
                ...btnSmall,
                padding: "4px 7px",
                fontSize: "0.8rem",
                background: showLogEmojiPicker ? "#1a1500" : "#111",
                color: showLogEmojiPicker ? S.gold : S.dim,
              }}
            >
              😊
            </button>
          </div>
          {showLogGifPanel && (
            <div
              style={{
                background: "#080808",
                border: `1px solid ${S.brd}`,
                padding: "6px",
                marginBottom: "6px",
              }}
            >
              <input
                type="text"
                placeholder="PASTE GIF URL..."
                value={logGifUrl}
                onChange={(e) => setLogGifUrl(e.target.value)}
                style={{
                  ...inputStyle,
                  margin: "0 0 4px 0",
                  fontSize: "0.65rem",
                }}
              />
              <div style={{ display: "flex", gap: "5px" }}>
                <button
                  type="button"
                  onClick={() => {
                    if (logGifUrl.trim()) {
                      setLogAttachments((p) => [
                        ...p,
                        { type: "gif", url: logGifUrl.trim() },
                      ]);
                      setLogGifUrl("");
                      setShowLogGifPanel(false);
                    }
                  }}
                  style={{ ...btnSmall, background: S.gold, color: "#000" }}
                >
                  ADD
                </button>
                <button
                  type="button"
                  onClick={() => setShowLogGifPanel(false)}
                  style={{ ...btnSmall }}
                >
                  CANCEL
                </button>
              </div>
            </div>
          )}
          {showLogEmojiPicker && (
            <div
              style={{
                background: "#080808",
                border: `1px solid ${S.brd}`,
                padding: "6px",
                marginBottom: "6px",
              }}
            >
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(8, 1fr)",
                  gap: "2px",
                  maxHeight: "120px",
                  overflowY: "auto",
                }}
              >
                {EMOJI_LIST.map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    onClick={() => {
                      setLogBody((p) => p + emoji);
                    }}
                    style={{
                      background: "transparent",
                      border: "none",
                      cursor: "pointer",
                      fontSize: "1rem",
                      padding: "2px",
                    }}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            </div>
          )}
          {logAttachments.length > 0 && (
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: "4px",
                marginBottom: "6px",
              }}
            >
              {logAttachments.map((att, idx) => (
                <div
                  key={`la-${att.type}-${idx}`}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "3px",
                    border: `1px solid ${S.gold}55`,
                    background: "#0a0800",
                    padding: "3px 6px",
                    fontSize: "0.6rem",
                    color: S.gold,
                  }}
                >
                  {att.type === "image" && <span>🖼️</span>}
                  {att.type === "gif" && <span>GIF</span>}
                  {att.type === "video" && <span>🎬</span>}
                  {att.type === "audio" && <span>🎵</span>}
                  {att.type === "file" && <span>📁</span>}
                  <span
                    style={{
                      maxWidth: "60px",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {att.name || att.type.toUpperCase()}
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      setLogAttachments((p) => p.filter((_, i) => i !== idx))
                    }
                    style={{
                      background: "none",
                      border: "none",
                      color: S.red,
                      cursor: "pointer",
                      padding: "0 2px",
                      fontSize: "0.7rem",
                    }}
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}
          {/* Hidden file inputs */}
          <input
            ref={logImageRef}
            type="file"
            accept="image/*"
            style={{ display: "none" }}
            onChange={(e) => handleLogFileUpload(e, "image")}
          />
          <input
            ref={logFileRef}
            type="file"
            accept=".pdf,.doc,.docx,.txt,.csv,.xls,.xlsx"
            style={{ display: "none" }}
            onChange={(e) => handleLogFileUpload(e, "file")}
          />
          <input
            ref={logVideoRef}
            type="file"
            accept="video/*"
            style={{ display: "none" }}
            onChange={(e) => handleLogFileUpload(e, "video")}
          />
          <input
            ref={logAudioRef}
            type="file"
            accept="audio/*"
            style={{ display: "none" }}
            onChange={(e) => handleLogFileUpload(e, "audio")}
          />
          <select
            value={logLevel}
            onChange={(e) => setLogLevel(Number.parseInt(e.target.value))}
            style={selectStyle}
          >
            {[1, 2, 3, 4, 5, 6].map((n) => (
              <option key={n} value={n}>
                LEVEL {n} CLEARANCE
              </option>
            ))}
          </select>
          {/* L6: Sector Category Management */}
          {currentUser.lvl === 6 && (
            <div style={{ marginTop: "8px", marginBottom: "8px" }}>
              <button
                type="button"
                onClick={() => setSectorCatMgrOpen((v) => !v)}
                style={{
                  background: "transparent",
                  border: "none",
                  color: S.dim,
                  cursor: "pointer",
                  fontSize: "0.6rem",
                  letterSpacing: "2px",
                  padding: "0 0 4px 0",
                  fontFamily: "'JetBrains Mono', 'Courier New', monospace",
                }}
              >
                {sectorCatMgrOpen ? "▲" : "▼"} LOG CATEGORIES [
                {sectorCategories.length}]
              </button>
              {sectorCatMgrOpen && (
                <div
                  style={{
                    background: "#0a0a0a",
                    border: `1px solid ${S.brd}`,
                    padding: "8px",
                    marginBottom: "8px",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      flexWrap: "wrap",
                      gap: "4px",
                      marginBottom: "8px",
                    }}
                  >
                    {sectorCategories.length === 0 && (
                      <span style={{ fontSize: "0.6rem", color: S.dim }}>
                        NO CATEGORIES YET
                      </span>
                    )}
                    {sectorCategories.map((cat) => (
                      <span
                        key={cat}
                        style={{
                          background: "#1a1a1a",
                          border: "1px solid #333",
                          borderRadius: "4px",
                          padding: "2px 8px",
                          fontSize: "0.7rem",
                          color: "#aaa",
                          display: "flex",
                          alignItems: "center",
                          gap: "4px",
                        }}
                      >
                        {cat}
                        <button
                          type="button"
                          onClick={() => {
                            const updated = sectorCategories.filter(
                              (c) => c !== cat,
                            );
                            setSectorCategories(activeSectorKey, updated);
                            setSectorCategoriesState(updated);
                          }}
                          style={{
                            background: "none",
                            border: "none",
                            color: S.red,
                            cursor: "pointer",
                            fontSize: "0.7rem",
                            padding: "0",
                            lineHeight: 1,
                          }}
                        >
                          ✕
                        </button>
                      </span>
                    ))}
                  </div>
                  <div style={{ display: "flex", gap: "6px" }}>
                    <input
                      type="text"
                      placeholder="NEW LOG CATEGORY..."
                      value={newSectorCatName}
                      onChange={(e) => setNewSectorCatName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && newSectorCatName.trim()) {
                          const cat = newSectorCatName.trim().toUpperCase();
                          if (!sectorCategories.includes(cat)) {
                            const updated = [...sectorCategories, cat];
                            setSectorCategories(activeSectorKey, updated);
                            setSectorCategoriesState(updated);
                          }
                          setNewSectorCatName("");
                        }
                      }}
                      style={{
                        ...inputStyle,
                        flex: 1,
                        fontSize: "0.65rem",
                        marginBottom: 0,
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => {
                        const cat = newSectorCatName.trim().toUpperCase();
                        if (cat && !sectorCategories.includes(cat)) {
                          const updated = [...sectorCategories, cat];
                          setSectorCategories(activeSectorKey, updated);
                          setSectorCategoriesState(updated);
                        }
                        setNewSectorCatName("");
                      }}
                      style={{
                        ...btnSmall,
                        background: "#1a1500",
                        color: S.gold,
                        border: `1px solid ${S.gold}44`,
                        fontSize: "0.65rem",
                      }}
                    >
                      ADD
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Category selector for log */}
          {sectorCategories.length > 0 && (
            <select
              value={selectedLogCategory}
              onChange={(e) => setSelectedLogCategory(e.target.value)}
              style={{ ...selectStyle, marginBottom: "8px" }}
            >
              <option value="">NO CATEGORY</option>
              {sectorCategories.map((cat) => (
                <option key={cat} value={cat}>
                  {cat}
                </option>
              ))}
            </select>
          )}

          <button
            type="button"
            data-ocid="log.submit_button"
            style={{ ...btnPrimary, marginTop: "8px" }}
            onClick={submitLog}
          >
            SUBMIT LOG
          </button>
        </div>
      )}

      {/* L4+ Admin Post */}
      {currentUser.lvl >= 4 && (
        <div
          style={{
            borderTop: `1px solid ${S.brd}`,
            paddingTop: "15px",
            marginBottom: "20px",
          }}
        >
          <p
            style={{ color: S.gold, fontSize: "0.7rem", marginBottom: "10px" }}
          >
            ADMIN TRANSMISSION
          </p>
          <textarea
            placeholder="TRANSMISSION CONTENT"
            value={postTxt}
            onChange={(e) => setPostTxt(e.target.value)}
            style={textareaStyle}
          />
          {/* Post attachment toolbar */}
          <div
            style={{
              display: "flex",
              gap: "4px",
              marginBottom: "6px",
              flexWrap: "wrap",
            }}
          >
            <button
              type="button"
              data-ocid="post.upload_button"
              title="IMAGE"
              onClick={() => postImageRef.current?.click()}
              style={{ ...btnSmall, padding: "4px 7px", fontSize: "0.8rem" }}
            >
              🖼️
            </button>
            <button
              type="button"
              title="VIDEO"
              onClick={() => postVideoRef.current?.click()}
              style={{ ...btnSmall, padding: "4px 7px", fontSize: "0.8rem" }}
            >
              🎬
            </button>
            <button
              type="button"
              title="AUDIO"
              onClick={() => postAudioRef.current?.click()}
              style={{ ...btnSmall, padding: "4px 7px", fontSize: "0.8rem" }}
            >
              🎵
            </button>
            <button
              type="button"
              title="FILE"
              onClick={() => postFileRef.current?.click()}
              style={{ ...btnSmall, padding: "4px 7px", fontSize: "0.8rem" }}
            >
              📁
            </button>
            <button
              type="button"
              title="GIF"
              onClick={() => {
                setShowPostGifPanel((o) => !o);
                setShowPostEmojiPicker(false);
              }}
              style={{
                ...btnSmall,
                padding: "4px 7px",
                fontSize: "0.8rem",
                background: showPostGifPanel ? "#1a1500" : "#111",
                color: showPostGifPanel ? S.gold : S.dim,
              }}
            >
              GIF
            </button>
            <button
              type="button"
              title="EMOJI"
              onClick={() => {
                setShowPostEmojiPicker((o) => !o);
                setShowPostGifPanel(false);
              }}
              style={{
                ...btnSmall,
                padding: "4px 7px",
                fontSize: "0.8rem",
                background: showPostEmojiPicker ? "#1a1500" : "#111",
                color: showPostEmojiPicker ? S.gold : S.dim,
              }}
            >
              😊
            </button>
          </div>
          {showPostGifPanel && (
            <div
              style={{
                background: "#080808",
                border: `1px solid ${S.brd}`,
                padding: "6px",
                marginBottom: "6px",
              }}
            >
              <input
                type="text"
                placeholder="PASTE GIF URL..."
                value={postGifUrl}
                onChange={(e) => setPostGifUrl(e.target.value)}
                style={{
                  ...inputStyle,
                  margin: "0 0 4px 0",
                  fontSize: "0.65rem",
                }}
              />
              <div style={{ display: "flex", gap: "5px" }}>
                <button
                  type="button"
                  onClick={() => {
                    if (postGifUrl.trim()) {
                      setPostAttachments((p) => [
                        ...p,
                        { type: "gif", url: postGifUrl.trim() },
                      ]);
                      setPostGifUrl("");
                      setShowPostGifPanel(false);
                    }
                  }}
                  style={{ ...btnSmall, background: S.gold, color: "#000" }}
                >
                  ADD
                </button>
                <button
                  type="button"
                  onClick={() => setShowPostGifPanel(false)}
                  style={{ ...btnSmall }}
                >
                  CANCEL
                </button>
              </div>
            </div>
          )}
          {showPostEmojiPicker && (
            <div
              style={{
                background: "#080808",
                border: `1px solid ${S.brd}`,
                padding: "6px",
                marginBottom: "6px",
              }}
            >
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(8, 1fr)",
                  gap: "2px",
                  maxHeight: "120px",
                  overflowY: "auto",
                }}
              >
                {EMOJI_LIST.map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    onClick={() => {
                      setPostTxt((p) => p + emoji);
                    }}
                    style={{
                      background: "transparent",
                      border: "none",
                      cursor: "pointer",
                      fontSize: "1rem",
                      padding: "2px",
                    }}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            </div>
          )}
          {postAttachments.length > 0 && (
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: "4px",
                marginBottom: "6px",
              }}
            >
              {postAttachments.map((att, idx) => (
                <div
                  key={`pa-${att.type}-${idx}`}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "3px",
                    border: `1px solid ${S.gold}55`,
                    background: "#0a0800",
                    padding: "3px 6px",
                    fontSize: "0.6rem",
                    color: S.gold,
                  }}
                >
                  {att.type === "image" && <span>🖼️</span>}
                  {att.type === "gif" && <span>GIF</span>}
                  {att.type === "video" && <span>🎬</span>}
                  {att.type === "audio" && <span>🎵</span>}
                  {att.type === "file" && <span>📁</span>}
                  <span
                    style={{
                      maxWidth: "60px",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {att.name || att.type.toUpperCase()}
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      setPostAttachments((p) => p.filter((_, i) => i !== idx))
                    }
                    style={{
                      background: "none",
                      border: "none",
                      color: S.red,
                      cursor: "pointer",
                      padding: "0 2px",
                      fontSize: "0.7rem",
                    }}
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}
          {/* Hidden file inputs */}
          <input
            ref={postImageRef}
            type="file"
            accept="image/*"
            style={{ display: "none" }}
            onChange={(e) => handlePostFileUpload(e, "image")}
          />
          <input
            ref={postFileRef}
            type="file"
            accept=".pdf,.doc,.docx,.txt,.csv,.xls,.xlsx"
            style={{ display: "none" }}
            onChange={(e) => handlePostFileUpload(e, "file")}
          />
          <input
            ref={postVideoRef}
            type="file"
            accept="video/*"
            style={{ display: "none" }}
            onChange={(e) => handlePostFileUpload(e, "video")}
          />
          <input
            ref={postAudioRef}
            type="file"
            accept="audio/*"
            style={{ display: "none" }}
            onChange={(e) => handlePostFileUpload(e, "audio")}
          />
          <select
            value={postMinLvl}
            onChange={(e) => setPostMinLvl(Number.parseInt(e.target.value))}
            style={selectStyle}
          >
            {[1, 2, 3, 4, 5, 6].map((n) => (
              <option key={n} value={n}>
                MIN LEVEL {n}
              </option>
            ))}
          </select>
          <button
            type="button"
            data-ocid="post.submit_button"
            style={{ ...btnPrimary, marginTop: "8px" }}
            onClick={makePost}
          >
            TRANSMIT
          </button>
        </div>
      )}

      {/* Admin Posts Feed */}
      <div style={{ borderTop: `1px solid ${S.brd}`, paddingTop: "15px" }}>
        <p style={{ color: S.dim, fontSize: "0.7rem", marginBottom: "10px" }}>
          ADMIN FEED
        </p>
        <input
          type="text"
          value={adminFeedSearch}
          onChange={(e) => setAdminFeedSearch(e.target.value)}
          placeholder="SEARCH ADMIN FEED..."
          data-ocid="admin_feed.search_input"
          style={{
            width: "100%",
            background: "#0a0a0a",
            border: "1px solid #333",
            color: "#e0e0e0",
            padding: "6px 10px",
            fontSize: "0.65rem",
            fontFamily:
              "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
            fontWeight: 700,
            letterSpacing: "1px",
            marginBottom: "8px",
            outline: "none",
            boxSizing: "border-box",
          }}
        />
        {filteredPosts.length === 0 ? (
          <p style={{ opacity: 0.4, fontSize: "0.75rem" }}>
            No posts available for your level.
          </p>
        ) : (
          <div
            className="xution-scroll"
            style={{
              maxHeight: "250px",
              overflowY: "auto",
              border: `1px solid ${S.brd}`,
              padding: "10px",
              background: "#050505",
              marginBottom: "10px",
            }}
          >
            {[...filteredPosts].reverse().map((p, i) => {
              const postId = p.id || `${p.author}-${p.date}-${i}`;
              const canModify =
                currentUser.lvl === 6 || p.author === currentUser.name;
              const isEditing = postId in editingPost;
              return (
                <div
                  key={`post-${postId}`}
                  style={{
                    marginBottom: "10px",
                    borderBottom: "1px solid #222",
                    paddingBottom: "8px",
                    fontSize: "0.75rem",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "flex-start",
                      gap: "8px",
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <strong style={{ color: S.gold }}>BY: {p.author}</strong>
                      <br />
                      <small style={{ color: S.dim }}>{p.date}</small>
                    </div>
                    {canModify && !isEditing && (
                      <div
                        style={{ display: "flex", gap: "5px", flexShrink: 0 }}
                      >
                        <button
                          type="button"
                          style={{
                            ...btnSmall,
                            background: "#1a1500",
                            color: S.gold,
                            border: `1px solid ${S.gold}44`,
                            padding: "4px 8px",
                            flex: "none",
                          }}
                          onClick={() =>
                            setEditingPost((prev) => ({
                              ...prev,
                              [postId]: p.content,
                            }))
                          }
                        >
                          EDIT
                        </button>
                        <button
                          type="button"
                          style={{
                            ...btnSmall,
                            background: S.red,
                            color: "#fff",
                            padding: "4px 8px",
                            flex: "none",
                          }}
                          onClick={() => p.id && deletePost(p.id)}
                        >
                          DELETE
                        </button>
                      </div>
                    )}
                  </div>

                  {lockdown ? (
                    <p style={{ opacity: 0.5, margin: "4px 0 0" }}>
                      [REDACTED — LOCKDOWN ACTIVE]
                    </p>
                  ) : isEditing ? (
                    <div style={{ marginTop: "6px" }}>
                      <textarea
                        value={editingPost[postId]}
                        onChange={(e) =>
                          setEditingPost((prev) => ({
                            ...prev,
                            [postId]: e.target.value,
                          }))
                        }
                        style={{
                          ...textareaStyle,
                          margin: "0 0 6px 0",
                          minHeight: "60px",
                          fontSize: "0.75rem",
                        }}
                      />
                      <div style={{ display: "flex", gap: "6px" }}>
                        <button
                          type="button"
                          style={{
                            ...btnSmall,
                            background: S.gold,
                            color: "#000",
                            padding: "6px 12px",
                            flex: "none",
                          }}
                          onClick={() => {
                            if (p.id) saveEditPost(p.id, editingPost[postId]);
                            setEditingPost((prev) => {
                              const next = { ...prev };
                              delete next[postId];
                              return next;
                            });
                          }}
                        >
                          SAVE
                        </button>
                        <button
                          type="button"
                          style={{
                            ...btnSmall,
                            background: "#222",
                            color: S.dim,
                            padding: "6px 12px",
                            flex: "none",
                          }}
                          onClick={() =>
                            setEditingPost((prev) => {
                              const next = { ...prev };
                              delete next[postId];
                              return next;
                            })
                          }
                        >
                          CANCEL
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div style={{ margin: "4px 0 0" }}>
                      <p style={{ color: S.white, margin: 0 }}>{p.content}</p>
                      {p.attachments?.map((att, ai) => {
                        const akey = `post-att-${postId}-${ai}`;
                        if (att.type === "image" || att.type === "gif") {
                          return (
                            <img
                              key={akey}
                              src={att.dataUrl || att.url}
                              alt={att.name || "media"}
                              style={{
                                maxWidth: "100%",
                                maxHeight: "200px",
                                objectFit: "contain",
                                display: "block",
                                marginTop: "6px",
                              }}
                            />
                          );
                        }
                        if (att.type === "video") {
                          return (
                            // biome-ignore lint/a11y/useMediaCaption: user-generated content
                            <video
                              key={akey}
                              controls
                              src={att.dataUrl}
                              style={{
                                maxWidth: "100%",
                                maxHeight: "180px",
                                display: "block",
                                marginTop: "6px",
                              }}
                            />
                          );
                        }
                        if (att.type === "audio") {
                          return (
                            // biome-ignore lint/a11y/useMediaCaption: user-generated content
                            <audio
                              key={akey}
                              controls
                              src={att.dataUrl}
                              style={{ width: "100%", marginTop: "6px" }}
                            />
                          );
                        }
                        if (att.type === "file") {
                          return (
                            <a
                              key={akey}
                              href={att.dataUrl}
                              download={att.name || "file"}
                              style={{
                                display: "flex",
                                alignItems: "center",
                                gap: "4px",
                                color: S.blue,
                                fontSize: "0.65rem",
                                marginTop: "6px",
                                textDecoration: "none",
                                fontWeight: 900,
                              }}
                            >
                              📁 {att.name || "FILE"}
                            </a>
                          );
                        }
                        return null;
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── EditableSection ──────────────────────────────────────────────────────────

function EditableSection({
  title,
  storageKey,
  defaultContent,
  currentUser,
  renderContent,
}: {
  title: string;
  storageKey: string;
  defaultContent: string;
  currentUser: CurrentUser | null;
  renderContent: (text: string) => React.ReactNode;
}) {
  const { actor } = useActor();
  const isSovereign = currentUser?.lvl === 6;
  const [content, setContent] = useState(() =>
    getAboutContent(storageKey, defaultContent),
  );
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  const startEdit = () => {
    setDraft(content);
    setEditing(true);
  };

  const saveEdit = () => {
    setAboutContent(storageKey, draft);
    setContent(draft);
    setEditing(false);
    actor?.setContent(storageKey, draft).catch(() => {});
  };

  const cancelEdit = () => {
    setEditing(false);
  };

  return (
    <div style={{ marginTop: "30px" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "10px",
          marginBottom: "0",
        }}
      >
        <h2
          style={{
            borderLeft: `5px solid ${S.gold}`,
            paddingLeft: "15px",
            fontSize: "1rem",
            letterSpacing: "3px",
            margin: 0,
          }}
        >
          {title}
        </h2>
        {isSovereign && !editing && (
          <button
            type="button"
            onClick={startEdit}
            style={{
              ...btnSmall,
              background: "#1a1500",
              color: S.gold,
              border: `1px solid ${S.gold}44`,
              padding: "5px 10px",
              flex: "none",
              fontSize: "0.6rem",
            }}
          >
            EDIT
          </button>
        )}
      </div>

      {editing ? (
        <div style={{ marginTop: "12px" }}>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            style={{
              ...textareaStyle,
              minHeight: "120px",
              fontSize: "0.8rem",
              margin: "0 0 8px 0",
            }}
          />
          <div style={{ display: "flex", gap: "8px" }}>
            <button
              type="button"
              style={{
                ...btnSmall,
                background: S.gold,
                color: "#000",
                padding: "8px 16px",
                flex: "none",
              }}
              onClick={saveEdit}
            >
              SAVE
            </button>
            <button
              type="button"
              style={{
                ...btnSmall,
                background: "#222",
                color: S.dim,
                padding: "8px 16px",
                flex: "none",
              }}
              onClick={cancelEdit}
            >
              CANCEL
            </button>
          </div>
        </div>
      ) : (
        <div style={{ marginTop: "15px" }}>{renderContent(content)}</div>
      )}
    </div>
  );
}

// ─── AdminSettingsPanel ───────────────────────────────────────────────────────

function AdminSettingsPanel({
  open,
  onClose,
  currentUser,
  lockdown,
  onLockdownToggle,
  onUpdate,
  ebMsg,
  ebActive,
  onEbMsgChange,
  onActivateEB,
  onDeactivateEB,
  contactLink,
  onContactLinkSave,
  transactions,
}: {
  open: boolean;
  onClose: () => void;
  currentUser: CurrentUser;
  lockdown: boolean;
  onLockdownToggle: () => void;
  onUpdate: () => void;
  ebMsg: string;
  ebActive: boolean;
  onEbMsgChange: (msg: string) => void;
  onActivateEB: (msg: string) => void;
  onDeactivateEB: () => void;
  contactLink: string;
  onContactLinkSave: (val: string) => void;
  transactions?: TransactionEntry[];
}) {
  const { actor } = useActor();
  const [db, setDbState] = useState<UserDB>(getDB);
  const [editContactLink, setEditContactLink] = useState(contactLink);
  const [contactSaved, setContactSaved] = useState(false);
  const [qrOpenFor, setQrOpenFor] = useState<Set<string>>(new Set());
  const [sovereignSearch, setSovereignSearch] = useState("");
  const [xutNumbers, setXutNumbers] = useState<Record<string, string>>(() =>
    getXutNumbersMap(),
  );
  const [xutEdits, setXutEdits] = useState<Record<string, string>>({});
  const [credExpanded, setCredExpanded] = useState<Set<string>>(new Set());
  const [credEdits, setCredEdits] = useState<
    Record<string, { username: string; question: string; answer: string }>
  >({});
  const [credStatus, setCredStatus] = useState<
    Record<string, "success" | "error" | "">
  >({});

  const refresh = () => {
    setDbState(getDB());
    setXutNumbers(getXutNumbersMap());
  };

  const handleSaveXut = (memberName: string) => {
    const val = (xutEdits[memberName] ?? "").trim();
    if (!val) return;
    setXutNumberLocal(memberName, val);
    setXutNumbers((prev) => ({ ...prev, [memberName]: val }));
    setXutEdits((prev) => ({ ...prev, [memberName]: "" }));
    actor?.setXutNumber(memberName, val).catch(() => {});
  };

  const handleSaveCredentials = async (memberName: string) => {
    const edit = credEdits[memberName];
    if (!edit) return;
    const newName = edit.username.trim().toUpperCase();
    const newQ = edit.question.trim();
    const newA = edit.answer.trim().toLowerCase();
    if (!newName || !newQ || !newA) return;

    const d = getDB();
    if (!d[memberName]) return;

    try {
      // Update question/answer in backend
      await actor?.updateUserAnswer(memberName, newA).catch(() => {});

      // If username changed, we rename the key and update backend level
      if (newName !== memberName && !d[newName]) {
        const record = { ...d[memberName], q: newQ, a: newA };
        d[newName] = record;
        delete d[memberName];
        setDB(d);
        // update backend: delete old, re-register new
        await actor?.deleteUser(memberName).catch(() => {});
        await actor?.registerUser(newName, newQ, newA).catch(() => {});
        await actor
          ?.updateUserLevel(newName, BigInt(record.lvl))
          .catch(() => {});
      } else {
        d[memberName].q = newQ;
        d[memberName].a = newA;
        setDB(d);
        await actor?.updateUserAnswer(memberName, newA).catch(() => {});
      }

      refresh();
      setCredStatus((prev) => ({ ...prev, [memberName]: "success" }));
      setCredExpanded((prev) => {
        const s = new Set(prev);
        s.delete(memberName);
        return s;
      });
      setTimeout(
        () => setCredStatus((prev) => ({ ...prev, [memberName]: "" })),
        3000,
      );
    } catch {
      setCredStatus((prev) => ({ ...prev, [memberName]: "error" }));
    }
  };

  // Escape key closes panel
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && open) onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  // Lock scroll when panel is open
  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  const changeLvl = (name: string, change: number) => {
    if (lockdown || IMMUNE.includes(name)) return;
    const d = getDB();
    const newLvl = d[name].lvl + change;
    if (newLvl < 1 || newLvl > 6) return;
    d[name].lvl = newLvl;
    setDB(d);
    addActivity(`MODIFIED ${name} TO L${newLvl}`);
    refresh();
    onUpdate();
    actor?.updateUserLevel(name, BigInt(newLvl)).catch(() => {});
  };

  const delMem = (name: string) => {
    if (lockdown || name === currentUser.name || IMMUNE.includes(name)) return;
    if (window.confirm(`TERMINATE IDENTITY: ${name}?`)) {
      const d = getDB();
      delete d[name];
      setDB(d);
      addActivity(`DELETED IDENTITY: ${name}`);
      refresh();
      onUpdate();
      actor?.deleteUser(name).catch(() => {});
    }
  };

  const allSovereignNames = Object.keys(db);
  const memberNames = sovereignSearch.trim()
    ? allSovereignNames.filter((n) =>
        n.toLowerCase().includes(sovereignSearch.toLowerCase()),
      )
    : allSovereignNames;

  if (!open) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        data-ocid="admin_panel.modal"
        role="button"
        tabIndex={-1}
        onClick={onClose}
        onKeyDown={(e) => {
          if (e.key === "Escape" || e.key === "Enter") onClose();
        }}
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0,0,0,0.7)",
          zIndex: 9998,
        }}
      />

      {/* Slide-in Panel */}
      <div
        className="xution-scroll"
        style={{
          position: "fixed",
          top: 0,
          right: 0,
          bottom: 0,
          width: "min(480px, 100vw)",
          background: "#080808",
          borderLeft: `2px solid ${S.gold}`,
          zIndex: 9999,
          overflowY: "auto",
          display: "flex",
          flexDirection: "column",
          fontFamily: "'JetBrains Mono', 'Courier New', monospace",
          fontWeight: 900,
          textTransform: "uppercase",
          boxShadow: `-8px 0 40px rgba(0,0,0,0.8), -2px 0 20px ${S.gold}22`,
        }}
      >
        {/* Panel header */}
        <div
          style={{
            position: "sticky",
            top: 0,
            zIndex: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "16px 20px",
            background: "#040404",
            borderBottom: `1px solid ${S.gold}55`,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <span style={{ fontSize: "1.1rem", color: S.gold }}>⚙</span>
            <span
              style={{
                fontSize: "0.8rem",
                letterSpacing: "4px",
                color: S.gold,
                fontWeight: 900,
              }}
            >
              ADMIN SETTINGS
            </span>
          </div>
          <button
            type="button"
            data-ocid="admin_panel.close_button"
            onClick={onClose}
            style={{
              background: "transparent",
              border: `1px solid ${S.brd}`,
              color: S.dim,
              cursor: "pointer",
              fontFamily: "'JetBrains Mono', 'Courier New', monospace",
              fontWeight: 900,
              fontSize: "0.9rem",
              padding: "4px 10px",
              textTransform: "uppercase",
              letterSpacing: "1px",
              lineHeight: 1,
            }}
          >
            ✕
          </button>
        </div>

        {/* Panel body */}
        <div style={{ padding: "20px", flex: 1 }}>
          {/* ── Fund Management ── */}
          <FundManagement onUpdate={onUpdate} currentUser={currentUser} />

          {/* ── Global Transaction Ledger ── */}
          <GlobalTransactionHistory
            transactions={transactions}
            currentUser={currentUser}
            onReverse={onUpdate}
          />

          {/* ── Emergency Broadcast ── */}
          <div style={{ marginBottom: "30px" }}>
            <div
              style={{
                borderLeft: `5px solid ${ebActive ? S.red : S.dim}`,
                paddingLeft: "15px",
                marginBottom: "12px",
              }}
            >
              <h3
                style={{
                  margin: 0,
                  fontSize: "0.85rem",
                  letterSpacing: "3px",
                  color: ebActive ? S.red : S.dim,
                  fontFamily: "'JetBrains Mono', 'Courier New', monospace",
                  fontWeight: 900,
                  textTransform: "uppercase",
                }}
              >
                EMERGENCY BROADCAST
              </h3>
              <div
                style={{
                  fontSize: "0.55rem",
                  color: S.dim,
                  letterSpacing: "2px",
                  marginTop: "4px",
                }}
              >
                {ebActive
                  ? "ACTIVE — BROADCAST TRANSMITTING"
                  : "INACTIVE — STANDBY"}
              </div>
            </div>
            <input
              type="text"
              placeholder="BROADCAST MESSAGE"
              value={ebMsg}
              onChange={(e) => onEbMsgChange(e.target.value)}
              style={{ ...inputStyle, borderColor: ebActive ? S.red : "#444" }}
              data-ocid="admin_panel.eb.input"
            />
            <button
              type="button"
              data-ocid="admin_panel.eb.submit_button"
              style={{
                ...btnPrimary,
                background: S.red,
                color: "#fff",
                marginTop: "8px",
              }}
              onClick={() => onActivateEB(ebMsg)}
            >
              ACTIVATE BROADCAST
            </button>
            {ebActive && (
              <button
                type="button"
                data-ocid="admin_panel.eb.cancel_button"
                style={{
                  ...btnPrimary,
                  background: "#222",
                  color: S.red,
                  border: `1px solid ${S.red}`,
                  marginTop: "8px",
                }}
                onClick={onDeactivateEB}
              >
                DEACTIVATE BROADCAST
              </button>
            )}
          </div>

          {/* ── Emergency Lockdown ── */}
          <div style={{ marginBottom: "30px" }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                borderLeft: `5px solid ${lockdown ? "#ff6600" : S.dim}`,
                paddingLeft: "15px",
                marginBottom: "10px",
              }}
            >
              <div>
                <h3
                  style={{
                    margin: 0,
                    fontSize: "0.85rem",
                    letterSpacing: "3px",
                    color: lockdown ? "#ff6600" : S.dim,
                    fontFamily: "'JetBrains Mono', 'Courier New', monospace",
                    fontWeight: 900,
                    textTransform: "uppercase",
                  }}
                >
                  EMERGENCY LOCKDOWN
                </h3>
                <div
                  style={{
                    fontSize: "0.55rem",
                    color: S.dim,
                    letterSpacing: "2px",
                    marginTop: "4px",
                  }}
                >
                  {lockdown
                    ? "ACTIVE — PROMOTIONS, DEMOTIONS & DELETIONS BLOCKED. ALL POSTS REDACTED."
                    : "INACTIVE — ALL SYSTEMS NORMAL"}
                </div>
              </div>
              <button
                type="button"
                data-ocid="lockdown.toggle_button"
                onClick={onLockdownToggle}
                style={{
                  ...btnSmall,
                  background: lockdown ? "#222" : "#3a0000",
                  color: lockdown ? "#ff6600" : S.red,
                  border: `1px solid ${lockdown ? "#ff6600" : S.red}`,
                  padding: "8px 16px",
                  flex: "none",
                  fontSize: "0.7rem",
                  marginLeft: "15px",
                }}
              >
                {lockdown ? "🔓 LIFT LOCKDOWN" : "🔒 INITIATE LOCKDOWN"}
              </button>
            </div>
          </div>

          {/* ── Sovereign Database / Member Management ── */}
          <div style={{ marginBottom: "20px" }}>
            <div
              style={{
                borderLeft: `5px solid ${S.red}`,
                paddingLeft: "15px",
                marginBottom: "15px",
              }}
            >
              <h3
                style={{
                  margin: 0,
                  fontSize: "0.85rem",
                  letterSpacing: "3px",
                  color: S.red,
                  fontFamily: "'JetBrains Mono', 'Courier New', monospace",
                  fontWeight: 900,
                  textTransform: "uppercase",
                }}
              >
                SOVEREIGN DATABASE
              </h3>
            </div>
            <div
              style={{
                padding: "8px 12px",
                background: "#0d0000",
                borderLeft: `5px solid ${S.red}`,
                borderBottom: `1px solid ${S.red}44`,
              }}
            >
              <input
                type="text"
                placeholder="SEARCH SOVEREIGN DATABASE..."
                value={sovereignSearch}
                onChange={(e) => setSovereignSearch(e.target.value)}
                style={{
                  width: "100%",
                  background: "transparent",
                  border: "none",
                  outline: "none",
                  color: S.red,
                  fontSize: "0.7rem",
                  fontFamily: "'JetBrains Mono', 'Courier New', monospace",
                  letterSpacing: "1px",
                  fontWeight: 900,
                }}
              />
            </div>
            <div
              style={{
                border: `1px solid ${S.red}44`,
                background: "#0a0000",
                padding: "0",
              }}
            >
              {memberNames.length === 0 ? (
                <div
                  style={{
                    padding: "15px",
                    color: S.dim,
                    fontSize: "0.7rem",
                    textAlign: "center",
                    textTransform: "uppercase",
                  }}
                >
                  NO MEMBERS REGISTERED
                </div>
              ) : (
                memberNames.map((memberName) => {
                  const isImmune = IMMUNE.includes(memberName);
                  const isSelf = memberName === currentUser.name;
                  const canAdmin = !isImmune;
                  return (
                    <div
                      key={memberName}
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        padding: "12px 15px",
                        borderBottom: "1px solid #300",
                        gap: "8px",
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          gap: "8px",
                        }}
                      >
                        <span
                          style={{
                            fontSize: "0.8rem",
                            color: isSelf ? S.gold : S.white,
                            fontWeight: 900,
                            letterSpacing: "1px",
                            flex: 1,
                            minWidth: 0,
                          }}
                        >
                          {memberName} [L{db[memberName]?.lvl ?? "?"}]
                          {isSelf && (
                            <span
                              style={{
                                color: S.green,
                                fontSize: "0.6rem",
                                marginLeft: "6px",
                              }}
                            >
                              ◈ YOU
                            </span>
                          )}
                        </span>
                        {isImmune && (
                          <span
                            style={{
                              color: S.blue,
                              fontSize: "0.6rem",
                              border: `1px solid ${S.blue}`,
                              padding: "2px 5px",
                              flexShrink: 0,
                            }}
                          >
                            IMMUTABLE
                          </span>
                        )}
                      </div>
                      {canAdmin && (
                        <div
                          style={{ display: "flex", gap: "5px", width: "100%" }}
                        >
                          <button
                            type="button"
                            disabled={lockdown}
                            style={{
                              ...btnSmall,
                              background: lockdown ? "#111" : "#1a3a1a",
                              color: lockdown ? S.dim : S.green,
                              border: `1px solid ${lockdown ? S.dim : S.green}44`,
                              cursor: lockdown ? "not-allowed" : "pointer",
                              opacity: lockdown ? 0.5 : 1,
                            }}
                            onClick={() =>
                              !lockdown && changeLvl(memberName, 1)
                            }
                          >
                            LVL +
                          </button>
                          <button
                            type="button"
                            disabled={lockdown}
                            style={{
                              ...btnSmall,
                              background: lockdown ? "#111" : "#1a1a00",
                              color: lockdown ? S.dim : S.gold,
                              border: `1px solid ${lockdown ? S.dim : S.gold}44`,
                              cursor: lockdown ? "not-allowed" : "pointer",
                              opacity: lockdown ? 0.5 : 1,
                            }}
                            onClick={() =>
                              !lockdown && changeLvl(memberName, -1)
                            }
                          >
                            LVL −
                          </button>
                          {!isSelf && (
                            <button
                              type="button"
                              disabled={lockdown}
                              style={{
                                ...btnSmall,
                                background: lockdown ? "#111" : S.red,
                                color: lockdown ? S.dim : "#fff",
                                cursor: lockdown ? "not-allowed" : "pointer",
                                opacity: lockdown ? 0.5 : 1,
                              }}
                              onClick={() => !lockdown && delMem(memberName)}
                            >
                              DELETE
                            </button>
                          )}
                        </div>
                      )}
                      {/* XUT Number Management */}
                      <div
                        style={{
                          display: "flex",
                          gap: "6px",
                          alignItems: "center",
                          flexWrap: "wrap",
                        }}
                      >
                        <span
                          style={{
                            color: S.gold,
                            fontSize: "0.6rem",
                            letterSpacing: "1px",
                            fontWeight: 900,
                          }}
                        >
                          XUT:{" "}
                          {xutNumbers[memberName] || (
                            <span style={{ color: S.dim }}>UNASSIGNED</span>
                          )}
                        </span>
                        <input
                          type="text"
                          placeholder="SET XUT #"
                          value={xutEdits[memberName] ?? ""}
                          onChange={(e) =>
                            setXutEdits((prev) => ({
                              ...prev,
                              [memberName]: e.target.value,
                            }))
                          }
                          onKeyDown={(e) =>
                            e.key === "Enter" && handleSaveXut(memberName)
                          }
                          style={{
                            ...inputStyle,
                            margin: 0,
                            width: "80px",
                            padding: "4px 6px",
                            fontSize: "0.6rem",
                            height: "26px",
                          }}
                        />
                        <button
                          type="button"
                          style={{
                            ...btnSmall,
                            background: "#1a1a00",
                            color: S.gold,
                            border: `1px solid ${S.gold}44`,
                            padding: "4px 8px",
                          }}
                          onClick={() => handleSaveXut(memberName)}
                        >
                          SET
                        </button>
                      </div>
                      {/* QR Management — L6 only */}
                      <div>
                        <button
                          type="button"
                          onClick={() => {
                            setQrOpenFor((prev) => {
                              const next = new Set(prev);
                              if (next.has(memberName)) next.delete(memberName);
                              else next.add(memberName);
                              return next;
                            });
                          }}
                          style={{
                            ...btnSmall,
                            background: qrOpenFor.has(memberName)
                              ? "#0a0a00"
                              : "transparent",
                            color: S.gold,
                            border: `1px solid ${S.gold}44`,
                          }}
                        >
                          QR {qrOpenFor.has(memberName) ? "▾" : "▸"}
                        </button>
                        {qrOpenFor.has(memberName) &&
                          (() => {
                            const memberIdCard = getIdCardImage(memberName);
                            return (
                              <div
                                style={{
                                  background: "#0a0a00",
                                  border: `1px solid ${S.gold}44`,
                                  padding: "10px",
                                  marginTop: "6px",
                                  display: "flex",
                                  flexDirection: "column",
                                  gap: "8px",
                                  alignItems: "flex-start",
                                }}
                              >
                                {memberIdCard ? (
                                  <img
                                    src={memberIdCard}
                                    alt={`ID Card for ${memberName}`}
                                    style={{
                                      width: "120px",
                                      maxHeight: "80px",
                                      objectFit: "contain",
                                      borderRadius: "4px",
                                    }}
                                  />
                                ) : (
                                  <p
                                    style={{
                                      color: S.dim,
                                      fontSize: "0.6rem",
                                      letterSpacing: "1px",
                                      margin: 0,
                                    }}
                                  >
                                    NO ID CARD IMPORTED
                                  </p>
                                )}
                                <div
                                  style={{
                                    display: "flex",
                                    gap: "6px",
                                    flexWrap: "wrap",
                                  }}
                                >
                                  <label
                                    style={{
                                      ...btnSmall,
                                      background: "#1a1a00",
                                      color: S.gold,
                                      border: `1px solid ${S.gold}44`,
                                      cursor: "pointer",
                                    }}
                                  >
                                    IMPORT ID CARD
                                    <input
                                      type="file"
                                      accept="image/*"
                                      style={{ display: "none" }}
                                      onChange={(e) => {
                                        const file = e.target.files?.[0];
                                        if (!file) return;
                                        const reader = new FileReader();
                                        reader.onload = (ev) => {
                                          const dataUrl = ev.target
                                            ?.result as string;
                                          setIdCardImage(memberName, dataUrl);
                                          setQrOpenFor(
                                            (prev) => new Set([...prev]),
                                          );
                                          e.target.value = "";
                                        };
                                        reader.readAsDataURL(file);
                                      }}
                                    />
                                  </label>
                                  {memberIdCard && (
                                    <button
                                      type="button"
                                      data-ocid="sovereign.qr.secondary_button"
                                      onClick={() =>
                                        exportIdCardImage(memberName)
                                      }
                                      style={{
                                        ...btnSmall,
                                        background: "#001a0a",
                                        color: S.green,
                                        border: `1px solid ${S.green}44`,
                                      }}
                                    >
                                      EXPORT ID CARD ↗
                                    </button>
                                  )}
                                </div>
                              </div>
                            );
                          })()}
                      </div>

                      {/* Edit Credentials (L6 only) */}
                      <div>
                        <button
                          type="button"
                          data-ocid="sovereign.credentials.toggle"
                          onClick={() => {
                            const s = new Set(credExpanded);
                            if (s.has(memberName)) {
                              s.delete(memberName);
                            } else {
                              s.add(memberName);
                              setCredEdits((prev) => ({
                                ...prev,
                                [memberName]: {
                                  username: memberName,
                                  question: db[memberName]?.q ?? "",
                                  answer: db[memberName]?.a ?? "",
                                },
                              }));
                            }
                            setCredExpanded(s);
                          }}
                          style={{
                            ...btnSmall,
                            background: credExpanded.has(memberName)
                              ? "#1a001a"
                              : "#111",
                            color: credExpanded.has(memberName)
                              ? "#cc88ff"
                              : S.dim,
                            border: `1px solid ${credExpanded.has(memberName) ? "#cc88ff44" : S.brd}`,
                            fontSize: "0.6rem",
                          }}
                        >
                          ✎ CREDENTIALS{" "}
                          {credExpanded.has(memberName) ? "▾" : "▸"}
                        </button>
                        {credStatus[memberName] === "success" && (
                          <span
                            data-ocid="sovereign.credentials.success_state"
                            style={{
                              color: S.green,
                              fontSize: "0.6rem",
                              marginLeft: "8px",
                              letterSpacing: "1px",
                            }}
                          >
                            ✓ SAVED
                          </span>
                        )}
                        {credStatus[memberName] === "error" && (
                          <span
                            data-ocid="sovereign.credentials.error_state"
                            style={{
                              color: S.red,
                              fontSize: "0.6rem",
                              marginLeft: "8px",
                              letterSpacing: "1px",
                            }}
                          >
                            ✗ ERROR
                          </span>
                        )}
                        {credExpanded.has(memberName) &&
                          credEdits[memberName] && (
                            <div
                              data-ocid="sovereign.credentials.panel"
                              style={{
                                background: "#0a000f",
                                border: "1px solid #cc88ff33",
                                padding: "10px",
                                marginTop: "6px",
                                display: "flex",
                                flexDirection: "column",
                                gap: "6px",
                              }}
                            >
                              <div>
                                <div
                                  style={{
                                    fontSize: "0.55rem",
                                    color: "#cc88ff",
                                    letterSpacing: "1px",
                                    marginBottom: "3px",
                                  }}
                                >
                                  USERNAME
                                </div>
                                <input
                                  type="text"
                                  value={credEdits[memberName].username}
                                  onChange={(e) =>
                                    setCredEdits((prev) => ({
                                      ...prev,
                                      [memberName]: {
                                        ...prev[memberName],
                                        username: e.target.value,
                                      },
                                    }))
                                  }
                                  data-ocid="sovereign.credentials.input"
                                  style={{
                                    ...inputStyle,
                                    margin: 0,
                                    fontSize: "0.7rem",
                                    borderColor: "#cc88ff44",
                                  }}
                                />
                              </div>
                              <div>
                                <div
                                  style={{
                                    fontSize: "0.55rem",
                                    color: "#cc88ff",
                                    letterSpacing: "1px",
                                    marginBottom: "3px",
                                  }}
                                >
                                  SECRET QUESTION
                                </div>
                                <input
                                  type="text"
                                  value={credEdits[memberName].question}
                                  onChange={(e) =>
                                    setCredEdits((prev) => ({
                                      ...prev,
                                      [memberName]: {
                                        ...prev[memberName],
                                        question: e.target.value,
                                      },
                                    }))
                                  }
                                  data-ocid="sovereign.credentials.textarea"
                                  style={{
                                    ...inputStyle,
                                    margin: 0,
                                    fontSize: "0.7rem",
                                    borderColor: "#cc88ff44",
                                  }}
                                />
                              </div>
                              <div>
                                <div
                                  style={{
                                    fontSize: "0.55rem",
                                    color: "#cc88ff",
                                    letterSpacing: "1px",
                                    marginBottom: "3px",
                                  }}
                                >
                                  SECRET ANSWER
                                </div>
                                <input
                                  type="text"
                                  value={credEdits[memberName].answer}
                                  onChange={(e) =>
                                    setCredEdits((prev) => ({
                                      ...prev,
                                      [memberName]: {
                                        ...prev[memberName],
                                        answer: e.target.value,
                                      },
                                    }))
                                  }
                                  style={{
                                    ...inputStyle,
                                    margin: 0,
                                    fontSize: "0.7rem",
                                    borderColor: "#cc88ff44",
                                  }}
                                />
                              </div>
                              <button
                                type="button"
                                data-ocid="sovereign.credentials.save_button"
                                onClick={() =>
                                  handleSaveCredentials(memberName)
                                }
                                style={{
                                  ...btnSmall,
                                  background: "#1a001a",
                                  color: "#cc88ff",
                                  border: "1px solid #cc88ff66",
                                  fontWeight: 900,
                                  marginTop: "4px",
                                }}
                              >
                                SAVE CREDENTIALS
                              </button>
                            </div>
                          )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* ── Contact Command ── */}
          <div style={{ marginBottom: "30px" }}>
            <div
              style={{
                borderLeft: `5px solid ${S.gold}`,
                paddingLeft: "15px",
                marginBottom: "12px",
              }}
            >
              <h3
                style={{
                  margin: 0,
                  fontSize: "0.85rem",
                  letterSpacing: "3px",
                  color: S.gold,
                  fontFamily: "'JetBrains Mono', 'Courier New', monospace",
                  fontWeight: 900,
                  textTransform: "uppercase",
                }}
              >
                CONTACT COMMAND
              </h3>
              <p
                style={{
                  margin: "4px 0 0",
                  fontSize: "0.7rem",
                  color: S.dim,
                  fontFamily: "'JetBrains Mono', 'Courier New', monospace",
                }}
              >
                Set the Contact Command link or email address
              </p>
            </div>
            <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
              <input
                data-ocid="admin_panel.contact.input"
                type="text"
                value={editContactLink}
                onChange={(e) => {
                  setEditContactLink(e.target.value);
                  setContactSaved(false);
                }}
                placeholder="mailto:example@email.com or https://..."
                style={{
                  flex: 1,
                  background: "#111",
                  border: `1px solid ${S.brd}`,
                  color: S.white,
                  padding: "8px 12px",
                  fontFamily: "'JetBrains Mono', 'Courier New', monospace",
                  fontSize: "0.75rem",
                  outline: "none",
                  borderRadius: "2px",
                }}
              />
              <button
                type="button"
                data-ocid="admin_panel.contact.save_button"
                onClick={() => {
                  onContactLinkSave(editContactLink);
                  setContactSaved(true);
                  setTimeout(() => setContactSaved(false), 2000);
                }}
                style={{
                  background: S.gold,
                  color: "#000",
                  border: "none",
                  padding: "8px 16px",
                  fontFamily: "'JetBrains Mono', 'Courier New', monospace",
                  fontWeight: 900,
                  fontSize: "0.75rem",
                  letterSpacing: "2px",
                  textTransform: "uppercase",
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                  borderRadius: "2px",
                }}
              >
                {contactSaved ? "✓ SAVED" : "SAVE"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

// ─── DMInboxOverlay ───────────────────────────────────────────────────────────

function DMInboxOverlay({
  currentUser,
  onClose,
  onOpenDM,
  onOpenGroup,
  dmGroups,
  setDmGroups,
}: {
  currentUser: CurrentUser;
  onClose: () => void;
  onOpenDM: (name: string) => void;
  onOpenGroup: (id: string) => void;
  dmGroups: DMGroup[];
  setDmGroups: (gs: DMGroup[]) => void;
}) {
  const [search, setSearch] = useState("");
  const [inboxTab, setInboxTab] = useState<"dms" | "groups">("dms");
  const [newGroupName, setNewGroupName] = useState("");
  const [newGroupMembers, setNewGroupMembers] = useState<string[]>([]);
  const [showNewGroupForm, setShowNewGroupForm] = useState(false);
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [editingGroupName, setEditingGroupName] = useState("");
  const [allMembers, setAllMembers] = useState<string[]>(() =>
    Object.keys(getDB()).filter((n) => n !== currentUser.name),
  );
  const [tick, setTick] = useState(0);

  // Refresh member list + unread counts every 3s
  useEffect(() => {
    const id = setInterval(() => {
      setAllMembers(Object.keys(getDB()).filter((n) => n !== currentUser.name));
      setTick((t) => t + 1);
    }, 3000);
    return () => clearInterval(id);
  }, [currentUser.name]);

  // Build conversation list: members you have DMs with (or all if none)
  const conversations = allMembers.map((name) => {
    const msgs = getDMs(currentUser.name, name);
    const lastMsg = msgs[msgs.length - 1] ?? null;
    const unread = getDMUnreadCount(currentUser.name, name);
    const isFav = getFavourites(currentUser.name).includes(name);
    const online = getPresence(name);
    return { name, lastMsg, unread, isFav, online };
  });

  // Sort: favourites first, then by last message time desc
  const sorted = conversations.sort((a, b) => {
    if (a.isFav && !b.isFav) return -1;
    if (!a.isFav && b.isFav) return 1;
    const aTs = a.lastMsg ? new Date(a.lastMsg.ts).getTime() : 0;
    const bTs = b.lastMsg ? new Date(b.lastMsg.ts).getTime() : 0;
    return bTs - aTs;
  });

  const filtered = search.trim()
    ? sorted.filter((c) =>
        c.name.toLowerCase().includes(search.trim().toLowerCase()),
      )
    : sorted;

  const totalUnread = sorted.reduce((s, c) => s + c.unread, 0);

  // suppress unused tick warning
  void tick;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9800,
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "flex-end",
        padding: "0 20px 190px 0",
        pointerEvents: "none",
      }}
    >
      {/* Backdrop */}
      <div
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0,0,0,0.6)",
          pointerEvents: "auto",
        }}
        onClick={onClose}
        onKeyDown={(e) => e.key === "Escape" && onClose()}
        role="button"
        tabIndex={-1}
        aria-label="Close DM inbox"
      />

      {/* Panel */}
      <div
        style={{
          position: "relative",
          width: "340px",
          maxWidth: "calc(100vw - 40px)",
          maxHeight: "70vh",
          background: "#0a0a0a",
          border: `2px solid ${S.blue}`,
          display: "flex",
          flexDirection: "column",
          fontFamily: "'JetBrains Mono', 'Courier New', monospace",
          boxShadow: `0 0 30px ${S.blue}33`,
          pointerEvents: "auto",
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "10px 14px",
            borderBottom: `1px solid ${S.brd}`,
            background: "#080808",
            flexShrink: 0,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <span
              style={{
                color: S.blue,
                fontSize: "0.8rem",
                fontWeight: 900,
                letterSpacing: "3px",
                textTransform: "uppercase",
              }}
            >
              💬 MESSAGES
            </span>
            {totalUnread > 0 && (
              <span
                style={{
                  background: S.red,
                  color: "#fff",
                  fontSize: "0.55rem",
                  fontWeight: 900,
                  borderRadius: "10px",
                  padding: "2px 6px",
                  letterSpacing: "0.5px",
                }}
              >
                {totalUnread} NEW
              </span>
            )}
          </div>
          <button
            type="button"
            data-ocid="dm_inbox.close_button"
            onClick={onClose}
            style={{
              background: "transparent",
              border: "none",
              color: S.dim,
              cursor: "pointer",
              fontFamily: "'JetBrains Mono', 'Courier New', monospace",
              fontWeight: 900,
              fontSize: "0.85rem",
              padding: "2px 6px",
              textTransform: "uppercase",
            }}
          >
            [X]
          </button>
        </div>
        {/* Tabs: DMs / Groups */}
        <div
          style={{
            display: "flex",
            borderBottom: `1px solid ${S.brd}`,
            flexShrink: 0,
          }}
        >
          {(["dms", "groups"] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              data-ocid={`dm_inbox.${tab}.tab`}
              onClick={() => setInboxTab(tab)}
              style={{
                flex: 1,
                padding: "8px",
                background: "transparent",
                border: "none",
                borderBottom:
                  inboxTab === tab
                    ? `2px solid ${S.blue}`
                    : "2px solid transparent",
                color: inboxTab === tab ? S.blue : S.dim,
                fontSize: "0.65rem",
                fontWeight: 900,
                cursor: "pointer",
                fontFamily: "inherit",
                textTransform: "uppercase",
                letterSpacing: "2px",
              }}
            >
              {tab === "dms" ? "💬 DMS" : "👥 GROUPS"}
            </button>
          ))}
        </div>
        {/* Search */}
        <div
          style={{
            padding: "8px 14px",
            borderBottom: `1px solid ${S.brd}`,
            flexShrink: 0,
          }}
        >
          <input
            type="text"
            placeholder={
              inboxTab === "dms" ? "SEARCH MEMBERS..." : "SEARCH GROUPS..."
            }
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            data-ocid="dm_inbox.search_input"
            style={{
              ...inputStyle,
              margin: 0,
              fontSize: "0.75rem",
              padding: "8px 10px",
            }}
          />
        </div>
        {/* Conversation list / Groups */}
        {inboxTab === "groups" ? (
          <div
            className="xution-scroll"
            style={{ flex: 1, overflowY: "auto", minHeight: 0 }}
          >
            {/* New Group Button */}
            <div
              style={{
                padding: "8px 14px",
                borderBottom: `1px solid ${S.brd}`,
                flexShrink: 0,
              }}
            >
              <button
                type="button"
                data-ocid="dm_inbox.groups.button"
                onClick={() => setShowNewGroupForm((v) => !v)}
                style={{
                  width: "100%",
                  padding: "8px",
                  background: showNewGroupForm ? S.blue : "transparent",
                  border: `1px solid ${S.blue}`,
                  color: showNewGroupForm ? "#000" : S.blue,
                  fontSize: "0.7rem",
                  fontWeight: 900,
                  cursor: "pointer",
                  fontFamily: "inherit",
                  letterSpacing: "2px",
                }}
              >
                {showNewGroupForm ? "CANCEL" : "+ NEW GROUP"}
              </button>
            </div>
            {showNewGroupForm && (
              <div
                style={{
                  padding: "10px 14px",
                  borderBottom: `1px solid ${S.brd}`,
                  background: "#080808",
                }}
              >
                <input
                  type="text"
                  placeholder="GROUP NAME"
                  value={newGroupName}
                  onChange={(e) => setNewGroupName(e.target.value)}
                  data-ocid="dm_groups.name.input"
                  style={{
                    ...inputStyle,
                    margin: "0 0 8px",
                    fontSize: "0.75rem",
                    padding: "6px 10px",
                  }}
                />
                <div
                  style={{
                    fontSize: "0.6rem",
                    color: S.dim,
                    letterSpacing: "1px",
                    marginBottom: "6px",
                  }}
                >
                  SELECT MEMBERS:
                </div>
                <div
                  style={{ maxHeight: "120px", overflowY: "auto" }}
                  className="xution-scroll"
                >
                  {allMembers.map((m) => (
                    <label
                      key={m}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "8px",
                        padding: "4px 0",
                        cursor: "pointer",
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={newGroupMembers.includes(m)}
                        onChange={() =>
                          setNewGroupMembers((prev) =>
                            prev.includes(m)
                              ? prev.filter((x) => x !== m)
                              : [...prev, m],
                          )
                        }
                        data-ocid="dm_groups.member.checkbox"
                      />
                      <span style={{ color: S.white, fontSize: "0.7rem" }}>
                        {m}
                      </span>
                    </label>
                  ))}
                </div>
                <button
                  type="button"
                  data-ocid="dm_groups.create.button"
                  onClick={() => {
                    if (!newGroupName.trim()) return;
                    const newGroup: DMGroup = {
                      id: `grp_${Date.now()}`,
                      name: newGroupName.trim(),
                      creatorUsername: currentUser.name,
                      members: [currentUser.name, ...newGroupMembers],
                      messages: [],
                    };
                    const updated = [newGroup, ...dmGroups];
                    setDmGroups(updated);
                    setNewGroupName("");
                    setNewGroupMembers([]);
                    setShowNewGroupForm(false);
                  }}
                  style={{
                    ...btnPrimary,
                    marginTop: "8px",
                    padding: "6px 12px",
                    fontSize: "0.7rem",
                  }}
                >
                  CREATE GROUP
                </button>
              </div>
            )}
            {dmGroups.filter(
              (g) =>
                g.members.includes(currentUser.name) &&
                g.name.toLowerCase().includes(search.toLowerCase()),
            ).length === 0 ? (
              <div
                style={{
                  padding: "20px",
                  textAlign: "center",
                  color: S.dim,
                  fontSize: "0.65rem",
                  textTransform: "uppercase",
                  letterSpacing: "2px",
                }}
              >
                {search ? "NO GROUPS FOUND" : "NO GROUPS YET"}
              </div>
            ) : (
              dmGroups
                .filter(
                  (g) =>
                    g.members.includes(currentUser.name) &&
                    g.name.toLowerCase().includes(search.toLowerCase()),
                )
                .map((group) => (
                  <div
                    key={group.id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "8px",
                      padding: "12px 14px",
                      borderBottom: `1px solid ${S.brd}`,
                    }}
                  >
                    {editingGroupId === group.id ? (
                      <input
                        type="text"
                        value={editingGroupName}
                        onChange={(e) => setEditingGroupName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            const updated = dmGroups.map((g) =>
                              g.id === group.id
                                ? { ...g, name: editingGroupName }
                                : g,
                            );
                            setDmGroups(updated);
                            setEditingGroupId(null);
                          } else if (e.key === "Escape")
                            setEditingGroupId(null);
                        }}
                        style={{
                          ...inputStyle,
                          margin: 0,
                          fontSize: "0.75rem",
                          flex: 1,
                        }}
                      />
                    ) : (
                      <button
                        type="button"
                        data-ocid="dm_groups.item"
                        onClick={() => onOpenGroup(group.id)}
                        style={{
                          flex: 1,
                          background: "transparent",
                          border: "none",
                          textAlign: "left",
                          cursor: "pointer",
                          padding: 0,
                        }}
                      >
                        <div
                          style={{
                            color: S.white,
                            fontSize: "0.75rem",
                            fontWeight: 700,
                            letterSpacing: "1px",
                            fontFamily: "inherit",
                          }}
                        >
                          👥 {group.name}
                        </div>
                        <div
                          style={{
                            color: S.dim,
                            fontSize: "0.6rem",
                            marginTop: "2px",
                            letterSpacing: "1px",
                          }}
                        >
                          {group.members.length} MEMBERS
                        </div>
                      </button>
                    )}
                    {group.creatorUsername === currentUser.name &&
                      editingGroupId !== group.id && (
                        <button
                          type="button"
                          data-ocid="dm_groups.edit_button"
                          onClick={() => {
                            setEditingGroupId(group.id);
                            setEditingGroupName(group.name);
                          }}
                          title="RENAME GROUP"
                          style={{
                            background: "transparent",
                            border: `1px solid ${S.gold}44`,
                            color: S.gold,
                            cursor: "pointer",
                            fontSize: "0.65rem",
                            padding: "3px 7px",
                          }}
                        >
                          ✏
                        </button>
                      )}
                    {editingGroupId === group.id && (
                      <button
                        type="button"
                        onClick={() => {
                          const updated = dmGroups.map((g) =>
                            g.id === group.id
                              ? { ...g, name: editingGroupName }
                              : g,
                          );
                          setDmGroups(updated);
                          setEditingGroupId(null);
                        }}
                        style={{
                          background: S.green,
                          border: "none",
                          color: "#000",
                          cursor: "pointer",
                          fontSize: "0.65rem",
                          padding: "3px 7px",
                          fontWeight: 900,
                        }}
                      >
                        ✓
                      </button>
                    )}
                    {group.creatorUsername === currentUser.name && (
                      <button
                        type="button"
                        data-ocid="dm_groups.delete_button"
                        onClick={() => {
                          const updated = dmGroups.filter(
                            (g) => g.id !== group.id,
                          );
                          setDmGroups(updated);
                        }}
                        title="DELETE GROUP"
                        style={{
                          background: "transparent",
                          border: `1px solid ${S.red}44`,
                          color: S.red,
                          cursor: "pointer",
                          fontSize: "0.65rem",
                          padding: "3px 7px",
                        }}
                      >
                        ✕
                      </button>
                    )}
                  </div>
                ))
            )}
          </div>
        ) : (
          <div
            className="xution-scroll"
            style={{
              flex: 1,
              overflowY: "auto",
              minHeight: 0,
            }}
          >
            {filtered.length === 0 ? (
              <div
                style={{
                  padding: "20px",
                  textAlign: "center",
                  color: S.dim,
                  fontSize: "0.65rem",
                  textTransform: "uppercase",
                  letterSpacing: "2px",
                }}
              >
                {search ? "NO RESULTS" : "NO MEMBERS YET"}
              </div>
            ) : (
              filtered.map((conv) => {
                const db = getDB();
                const lvl = db[conv.name]?.lvl ?? "?";
                return (
                  <button
                    key={conv.name}
                    type="button"
                    data-ocid="dm_inbox.item"
                    onClick={() => {
                      onOpenDM(conv.name);
                      onClose();
                    }}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "10px",
                      width: "100%",
                      padding: "12px 14px",
                      borderBottom: `1px solid ${S.brd}`,
                      background: conv.isFav ? "#0a0800" : "transparent",
                      border: "none",
                      cursor: "pointer",
                      textAlign: "left",
                      fontFamily: "'JetBrains Mono', 'Courier New', monospace",
                    }}
                    onMouseEnter={(e) => {
                      (e.currentTarget as HTMLButtonElement).style.background =
                        conv.isFav ? "#151000" : "#111";
                    }}
                    onMouseLeave={(e) => {
                      (e.currentTarget as HTMLButtonElement).style.background =
                        conv.isFav ? "#0a0800" : "transparent";
                    }}
                  >
                    {/* Avatar placeholder */}
                    <div
                      style={{
                        width: "34px",
                        height: "34px",
                        border: `1px solid ${conv.online ? S.green : S.brd}`,
                        background: "#111",
                        flexShrink: 0,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: "0.7rem",
                        color: S.dim,
                        position: "relative",
                        overflow: "hidden",
                      }}
                    >
                      {(() => {
                        const av = getAvatar(conv.name);
                        return av ? (
                          <img
                            src={av}
                            alt=""
                            style={{
                              width: "100%",
                              height: "100%",
                              objectFit: "cover",
                            }}
                          />
                        ) : (
                          <span>{conv.name[0]}</span>
                        );
                      })()}
                      {/* Online dot */}
                      <span
                        style={{
                          position: "absolute",
                          bottom: "1px",
                          right: "1px",
                          width: "7px",
                          height: "7px",
                          borderRadius: "50%",
                          background: conv.online ? S.green : "#333",
                          border: "1px solid #0a0a0a",
                        }}
                      />
                    </div>

                    {/* Info */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "6px",
                          justifyContent: "space-between",
                        }}
                      >
                        <span
                          style={{
                            fontSize: "0.75rem",
                            color: S.white,
                            fontWeight: 900,
                            letterSpacing: "1px",
                            textTransform: "uppercase",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                            maxWidth: "150px",
                          }}
                        >
                          {conv.isFav ? "★ " : ""}
                          {conv.name}
                        </span>
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "4px",
                            flexShrink: 0,
                          }}
                        >
                          <span
                            style={{
                              fontSize: "0.5rem",
                              color: S.dim,
                              letterSpacing: "1px",
                            }}
                          >
                            L{lvl}
                          </span>
                          {conv.unread > 0 && (
                            <span
                              style={{
                                background: S.red,
                                color: "#fff",
                                fontSize: "0.5rem",
                                fontWeight: 900,
                                borderRadius: "8px",
                                padding: "1px 5px",
                              }}
                            >
                              {conv.unread}
                            </span>
                          )}
                        </div>
                      </div>
                      <div
                        style={{
                          fontSize: "0.6rem",
                          color: S.dim,
                          letterSpacing: "0.5px",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                          marginTop: "2px",
                          textTransform: "uppercase",
                        }}
                      >
                        {(() => {
                          const msg = conv.lastMsg;
                          if (!msg) return "NO MESSAGES YET";
                          const prefix =
                            msg.from === currentUser.name ? "YOU" : msg.from;
                          if (msg.attachments?.length) {
                            const a = msg.attachments[0];
                            const label =
                              a.type === "image"
                                ? "📷 IMAGE"
                                : a.type === "video"
                                  ? "🎬 VIDEO"
                                  : a.type === "audio"
                                    ? "🎵 AUDIO"
                                    : a.type === "file"
                                      ? "📁 FILE"
                                      : a.type === "gif"
                                        ? "🌀 GIF"
                                        : "🎤 VOICE";
                            return `${prefix}: ${msg.text ? `${msg.text} ` : ""}${label}`;
                          }
                          return `${prefix}: ${msg.text}`;
                        })()}
                      </div>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        )}{" "}
        {/* end ternary groups/dms */}
      </div>
    </div>
  );
}

// ─── GroupChatPanel ───────────────────────────────────────────────────────────

function GroupChatPanel({
  currentUser,
  groupId,
  dmGroups,
  setDmGroups,
  onClose,
}: {
  currentUser: CurrentUser;
  groupId: string;
  dmGroups: DMGroup[];
  setDmGroups: (gs: DMGroup[]) => void;
  onClose: () => void;
}) {
  const group = dmGroups.find((g) => g.id === groupId);
  const [input, setInput] = useState("");
  const [editingName, setEditingName] = useState(false);
  const [nameVal, setNameVal] = useState(group?.name ?? "");
  const scrollRef = useRef<HTMLDivElement>(null);

  // Rich features state (mirrors DMPanel)
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [pendingAttachments, setPendingAttachments] = useState<
    (DMAttachment & { _key: number })[]
  >([]);
  const pendingKeyRef = useRef(0);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [emojiTab, setEmojiTab] = useState<"all" | "saved" | "custom">("all");
  const [savedEmojis, setSavedEmojisState] = useState<string[]>(getSavedEmojis);
  const [customEmojis, setCustomEmojisState] =
    useState<CustomEmoji[]>(getCustomEmojis);
  const customEmojiInputRef = useRef<HTMLInputElement>(null);
  const [showGifPanel, setShowGifPanel] = useState(false);
  const [gifTab, setGifTab] = useState<"add" | "saved">("add");
  const [savedGifs, setSavedGifsState] = useState<SavedGif[]>(getSavedGifs);
  const [gifUrl, setGifUrl] = useState("");
  const [gifLabel, setGifLabel] = useState("");
  const [isRecording, setIsRecording] = useState(false);
  const [recordingError, setRecordingError] = useState("");

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const audioInputRef = useRef<HTMLInputElement>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll on message count
  useEffect(() => {
    if (scrollRef.current)
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [group?.messages.length]);

  if (!group) return null;
  const isCreator = group.creatorUsername === currentUser.name;

  const sendMessage = () => {
    const text = input.trim();
    if (!text && pendingAttachments.length === 0) return;
    const attachmentsToSend: DMAttachment[] = pendingAttachments.map(
      ({ _key: _k, ...rest }) => rest,
    );
    const newMsg: DMMessage = {
      from: currentUser.name,
      text,
      ts: new Date().toISOString(),
      ...(attachmentsToSend.length > 0
        ? { attachments: attachmentsToSend }
        : {}),
    };
    const updated = dmGroups.map((g) =>
      g.id === groupId ? { ...g, messages: [...g.messages, newMsg] } : g,
    );
    setDmGroups(updated);
    setInput("");
    setPendingAttachments([]);
    setShowEmojiPicker(false);
    setShowGifPanel(false);
  };

  const renameGroup = () => {
    if (!nameVal.trim()) return;
    const updated = dmGroups.map((g) =>
      g.id === groupId ? { ...g, name: nameVal.trim() } : g,
    );
    setDmGroups(updated);
    setEditingName(false);
  };

  const readFileAsDataUrl = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const dataUrl = await readFileAsDataUrl(file);
    setPendingAttachments((prev) => [
      ...prev,
      {
        type: "image",
        dataUrl,
        name: file.name,
        mimeType: file.type,
        _key: ++pendingKeyRef.current,
      },
    ]);
    e.target.value = "";
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const dataUrl = await readFileAsDataUrl(file);
    setPendingAttachments((prev) => [
      ...prev,
      {
        type: "file",
        dataUrl,
        name: file.name,
        mimeType: file.type,
        _key: ++pendingKeyRef.current,
      },
    ]);
    e.target.value = "";
  };

  const handleVideoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const dataUrl = await readFileAsDataUrl(file);
    setPendingAttachments((prev) => [
      ...prev,
      {
        type: "video",
        dataUrl,
        name: file.name,
        mimeType: file.type,
        _key: ++pendingKeyRef.current,
      },
    ]);
    e.target.value = "";
  };

  const handleAudioUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const dataUrl = await readFileAsDataUrl(file);
    setPendingAttachments((prev) => [
      ...prev,
      {
        type: "audio",
        dataUrl,
        name: file.name,
        mimeType: file.type,
        _key: ++pendingKeyRef.current,
      },
    ]);
    e.target.value = "";
  };

  const handleAddGif = () => {
    if (!gifUrl.trim()) return;
    setPendingAttachments((prev) => [
      ...prev,
      { type: "gif", url: gifUrl.trim(), _key: ++pendingKeyRef.current },
    ]);
    setGifUrl("");
    setGifLabel("");
    setShowGifPanel(false);
  };

  const handleSaveGif = () => {
    if (!gifUrl.trim()) return;
    const updated = addSavedGif(
      gifUrl.trim(),
      gifLabel.trim() || gifUrl.trim(),
    );
    setSavedGifsState(updated);
    setGifUrl("");
    setGifLabel("");
  };

  const handleDeleteSavedGif = (url: string) => {
    const updated = removeSavedGif(url);
    setSavedGifsState(updated);
  };

  const handleToggleSavedEmoji = (emoji: string) => {
    const updated = toggleSavedEmoji(emoji);
    setSavedEmojisState(updated);
  };

  const handleEmojiClick = (emoji: string) => {
    setInput((prev) => prev + emoji);
  };

  const startRecording = async () => {
    setRecordingError("");
    if (!navigator.mediaDevices?.getUserMedia) {
      setRecordingError("MIC NOT SUPPORTED");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      audioChunksRef.current = [];
      mr.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };
      mr.start();
      mediaRecorderRef.current = mr;
      setIsRecording(true);
    } catch {
      setRecordingError("MIC ACCESS DENIED");
    }
  };

  const stopRecording = () => {
    const mr = mediaRecorderRef.current;
    if (!mr) return;
    mr.onstop = () => {
      const blob = new Blob(audioChunksRef.current, { type: "audio/webm" });
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result as string;
        setPendingAttachments((prev) => [
          ...prev,
          {
            type: "voice",
            dataUrl,
            mimeType: "audio/webm",
            _key: ++pendingKeyRef.current,
          },
        ]);
      };
      reader.readAsDataURL(blob);
      for (const t of mr.stream.getTracks()) t.stop();
      mediaRecorderRef.current = null;
    };
    mr.stop();
    setIsRecording(false);
  };

  const removePending = (key: number) => {
    setPendingAttachments((prev) => prev.filter((a) => a._key !== key));
  };

  const toolbarBtnStyle: React.CSSProperties = {
    width: "28px",
    height: "28px",
    background: "#111",
    border: `1px solid ${S.brd}`,
    color: S.dim,
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: "0.85rem",
    flexShrink: 0,
    padding: 0,
    fontFamily: "inherit",
  };

  const displayedMessages =
    searchOpen && searchQuery.trim()
      ? group.messages.filter(
          (m) =>
            m.text.toLowerCase().includes(searchQuery.toLowerCase()) ||
            m.from.toLowerCase().includes(searchQuery.toLowerCase()),
        )
      : group.messages;

  const renderAttachment = (att: DMAttachment, key: string) => {
    if (att.type === "image" || att.type === "gif") {
      const src = att.dataUrl || att.url || "";
      return (
        <img
          key={key}
          src={src}
          alt={att.name || "image"}
          style={{
            maxWidth: "100%",
            maxHeight: "180px",
            objectFit: "contain",
            display: "block",
            marginTop: "4px",
          }}
        />
      );
    }
    if (att.type === "video") {
      return (
        // biome-ignore lint/a11y/useMediaCaption: user-sent video in group DM
        <video
          key={key}
          controls
          src={att.dataUrl}
          style={{
            maxWidth: "100%",
            maxHeight: "160px",
            display: "block",
            marginTop: "4px",
          }}
        />
      );
    }
    if (att.type === "audio") {
      return (
        // biome-ignore lint/a11y/useMediaCaption: user-sent audio in group DM
        <audio
          key={key}
          controls
          src={att.dataUrl}
          style={{ width: "100%", marginTop: "4px" }}
        />
      );
    }
    if (att.type === "voice") {
      return (
        <div key={key} style={{ marginTop: "4px" }}>
          <div
            style={{
              fontSize: "0.55rem",
              color: S.blue,
              marginBottom: "2px",
              letterSpacing: "1px",
            }}
          >
            🎤 VOICE MSG
          </div>
          {/* biome-ignore lint/a11y/useMediaCaption: user-sent voice message in group DM */}
          <audio controls src={att.dataUrl} style={{ width: "100%" }} />
        </div>
      );
    }
    if (att.type === "file") {
      return (
        <a
          key={key}
          href={att.dataUrl}
          download={att.name || "file"}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "4px",
            color: S.blue,
            fontSize: "0.65rem",
            marginTop: "4px",
            textDecoration: "none",
            fontWeight: 900,
            letterSpacing: "1px",
          }}
        >
          📁 {att.name || "FILE"}
        </a>
      );
    }
    return null;
  };

  return (
    <div
      style={{
        position: "fixed",
        bottom: "200px",
        right: "20px",
        width: "340px",
        maxWidth: "calc(100vw - 40px)",
        maxHeight: "70vh",
        background: "#0a0a0a",
        border: `2px solid ${S.gold}`,
        display: "flex",
        flexDirection: "column",
        fontFamily: "'JetBrains Mono', 'Courier New', monospace",
        boxShadow: `0 0 30px ${S.gold}33`,
        zIndex: 9850,
      }}
    >
      {/* Hidden file inputs */}
      <input
        ref={imageInputRef}
        type="file"
        accept="image/*"
        style={{ display: "none" }}
        onChange={handleImageUpload}
      />
      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf,.doc,.docx,.txt,.csv,.xlsx,.zip"
        style={{ display: "none" }}
        onChange={handleFileUpload}
      />
      <input
        ref={videoInputRef}
        type="file"
        accept="video/*"
        style={{ display: "none" }}
        onChange={handleVideoUpload}
      />
      <input
        ref={audioInputRef}
        type="file"
        accept="audio/*"
        style={{ display: "none" }}
        onChange={handleAudioUpload}
      />

      {/* Header */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "10px 12px",
          borderBottom: `1px solid ${S.brd}`,
          background: "#080808",
          flexShrink: 0,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "6px",
            flex: 1,
            minWidth: 0,
            overflow: "hidden",
          }}
        >
          <span style={{ fontSize: "0.75rem" }}>👥</span>
          {editingName ? (
            <>
              <input
                type="text"
                value={nameVal}
                onChange={(e) => setNameVal(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") renameGroup();
                  else if (e.key === "Escape") setEditingName(false);
                }}
                style={{
                  ...inputStyle,
                  margin: 0,
                  flex: 1,
                  fontSize: "0.7rem",
                  padding: "3px 6px",
                }}
                data-ocid="group_chat.input"
              />
              <button
                type="button"
                onClick={renameGroup}
                data-ocid="group_chat.save_button"
                style={{
                  background: S.gold,
                  border: "none",
                  color: "#000",
                  cursor: "pointer",
                  fontFamily: "inherit",
                  fontWeight: 900,
                  fontSize: "0.6rem",
                  padding: "3px 7px",
                  textTransform: "uppercase",
                  flexShrink: 0,
                }}
              >
                OK
              </button>
              <button
                type="button"
                onClick={() => setEditingName(false)}
                data-ocid="group_chat.cancel_button"
                style={{
                  background: "transparent",
                  border: "none",
                  color: S.dim,
                  cursor: "pointer",
                  fontFamily: "inherit",
                  fontWeight: 900,
                  fontSize: "0.6rem",
                  padding: "3px 6px",
                  flexShrink: 0,
                }}
              >
                ✕
              </button>
            </>
          ) : (
            <>
              <span
                style={{
                  color: S.gold,
                  fontSize: "0.75rem",
                  fontWeight: 900,
                  letterSpacing: "1.5px",
                  textTransform: "uppercase",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {group.name}
              </span>
              <span style={{ fontSize: "0.5rem", color: S.dim, flexShrink: 0 }}>
                {group.members.length} MEMBERS
              </span>
            </>
          )}
        </div>
        {/* Search toggle */}
        <button
          type="button"
          title="SEARCH MESSAGES"
          onClick={() => {
            setSearchOpen((o) => !o);
            setSearchQuery("");
          }}
          style={{
            ...toolbarBtnStyle,
            background: searchOpen ? "#1a1500" : "#111",
            color: searchOpen ? S.gold : S.dim,
            border: "none",
            marginRight: "2px",
          }}
        >
          🔍
        </button>
        {isCreator && !editingName && (
          <button
            type="button"
            data-ocid="group_chat.edit_button"
            onClick={() => setEditingName(true)}
            style={{
              background: "transparent",
              border: "none",
              cursor: "pointer",
              padding: "2px 6px",
              color: S.dim,
              fontSize: "0.7rem",
              flexShrink: 0,
            }}
            title="RENAME GROUP"
          >
            ✏️
          </button>
        )}
        <button
          type="button"
          data-ocid="group_chat.close_button"
          onClick={onClose}
          style={{
            background: "transparent",
            border: "none",
            color: S.dim,
            cursor: "pointer",
            fontFamily: "inherit",
            fontWeight: 900,
            fontSize: "0.85rem",
            padding: "2px 6px",
            textTransform: "uppercase",
            flexShrink: 0,
          }}
        >
          [X]
        </button>
      </div>

      {/* Search bar */}
      {searchOpen && (
        <div
          style={{
            padding: "6px 10px",
            borderBottom: `1px solid ${S.brd}`,
            background: "#080808",
            flexShrink: 0,
          }}
        >
          <input
            type="text"
            placeholder="SEARCH MESSAGES..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{
              ...inputStyle,
              margin: 0,
              fontSize: "0.7rem",
              padding: "6px 8px",
            }}
          />
        </div>
      )}

      {/* Message history */}
      <div
        ref={scrollRef}
        className="xution-scroll"
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "10px 12px",
          display: "flex",
          flexDirection: "column",
          gap: "6px",
          minHeight: 0,
          maxHeight: "280px",
        }}
      >
        {displayedMessages.length === 0 ? (
          <div
            style={{
              color: S.dim,
              fontSize: "0.65rem",
              textAlign: "center",
              padding: "20px 0",
              textTransform: "uppercase",
            }}
          >
            {searchOpen && searchQuery ? "NO RESULTS" : "NO MESSAGES YET"}
          </div>
        ) : (
          displayedMessages.map((msg, i) => {
            const isOwn = msg.from === currentUser.name;
            return (
              <div
                key={`grp-${msg.ts}-${i}`}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: isOwn ? "flex-end" : "flex-start",
                }}
              >
                <div
                  style={{
                    fontSize: "0.6rem",
                    color: S.dim,
                    marginBottom: "2px",
                    textTransform: "uppercase",
                  }}
                >
                  {msg.from}
                </div>
                <div
                  style={{
                    fontSize: "0.7rem",
                    color: isOwn ? S.gold : S.white,
                    background: isOwn ? "#1a1500" : "#111",
                    padding: "5px 8px",
                    maxWidth: "90%",
                    wordBreak: "break-word",
                    textTransform: "uppercase",
                    fontWeight: 900,
                    border: isOwn
                      ? `1px solid ${S.gold}33`
                      : `1px solid ${S.brd}`,
                  }}
                >
                  {msg.text && <span>{msg.text}</span>}
                  {msg.attachments?.map((att, ai) =>
                    renderAttachment(att, `att-${i}-${ai}`),
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Input area */}
      <div style={{ borderTop: `1px solid ${S.brd}`, flexShrink: 0 }}>
        {/* Pending attachments preview */}
        {pendingAttachments.length > 0 && (
          <div
            style={{
              padding: "6px 10px",
              borderBottom: `1px solid ${S.brd}`,
              display: "flex",
              flexWrap: "wrap",
              gap: "5px",
            }}
          >
            {pendingAttachments.map((att) => (
              <div
                key={att._key}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "3px",
                  border: `1px solid ${S.gold}55`,
                  background: "#0a0800",
                  padding: "3px 6px",
                  fontSize: "0.6rem",
                  color: S.gold,
                  letterSpacing: "0.5px",
                }}
              >
                {att.type === "image" && att.dataUrl && (
                  <img
                    src={att.dataUrl}
                    alt=""
                    style={{
                      width: "32px",
                      height: "32px",
                      objectFit: "cover",
                    }}
                  />
                )}
                {att.type === "gif" && (
                  <img
                    src={att.url}
                    alt="gif"
                    style={{
                      width: "32px",
                      height: "32px",
                      objectFit: "cover",
                    }}
                  />
                )}
                {att.type === "video" && <span>🎬</span>}
                {att.type === "audio" && <span>🎵</span>}
                {att.type === "voice" && <span>🎤</span>}
                {att.type === "file" && <span>📁</span>}
                <span
                  style={{
                    maxWidth: "60px",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {att.name || att.type.toUpperCase()}
                </span>
                <button
                  type="button"
                  onClick={() => removePending(att._key)}
                  style={{
                    background: "none",
                    border: "none",
                    color: S.red,
                    cursor: "pointer",
                    padding: "0 2px",
                    fontSize: "0.7rem",
                    lineHeight: 1,
                  }}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}

        {/* GIF panel */}
        {showGifPanel && (
          <div
            style={{
              borderBottom: `1px solid ${S.brd}`,
              background: "#080808",
            }}
          >
            <div
              style={{ display: "flex", borderBottom: `1px solid ${S.brd}` }}
            >
              {(["add", "saved"] as const).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setGifTab(tab)}
                  style={{
                    flex: 1,
                    padding: "5px",
                    background: "transparent",
                    border: "none",
                    borderBottom:
                      gifTab === tab
                        ? `2px solid ${S.gold}`
                        : "2px solid transparent",
                    color: gifTab === tab ? S.gold : S.dim,
                    fontSize: "0.6rem",
                    fontWeight: 900,
                    cursor: "pointer",
                    fontFamily: "inherit",
                    textTransform: "uppercase",
                    letterSpacing: "1px",
                  }}
                >
                  {tab === "add" ? "ADD GIF" : `SAVED (${savedGifs.length})`}
                </button>
              ))}
            </div>
            {gifTab === "add" && (
              <div
                style={{
                  padding: "6px 10px",
                  display: "flex",
                  flexDirection: "column",
                  gap: "4px",
                }}
              >
                <input
                  type="text"
                  placeholder="PASTE GIF URL..."
                  value={gifUrl}
                  onChange={(e) => setGifUrl(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleAddGif()}
                  style={{
                    ...inputStyle,
                    margin: 0,
                    fontSize: "0.65rem",
                    padding: "5px 7px",
                  }}
                />
                <input
                  type="text"
                  placeholder="LABEL (OPTIONAL)..."
                  value={gifLabel}
                  onChange={(e) => setGifLabel(e.target.value)}
                  style={{
                    ...inputStyle,
                    margin: 0,
                    fontSize: "0.65rem",
                    padding: "5px 7px",
                  }}
                />
                <div style={{ display: "flex", gap: "5px" }}>
                  <button
                    type="button"
                    onClick={handleAddGif}
                    style={{
                      flex: 1,
                      background: S.gold,
                      color: "#000",
                      border: "none",
                      padding: "5px",
                      fontWeight: 900,
                      cursor: "pointer",
                      fontSize: "0.65rem",
                      letterSpacing: "1px",
                      fontFamily: "inherit",
                      textTransform: "uppercase",
                    }}
                  >
                    SEND
                  </button>
                  <button
                    type="button"
                    onClick={handleSaveGif}
                    style={{
                      flex: 1,
                      background: "#1a1500",
                      color: S.gold,
                      border: `1px solid ${S.gold}55`,
                      padding: "5px",
                      fontWeight: 900,
                      cursor: "pointer",
                      fontSize: "0.65rem",
                      letterSpacing: "1px",
                      fontFamily: "inherit",
                      textTransform: "uppercase",
                    }}
                  >
                    SAVE
                  </button>
                </div>
              </div>
            )}
            {gifTab === "saved" && (
              <div
                className="xution-scroll"
                style={{
                  maxHeight: "160px",
                  overflowY: "auto",
                  padding: "6px 10px",
                }}
              >
                {savedGifs.length === 0 ? (
                  <div
                    style={{
                      color: S.dim,
                      fontSize: "0.6rem",
                      textAlign: "center",
                      padding: "12px 0",
                      letterSpacing: "1px",
                    }}
                  >
                    NO SAVED GIFS
                  </div>
                ) : (
                  savedGifs.map((gif) => (
                    <div
                      key={gif.url}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "6px",
                        padding: "4px 0",
                        borderBottom: `1px solid ${S.brd}`,
                      }}
                    >
                      <button
                        type="button"
                        onClick={() => {
                          setPendingAttachments((prev) => [
                            ...prev,
                            {
                              type: "gif",
                              url: gif.url,
                              _key: ++pendingKeyRef.current,
                            },
                          ]);
                          setShowGifPanel(false);
                        }}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "6px",
                          flex: 1,
                          background: "none",
                          border: "none",
                          cursor: "pointer",
                          padding: 0,
                          minWidth: 0,
                        }}
                      >
                        <img
                          src={gif.url}
                          alt={gif.label}
                          style={{
                            width: "40px",
                            height: "40px",
                            objectFit: "cover",
                            flexShrink: 0,
                          }}
                        />
                        <span
                          style={{
                            flex: 1,
                            fontSize: "0.6rem",
                            color: S.white,
                            letterSpacing: "0.5px",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                            textAlign: "left",
                          }}
                        >
                          {gif.label}
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteSavedGif(gif.url)}
                        style={{
                          background: "none",
                          border: "none",
                          color: S.red,
                          cursor: "pointer",
                          fontSize: "0.7rem",
                          padding: "2px 4px",
                          flexShrink: 0,
                        }}
                        title="DELETE"
                      >
                        ✕
                      </button>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        )}

        {/* Emoji picker */}
        {showEmojiPicker && (
          <div
            style={{
              borderBottom: `1px solid ${S.brd}`,
              background: "#080808",
            }}
          >
            <div
              style={{ display: "flex", borderBottom: `1px solid ${S.brd}` }}
            >
              {(["all", "saved", "custom"] as const).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setEmojiTab(tab)}
                  style={{
                    flex: 1,
                    padding: "5px",
                    background: "transparent",
                    border: "none",
                    borderBottom:
                      emojiTab === tab
                        ? `2px solid ${S.gold}`
                        : "2px solid transparent",
                    color: emojiTab === tab ? S.gold : S.dim,
                    fontSize: "0.6rem",
                    fontWeight: 900,
                    cursor: "pointer",
                    fontFamily: "inherit",
                    textTransform: "uppercase",
                    letterSpacing: "1px",
                  }}
                >
                  {tab === "all"
                    ? "ALL"
                    : tab === "saved"
                      ? `SAVED (${savedEmojis.length})`
                      : `CUSTOM (${customEmojis.length})`}
                </button>
              ))}
            </div>
            <div
              className="xution-scroll"
              style={{
                padding: "6px 10px",
                maxHeight: "130px",
                overflowY: "auto",
              }}
            >
              {emojiTab === "custom" ? (
                <div>
                  <div
                    style={{
                      display: "flex",
                      gap: "6px",
                      padding: "6px 0 8px",
                    }}
                  >
                    <input
                      ref={customEmojiInputRef}
                      type="file"
                      accept="image/*"
                      style={{ display: "none" }}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        const reader = new FileReader();
                        reader.onload = () => {
                          const dataUrl = reader.result as string;
                          const name =
                            file.name.replace(/\.[^.]+$/, "") || "emoji";
                          const newEmoji: CustomEmoji = {
                            id: `ce_${Date.now()}`,
                            name,
                            dataUrl,
                          };
                          const updated = [...customEmojis, newEmoji];
                          saveCustomEmojis(updated);
                          setCustomEmojisState(updated);
                        };
                        reader.readAsDataURL(file);
                        e.target.value = "";
                      }}
                    />
                    <button
                      type="button"
                      data-ocid="group_chat.upload_button"
                      onClick={() => customEmojiInputRef.current?.click()}
                      style={{
                        background: S.gold,
                        border: "none",
                        color: "#000",
                        cursor: "pointer",
                        fontSize: "0.65rem",
                        fontWeight: 900,
                        padding: "4px 10px",
                        fontFamily: "inherit",
                        letterSpacing: "1px",
                        flex: 1,
                      }}
                    >
                      + UPLOAD EMOJI
                    </button>
                  </div>
                  {customEmojis.length === 0 ? (
                    <div
                      style={{
                        color: S.dim,
                        fontSize: "0.6rem",
                        textAlign: "center",
                        padding: "8px 0",
                        letterSpacing: "1px",
                      }}
                    >
                      NO CUSTOM EMOJIS YET
                    </div>
                  ) : (
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "repeat(5, 1fr)",
                        gap: "4px",
                      }}
                    >
                      {customEmojis.map((ce) => (
                        <div key={ce.id} style={{ position: "relative" }}>
                          <button
                            type="button"
                            title={ce.name}
                            onClick={() => {
                              setPendingAttachments((prev) => [
                                ...prev,
                                {
                                  _key: pendingKeyRef.current++,
                                  type: "image" as const,
                                  dataUrl: ce.dataUrl,
                                  name: ce.name,
                                },
                              ]);
                              setShowEmojiPicker(false);
                            }}
                            style={{
                              background: "transparent",
                              border: "1px solid #333",
                              cursor: "pointer",
                              padding: "2px",
                              width: "100%",
                              aspectRatio: "1",
                            }}
                          >
                            <img
                              src={ce.dataUrl}
                              alt={ce.name}
                              style={{
                                width: "100%",
                                height: "100%",
                                objectFit: "contain",
                              }}
                            />
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              const updated = customEmojis.filter(
                                (x) => x.id !== ce.id,
                              );
                              saveCustomEmojis(updated);
                              setCustomEmojisState(updated);
                            }}
                            style={{
                              position: "absolute",
                              top: "-3px",
                              right: "-3px",
                              background: S.red,
                              border: "none",
                              color: "#fff",
                              fontSize: "0.45rem",
                              width: "12px",
                              height: "12px",
                              borderRadius: "50%",
                              cursor: "pointer",
                              padding: 0,
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                            }}
                          >
                            ✕
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ) : emojiTab === "saved" && savedEmojis.length === 0 ? (
                <div
                  style={{
                    color: S.dim,
                    fontSize: "0.6rem",
                    textAlign: "center",
                    padding: "12px 0",
                    letterSpacing: "1px",
                  }}
                >
                  NO SAVED EMOJIS — HOLD ANY EMOJI TO SAVE
                </div>
              ) : (
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(6, 1fr)",
                    gap: "3px",
                  }}
                >
                  {(emojiTab === "all" ? EMOJI_LIST : savedEmojis).map(
                    (emoji) => {
                      const isSaved = savedEmojis.includes(emoji);
                      return (
                        <div key={emoji} style={{ position: "relative" }}>
                          <button
                            type="button"
                            onClick={() => handleEmojiClick(emoji)}
                            onContextMenu={(e) => {
                              e.preventDefault();
                              handleToggleSavedEmoji(emoji);
                            }}
                            title={
                              isSaved
                                ? "Right-click to unsave"
                                : "Right-click to save"
                            }
                            style={{
                              background: isSaved ? "#1a1500" : "transparent",
                              border: isSaved
                                ? `1px solid ${S.gold}33`
                                : "none",
                              cursor: "pointer",
                              fontSize: "1.1rem",
                              padding: "3px",
                              textAlign: "center",
                              borderRadius: "3px",
                              width: "100%",
                            }}
                            onMouseEnter={(e) => {
                              if (!isSaved)
                                (
                                  e.currentTarget as HTMLButtonElement
                                ).style.background = "#222";
                            }}
                            onMouseLeave={(e) => {
                              if (!isSaved)
                                (
                                  e.currentTarget as HTMLButtonElement
                                ).style.background = "transparent";
                            }}
                          >
                            {emoji}
                          </button>
                          {isSaved && emojiTab === "saved" && (
                            <button
                              type="button"
                              onClick={() => handleToggleSavedEmoji(emoji)}
                              style={{
                                position: "absolute",
                                top: "-3px",
                                right: "-3px",
                                background: S.red,
                                border: "none",
                                color: "#fff",
                                fontSize: "0.45rem",
                                width: "12px",
                                height: "12px",
                                borderRadius: "50%",
                                cursor: "pointer",
                                padding: 0,
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                lineHeight: 1,
                              }}
                            >
                              ✕
                            </button>
                          )}
                        </div>
                      );
                    },
                  )}
                </div>
              )}
            </div>
            {emojiTab === "all" && (
              <div
                style={{
                  padding: "3px 10px 5px",
                  fontSize: "0.5rem",
                  color: S.dim,
                  letterSpacing: "0.5px",
                }}
              >
                RIGHT-CLICK ANY EMOJI TO SAVE/UNSAVE IT
              </div>
            )}
          </div>
        )}

        {/* Recording indicator */}
        {isRecording && (
          <div
            style={{
              padding: "5px 10px",
              background: "#1a0000",
              borderBottom: `1px solid ${S.red}`,
              fontSize: "0.6rem",
              color: S.red,
              letterSpacing: "2px",
              fontWeight: 900,
            }}
          >
            ● RECORDING...
          </div>
        )}
        {recordingError && (
          <div
            style={{
              padding: "4px 10px",
              background: "#1a0000",
              borderBottom: `1px solid ${S.red}`,
              fontSize: "0.55rem",
              color: S.red,
              letterSpacing: "1px",
            }}
          >
            {recordingError}
          </div>
        )}

        {/* Attachment toolbar */}
        <div
          style={{
            display: "flex",
            gap: "4px",
            padding: "6px 10px",
            borderBottom: `1px solid ${S.brd}`,
            overflowX: "auto",
            background: "#060606",
            flexShrink: 0,
          }}
        >
          <button
            type="button"
            title="IMAGE"
            onClick={() => imageInputRef.current?.click()}
            style={toolbarBtnStyle}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLButtonElement).style.color = S.gold;
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.color = S.dim;
            }}
          >
            📷
          </button>
          <button
            type="button"
            title="FILE"
            onClick={() => fileInputRef.current?.click()}
            style={toolbarBtnStyle}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLButtonElement).style.color = S.gold;
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.color = S.dim;
            }}
          >
            📁
          </button>
          <button
            type="button"
            title="VIDEO"
            onClick={() => videoInputRef.current?.click()}
            style={toolbarBtnStyle}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLButtonElement).style.color = S.gold;
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.color = S.dim;
            }}
          >
            🎬
          </button>
          <button
            type="button"
            title="AUDIO"
            onClick={() => audioInputRef.current?.click()}
            style={toolbarBtnStyle}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLButtonElement).style.color = S.gold;
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.color = S.dim;
            }}
          >
            🎵
          </button>
          <button
            type="button"
            title="GIF"
            onClick={() => {
              setShowGifPanel((o) => !o);
              setShowEmojiPicker(false);
            }}
            style={{
              ...toolbarBtnStyle,
              ...(showGifPanel ? { background: "#1a1500", color: S.gold } : {}),
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLButtonElement).style.color = S.gold;
            }}
            onMouseLeave={(e) => {
              if (!showGifPanel)
                (e.currentTarget as HTMLButtonElement).style.color = S.dim;
            }}
          >
            🌀
          </button>
          <button
            type="button"
            title="EMOJI"
            onClick={() => {
              setShowEmojiPicker((o) => !o);
              setShowGifPanel(false);
            }}
            style={{
              ...toolbarBtnStyle,
              ...(showEmojiPicker
                ? { background: "#1a1500", color: S.gold }
                : {}),
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLButtonElement).style.color = S.gold;
            }}
            onMouseLeave={(e) => {
              if (!showEmojiPicker)
                (e.currentTarget as HTMLButtonElement).style.color = S.dim;
            }}
          >
            😊
          </button>
          <button
            type="button"
            title="HOLD TO RECORD VOICE"
            onMouseDown={startRecording}
            onMouseUp={stopRecording}
            onTouchStart={startRecording}
            onTouchEnd={stopRecording}
            style={{
              ...toolbarBtnStyle,
              ...(isRecording
                ? {
                    background: "#1a0000",
                    color: S.red,
                    border: `1px solid ${S.red}`,
                  }
                : {}),
            }}
            onMouseEnter={(e) => {
              if (!isRecording)
                (e.currentTarget as HTMLButtonElement).style.color = S.gold;
            }}
            onMouseLeave={(e) => {
              if (!isRecording)
                (e.currentTarget as HTMLButtonElement).style.color = S.dim;
            }}
          >
            🎤
          </button>
        </div>

        {/* Text input + send */}
        <div style={{ display: "flex", gap: 0 }}>
          <input
            type="text"
            placeholder="MESSAGE GROUP..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && sendMessage()}
            data-ocid="group_chat.input"
            style={{
              ...inputStyle,
              margin: 0,
              flex: 1,
              fontSize: "0.75rem",
              padding: "10px",
              border: "none",
              borderRight: `1px solid ${S.brd}`,
            }}
          />
          <button
            type="button"
            data-ocid="group_chat.primary_button"
            onClick={sendMessage}
            style={{
              background: S.gold,
              color: "#000",
              border: "none",
              padding: "10px 14px",
              fontWeight: 900,
              cursor: "pointer",
              fontFamily: "'JetBrains Mono', 'Courier New', monospace",
              fontSize: "0.7rem",
              textTransform: "uppercase",
              letterSpacing: "1px",
              flexShrink: 0,
            }}
          >
            SEND
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── App ──────────────────────────────────────────────────────────────────────

export default function App() {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [adminPanelOpen, setAdminPanelOpen] = useState(false);
  const [isOnline, setIsOnline] = useState(false);
  const [activities, setActivities] =
    useState<ActivityEntry[]>(get24hActivities);
  const [ebActive, setEbActive] = useState(!!getBroadcastMsg());
  const [ebMsg, setEbMsg] = useState(getBroadcastMsg());
  const [lockdown, setLockdownState] = useState<boolean>(getLockdown);
  const [selectedSector, setSelectedSector] = useState("SECTOR DATA");
  const [dmTarget, setDmTarget] = useState<string | null>(null);
  const [dmInboxOpen, setDmInboxOpen] = useState(false);
  const [dmGroups, setDmGroups] = useState<DMGroup[]>(getDMGroups);
  const [activeGroupId, setActiveGroupId] = useState<string | null>(null);
  const [avatarUrl, setAvatarUrl] = useState<string>("");
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const [idCardTick, setIdCardTick] = useState(0);
  // Global active office — determines which office's data is shown for all facilities
  const [activeOffice, setActiveOffice] = useState<OfficeLocation | null>(null);
  const [officePickerOpen, setOfficePickerOpen] = useState(false);
  // Per-office facilities list
  const [officeFacilities, setOfficeFacilitiesState] = useState<
    OfficeFacility[]
  >(() => [...DEFAULT_OFFICE_FACILITIES]);
  const [editFacilityIds, setEditFacilityIds] = useState<Set<string>>(
    new Set(),
  );
  // Snapshot of all menu items — polled so sold-out lists in tiles stay fresh
  const [menuSnapshot, setMenuSnapshot] = useState<MenuItem[]>(getMenuItems);
  // Canister sync counter — bump to force re-render of components reading localStorage
  const [_syncTick, setSyncTick] = useState(0);
  const [contactLink, setContactLink] = useState<string>(getContactLink);
  const [allTransactions, setAllTransactions] =
    useState<TransactionEntry[]>(getTransactions);
  // XUT numbers map (name -> xutNumber)
  const [xutNumbers, setXutNumbers] = useState<Record<string, string>>(() =>
    getXutNumbersMap(),
  );
  // Menu item extras map (itemId -> MenuItemExtras)
  const [_menuItemExtrasMap, setMenuItemExtrasMap] = useState<
    Record<string, MenuItemExtras>
  >(() => getAllMenuItemExtrasMapLocal());

  // Actor for reconnect polling
  const { actor } = useActor();

  // Presence interval ref — kept alive while user is logged in
  const presenceIntervalRef = useRef<ReturnType<typeof setInterval> | null>(
    null,
  );

  // Clean up presence interval on unmount
  useEffect(() => {
    return () => {
      if (presenceIntervalRef.current) {
        clearInterval(presenceIntervalRef.current);
      }
    };
  }, []);

  // ─── Canister sync: poll all shared data and write to localStorage ───────────
  // This makes all components that read from localStorage get fresh canister data.

  // Poll lockdown + broadcast from canister every 3s
  useEffect(() => {
    if (!actor) return;
    const id = setInterval(async () => {
      try {
        const [ld, bc] = await Promise.all([
          actor.getLockdown(),
          actor.getBroadcast(),
        ]);
        setLockdownState(ld);
        localStorage.setItem("x_lockdown_v1", ld ? "1" : "0");
        if (bc !== getBroadcastMsg()) {
          setBroadcastMsg(bc);
          setEbActive(!!bc);
          setEbMsg(bc);
        }
      } catch {
        // Fallback: use localStorage
        setLockdownState(getLockdown());
      }
    }, 3000);
    return () => clearInterval(id);
  }, [actor]);

  // Poll sector logs + admin posts + menu items + extras from canister every 4s
  useEffect(() => {
    if (!actor) return;
    const id = setInterval(async () => {
      try {
        const [allLogs, allPosts, allItems, allExtras] = await Promise.all([
          actor.getAllSectorLogs(),
          actor.getAllAdminPosts(),
          actor.getAllMenuItems(),
          actor.getAllMenuItemExtras(),
        ]);
        // Write to localStorage so components pick up fresh data
        const localLogs: SectorLog[] = allLogs.map((l) => ({
          id: l.id,
          sector: l.sector,
          title: l.title,
          body: l.body,
          author: l.author,
          level: Number(l.level),
          date: l.date,
        }));
        setSectorLogs(localLogs);

        const localPosts: AdminPost[] = allPosts.map((p) => ({
          id: p.id,
          author: p.author,
          content: p.content,
          minLvl: Number(p.minLvl),
          date: p.date,
          sector: p.sector,
        }));
        setAdminPosts(localPosts);

        const localItems: MenuItem[] = allItems.map((item) => ({
          id: item.id,
          facility: item.facility,
          name: item.name,
          price: item.price,
          description: item.description,
          createdBy: item.createdBy,
          stock: canisterStockToLocal(item.stock),
        }));
        setMenuItems(localItems);
        setMenuSnapshot(localItems);
        // Update menu item extras map
        const extrasMap: Record<string, MenuItemExtras> = {};
        const localExtrasStore: Record<string, string> = {};
        for (const [id, json] of allExtras) {
          try {
            extrasMap[id] = JSON.parse(json);
            localExtrasStore[id] = json;
          } catch {
            extrasMap[id] = {};
          }
        }
        localStorage.setItem(
          "x_menu_item_extras_v1",
          JSON.stringify(localExtrasStore),
        );
        setMenuItemExtrasMap(extrasMap);
        setSyncTick((t) => t + 1);
      } catch {
        // fallback: use localStorage values already in state
        setMenuSnapshot(getMenuItems());
      }
    }, 4000);
    return () => clearInterval(id);
  }, [actor]);

  // Poll activities from canister every 5s
  useEffect(() => {
    if (!actor) return;
    const id = setInterval(async () => {
      try {
        const acts = await actor.getActivities();
        const localActs: ActivityEntry[] = acts.map((a) => ({
          msg: a.msg,
          ts: a.ts,
        }));
        // Merge with local and persist
        localStorage.setItem(
          "x_act_v22",
          JSON.stringify(localActs.slice(0, 100)),
        );
        refreshActivities();
      } catch {
        // ignore
      }
    }, 5000);
    return () => clearInterval(id);
  }, [actor]);

  // Poll member list + funds from canister every 5s
  useEffect(() => {
    if (!actor) return;
    const id = setInterval(async () => {
      try {
        const [allUsers, allFunds, allXuts] = await Promise.all([
          actor.getAllUsers(),
          actor.getAllMemberFunds(),
          actor.getAllXutNumbers(),
        ]);
        // Update localStorage user db
        const db = getDB();
        for (const [name, level] of allUsers) {
          if (db[name]) {
            db[name].lvl = Number(level);
          } else {
            db[name] = { lvl: Number(level), q: "", a: "" };
          }
        }
        setDB(db);
        // Update funds
        for (const [name, amount] of allFunds) {
          localStorage.setItem(`x_funds_${name}`, String(amount));
        }
        // Update XUT numbers
        const xutMap: Record<string, string> = {};
        for (const [name, xut] of allXuts) {
          xutMap[name] = xut;
        }
        localStorage.setItem("x_xut_numbers_v1", JSON.stringify(xutMap));
        setXutNumbers(xutMap);
        setSyncTick((t) => t + 1);
      } catch {
        // ignore
      }
    }, 5000);
    return () => clearInterval(id);
  }, [actor]);

  // Poll all transactions from canister every 5s — real-time purchase/fund updates across devices
  useEffect(() => {
    if (!actor) return;
    const id = setInterval(async () => {
      try {
        const canisterTxns = await actor.getAllTransactions();
        if (canisterTxns.length > 0) {
          const mapped: TransactionEntry[] = canisterTxns.map((t) => ({
            member: t.member,
            prevAmount: t.prevAmount,
            newAmount: t.newAmount,
            changedBy: t.changedBy,
            ts: t.ts,
            description: t.description,
          }));
          // Merge with local (deduplicate by ts+member), keep newest first
          const existing = getTransactions();
          const existingKeys = new Set(
            existing.map((e) => `${e.ts}-${e.member}`),
          );
          const newOnes = mapped.filter(
            (t) => !existingKeys.has(`${t.ts}-${t.member}`),
          );
          if (newOnes.length > 0) {
            const merged = [...newOnes, ...existing].slice(0, 500);
            localStorage.setItem("x_transactions_v1", JSON.stringify(merged));
          }
          // Preserve reversed/reversedBy from local, include local-only entries
          const localAll = getTransactions();
          const localMap = new Map(
            localAll.map((t: TransactionEntry) => [`${t.ts}-${t.member}`, t]),
          );
          const canisterKeys = new Set(
            mapped.map((t: TransactionEntry) => `${t.ts}-${t.member}`),
          );
          const mergedWithFlags = mapped.map((t: TransactionEntry) => {
            const local = localMap.get(`${t.ts}-${t.member}`);
            return local
              ? { ...t, reversed: local.reversed, reversedBy: local.reversedBy }
              : t;
          });
          const localOnly = localAll.filter(
            (t: TransactionEntry) => !canisterKeys.has(`${t.ts}-${t.member}`),
          );
          const finalMerged = [...localOnly, ...mergedWithFlags]
            .sort((a, b) => b.ts.localeCompare(a.ts))
            .slice(0, 500);
          setAllTransactions(finalMerged);
        }
      } catch {
        // ignore
      }
    }, 5000);
    return () => clearInterval(id);
  }, [actor]);

  // Poll office locations from canister every 10s
  useEffect(() => {
    if (!actor) return;
    const id = setInterval(async () => {
      try {
        const json = await actor.getOfficeLocations();
        if (json?.trim()) {
          localStorage.setItem("x_office_locations_v1", json);
          setSyncTick((t) => t + 1);
        }
      } catch {
        // ignore
      }
    }, 10000);
    return () => clearInterval(id);
  }, [actor]);

  // Initial load from canister on actor available
  useEffect(() => {
    if (!actor) return;
    (async () => {
      try {
        const [bc, ld, offJson] = await Promise.all([
          actor.getBroadcast(),
          actor.getLockdown(),
          actor.getOfficeLocations(),
        ]);
        setBroadcastMsg(bc);
        setEbActive(!!bc);
        setEbMsg(bc);
        localStorage.setItem("x_lockdown_v1", ld ? "1" : "0");
        setLockdownState(ld);
        if (offJson?.trim()) {
          localStorage.setItem("x_office_locations_v1", offJson);
        }
        // Load about content
        const [about, features, credits] = await Promise.all([
          actor.getContent("x_about_content_v1"),
          actor.getContent("x_features_content_v1"),
          actor.getContent("x_credits_content_v1"),
        ]);
        if (about) localStorage.setItem("x_about_content_v1", about);
        if (features) localStorage.setItem("x_features_content_v1", features);
        if (credits) localStorage.setItem("x_credits_content_v1", credits);
        setSyncTick((t) => t + 1);
      } catch {
        // ignore
      }
    })();
  }, [actor]);

  // Poll lockdown state every 3s so all users see changes made by L6 on any device (local fallback)
  useEffect(() => {
    const id = setInterval(() => {
      setLockdownState(getLockdown());
    }, 3000);
    return () => clearInterval(id);
  }, []);

  // Poll menu items every 3s so sold-out badges on tiles stay current
  useEffect(() => {
    const id = setInterval(() => {
      setMenuSnapshot(getMenuItems());
    }, 3000);
    return () => clearInterval(id);
  }, []);

  // Reconnect polling — if offline, try every 30s to reconnect via backend
  useEffect(() => {
    if (isOnline || !user) return;
    const id = setInterval(async () => {
      if (!actor) return;
      try {
        const loggedUser = await actor.loginUser(user.name, user.a);
        // Update localStorage with fresh backend data
        const updatedDb = getDB();
        updatedDb[user.name] = {
          lvl: Number(loggedUser.level),
          q: loggedUser.question,
          a: loggedUser.answer,
          uid: loggedUser.uid,
        };
        setDB(updatedDb);
        // Update user state with potentially refreshed level
        setUser((prev) =>
          prev
            ? {
                ...prev,
                lvl: Number(loggedUser.level),
                q: loggedUser.question,
                a: loggedUser.answer,
                uid: loggedUser.uid,
              }
            : prev,
        );
        setIsOnline(true);
      } catch {
        // Still offline — remain as-is
      }
    }, 30000);
    return () => clearInterval(id);
  }, [isOnline, user, actor]);

  const toggleLockdown = () => {
    const next = !lockdown;
    setLockdown(next);
    setLockdownState(next);
    const msg = next
      ? "EMERGENCY LOCKDOWN ACTIVATED"
      : "EMERGENCY LOCKDOWN DEACTIVATED";
    addActivity(msg);
    refreshActivities();
    // Sync to canister
    actor?.setLockdown(next).catch(() => {});
    const ts = new Date().toISOString();
    actor?.addActivity(msg, ts).catch(() => {});
  };

  const refreshActivities = useCallback(() => {
    setActivities(get24hActivities());
    setAllTransactions(getTransactions());
  }, []);

  // Listen for activity events and forward to canister
  useEffect(() => {
    const handler = (e: Event) => {
      const { msg, ts } = (e as CustomEvent).detail;
      actor?.addActivity(msg, ts).catch(() => {});
    };
    window.addEventListener("xution-activity", handler);
    return () => window.removeEventListener("xution-activity", handler);
  }, [actor]);

  const handleLogin = (u: CurrentUser, online: boolean) => {
    setUser(u);
    setIsOnline(online);
    setAvatarUrl(getAvatar(u.name));
    refreshActivities();

    // Start presence heartbeat
    setPresence(u.name);
    if (presenceIntervalRef.current) clearInterval(presenceIntervalRef.current);
    presenceIntervalRef.current = setInterval(() => {
      setPresence(u.name);
    }, 20000);

    // Sync funds and card number from canister
    if (online && actor) {
      // Load card number from canister
      actor
        .getCardNumber(u.name)
        .then((cardNum) => {
          if (cardNum?.trim()) {
            localStorage.setItem(`x_card_${u.name}`, cardNum);
          } else {
            // Card not in canister yet — generate locally and persist
            const localCard = getCardNumber(u.name);
            actor.setCardNumber(u.name, localCard).catch(() => {});
          }
        })
        .catch(() => {});

      // Load funds from canister
      actor
        .getMemberFunds(u.name)
        .then((remoteFunds) => {
          if (remoteFunds > 0) {
            localStorage.setItem(`x_funds_${u.name}`, String(remoteFunds));
          } else {
            // No funds on canister yet — push local balance
            const localFunds = getFunds(u.name);
            actor.setMemberFunds(u.name, localFunds).catch(() => {});
          }
        })
        .catch(() => {});

      // Load transactions from canister
      actor
        .getMemberTransactions(u.name)
        .then((txns) => {
          if (txns.length > 0) {
            const local = txns.map((t) => ({
              member: t.member,
              prevAmount: t.prevAmount,
              newAmount: t.newAmount,
              changedBy: t.changedBy,
              ts: t.ts,
              description: t.description,
            }));
            // Merge with existing local transactions (deduplicate by ts+member)
            const existing = JSON.parse(
              localStorage.getItem("x_transactions_v1") || "[]",
            ) as TransactionEntry[];
            const existingKeys = new Set(
              existing.map((e) => `${e.ts}-${e.member}`),
            );
            const newOnes = local.filter(
              (t) => !existingKeys.has(`${t.ts}-${t.member}`),
            );
            const merged = [...newOnes, ...existing].slice(0, 200);
            localStorage.setItem("x_transactions_v1", JSON.stringify(merged));
          }
        })
        .catch(() => {});
    }
  };

  const handleAvatarChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const dataUrl = ev.target?.result as string;
      setAvatar(user.name, dataUrl);
      setAvatarUrl(dataUrl);
    };
    reader.readAsDataURL(file);
  };

  const openSector = (sectorId: string) => {
    if (selectedSector === sectorId) {
      setSelectedSector("SECTOR DATA");
      return;
    }
    setSelectedSector(sectorId);
    addActivity(`ACCESSED SECTOR: ${sectorId}`);
    refreshActivities();
  };

  const deactivateEB = () => {
    setBroadcastMsg("");
    setEbActive(false);
    setEbMsg("");
    actor?.clearBroadcast().catch(() => {});
    addActivity("EMERGENCY BROADCAST DEACTIVATED");
    refreshActivities();
  };

  const activateEB = (msg: string) => {
    if (!msg) return;
    setBroadcastMsg(msg);
    setEbActive(true);
    actor?.setBroadcast(msg).catch(() => {});
    addActivity("EMERGENCY BROADCAST ACTIVATED");
    refreshActivities();
  };

  const handleLogout = () => {
    if (presenceIntervalRef.current) {
      clearInterval(presenceIntervalRef.current);
      presenceIntervalRef.current = null;
    }
    window.location.reload();
  };

  return (
    <div
      style={{
        background: S.bg,
        minHeight: "100vh",
        color: "#e0e0e0",
        fontFamily: "'JetBrains Mono', 'Courier New', monospace",
        fontWeight: 900,
        textTransform: "uppercase",
      }}
    >
      {/* Auth Screen */}
      {!user && <AuthScreen onLogin={(u, online) => handleLogin(u, online)} />}

      {/* Emergency Banner */}
      {ebActive && (
        <div
          style={{
            background: S.red,
            color: "#fff",
            padding: "10px",
            textAlign: "center",
            fontSize: "0.8rem",
            letterSpacing: "2px",
            borderBottom: "2px solid #fff",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "12px",
          }}
        >
          <span>
            ⚠️ EMERGENCY BROADCAST ACTIVE ⚠️{ebMsg ? ` — ${ebMsg}` : ""}
          </span>
          {user && user.lvl === 6 && (
            <button
              type="button"
              onClick={deactivateEB}
              style={{
                background: "#000",
                color: S.red,
                border: "1px solid #fff",
                padding: "3px 10px",
                fontSize: "0.65rem",
                fontFamily: "inherit",
                fontWeight: 900,
                cursor: "pointer",
                textTransform: "uppercase",
                letterSpacing: "1px",
                flexShrink: 0,
              }}
            >
              DISABLE
            </button>
          )}
        </div>
      )}

      {/* Lockdown Banner */}
      {lockdown && (
        <div
          style={{
            background: "#7a3500",
            color: "#fff",
            padding: "10px",
            textAlign: "center",
            fontSize: "0.8rem",
            letterSpacing: "2px",
            borderBottom: "2px solid #ff6600",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "12px",
          }}
        >
          <span>
            🔒 EMERGENCY LOCKDOWN ACTIVE — ALL MEMBER ACTIONS & CONTENT
            RESTRICTED
          </span>
          {user && user.lvl === 6 && (
            <button
              type="button"
              data-ocid="lockdown.disable_button"
              onClick={toggleLockdown}
              style={{
                background: "#000",
                color: "#ff6600",
                border: "1px solid #fff",
                padding: "3px 10px",
                fontSize: "0.65rem",
                fontFamily: "inherit",
                fontWeight: 900,
                cursor: "pointer",
                textTransform: "uppercase",
                letterSpacing: "1px",
                flexShrink: 0,
              }}
            >
              LIFT LOCKDOWN
            </button>
          )}
        </div>
      )}

      {/* Contact Pill */}
      <a
        href={contactLink}
        style={{
          position: "fixed",
          bottom: "20px",
          right: "20px",
          background: S.gold,
          color: "#000",
          padding: "12px",
          borderRadius: "4px",
          textDecoration: "none",
          zIndex: 9997,
          fontSize: "0.7rem",
          border: "2px solid #000",
          fontFamily: "'JetBrains Mono', 'Courier New', monospace",
          fontWeight: 900,
          textTransform: "uppercase",
        }}
      >
        📧 CONTACT COMMAND
      </a>

      {/* DM Button — stacked above gear (or above contact pill for non-L6) */}
      {user && (
        <button
          type="button"
          data-ocid="dm.open_modal_button"
          onClick={() => {
            setDmInboxOpen((v) => !v);
            setDmTarget(null);
            setActiveGroupId(null);
          }}
          title="DIRECT MESSAGES"
          style={{
            position: "fixed",
            bottom: user?.lvl === 6 ? "132px" : "76px",
            right: "20px",
            background: dmInboxOpen ? S.blue : "#0a0a0a",
            color: dmInboxOpen ? "#000" : S.blue,
            border: `2px solid ${S.blue}`,
            borderRadius: "4px",
            width: "44px",
            height: "44px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
            zIndex: 9997,
            fontFamily: "'JetBrains Mono', 'Courier New', monospace",
            fontWeight: 900,
            fontSize: "1.1rem",
            boxShadow: dmInboxOpen
              ? `0 0 16px ${S.blue}66`
              : "0 2px 10px rgba(0,0,0,0.6)",
            transition: "background 0.15s, color 0.15s, box-shadow 0.15s",
          }}
        >
          💬{/* Unread badge on button */}
          {getTotalUnreadDMs(user.name) > 0 && !dmInboxOpen && (
            <span
              style={{
                position: "absolute",
                top: "-6px",
                right: "-6px",
                background: S.red,
                color: "#fff",
                fontSize: "0.5rem",
                fontWeight: 900,
                borderRadius: "8px",
                padding: "1px 5px",
                letterSpacing: "0.5px",
                pointerEvents: "none",
              }}
            >
              {getTotalUnreadDMs(user.name)}
            </span>
          )}
        </button>
      )}

      {/* Admin Settings Gear Button (L6 only) — sits between contact pill and DM button */}
      {user?.lvl === 6 && (
        <button
          type="button"
          data-ocid="admin_panel.open_modal_button"
          onClick={() => setAdminPanelOpen((v) => !v)}
          title="ADMIN SETTINGS"
          style={{
            position: "fixed",
            bottom: "76px",
            right: "20px",
            background: adminPanelOpen ? S.gold : "#0a0a0a",
            color: adminPanelOpen ? "#000" : S.gold,
            border: `2px solid ${S.gold}`,
            borderRadius: "4px",
            width: "44px",
            height: "44px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
            zIndex: 9997,
            fontFamily: "'JetBrains Mono', 'Courier New', monospace",
            fontWeight: 900,
            fontSize: "1.2rem",
            boxShadow: adminPanelOpen
              ? `0 0 16px ${S.gold}66`
              : "0 2px 10px rgba(0,0,0,0.6)",
            transition: "background 0.15s, color 0.15s, box-shadow 0.15s",
          }}
        >
          ⚙
        </button>
      )}

      {/* Admin Settings Panel */}
      {user?.lvl === 6 && (
        <AdminSettingsPanel
          open={adminPanelOpen}
          onClose={() => setAdminPanelOpen(false)}
          currentUser={user}
          lockdown={lockdown}
          onLockdownToggle={toggleLockdown}
          onUpdate={refreshActivities}
          ebMsg={ebMsg}
          ebActive={ebActive}
          onEbMsgChange={setEbMsg}
          onActivateEB={activateEB}
          onDeactivateEB={deactivateEB}
          contactLink={contactLink}
          onContactLinkSave={(val: string) => {
            localStorage.setItem("x_contact_link", val);
            setContactLink(val);
          }}
          transactions={allTransactions}
        />
      )}

      {/* DM Inbox Overlay */}
      {user && dmInboxOpen && (
        <DMInboxOverlay
          currentUser={user}
          onClose={() => setDmInboxOpen(false)}
          onOpenDM={(name) => {
            setDmTarget(name);
            setDmInboxOpen(false);
            setActiveGroupId(null);
          }}
          onOpenGroup={(id) => {
            setActiveGroupId(id);
            setDmInboxOpen(false);
            setDmTarget(null);
          }}
          dmGroups={dmGroups}
          setDmGroups={(gs) => {
            setDmGroups(gs);
            saveDMGroups(gs);
          }}
        />
      )}

      {/* DM Panel */}
      {user && dmTarget && !dmInboxOpen && (
        <DMPanel
          currentUser={user}
          target={dmTarget}
          onClose={() => setDmTarget(null)}
        />
      )}

      {/* Group Chat Panel */}
      {user && activeGroupId && !dmInboxOpen && (
        <GroupChatPanel
          currentUser={user}
          groupId={activeGroupId}
          dmGroups={dmGroups}
          setDmGroups={(gs) => {
            setDmGroups(gs);
            saveDMGroups(gs);
          }}
          onClose={() => setActiveGroupId(null)}
        />
      )}

      {/* Header */}
      <header
        style={{
          textAlign: "center",
          padding: "30px 15px",
          borderBottom: `1px solid ${S.gold}`,
          background: "#080808",
        }}
      >
        <h1
          style={{
            letterSpacing: "10px",
            margin: 0,
            color: S.gold,
            fontSize: "2.2rem",
          }}
        >
          XUTION
        </h1>
        <p
          style={{
            fontSize: "0.6rem",
            letterSpacing: "5px",
            opacity: 0.5,
            margin: "8px 0 0",
          }}
        >
          PRIMAL HUB OPERATIONS
        </p>
      </header>

      {/* Main Content */}
      <div
        style={{
          maxWidth: "800px",
          margin: "0 auto",
          padding: "20px",
        }}
      >
        {/* HUD Grid */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr",
            gap: "15px",
            marginBottom: "30px",
          }}
        >
          {/* ID Box */}
          <div
            style={{
              background: "#080808",
              border: `1px solid ${S.brd}`,
              padding: "15px",
              borderLeft: `5px solid ${S.blue}`,
            }}
          >
            <small style={{ color: S.dim, fontSize: "0.65rem" }}>ID_LINK</small>

            {/* ID Card Body */}
            <div
              style={{
                display: "flex",
                gap: "15px",
                alignItems: "flex-start",
                marginTop: "10px",
              }}
            >
              {/* Avatar area */}
              <div style={{ flexShrink: 0 }}>
                <button
                  type="button"
                  style={{
                    width: "70px",
                    height: "70px",
                    border: `2px solid ${S.gold}`,
                    background: "#111",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    overflow: "hidden",
                    cursor: user ? "pointer" : "default",
                    position: "relative",
                    padding: 0,
                  }}
                  title={user ? "CLICK TO UPLOAD PHOTO" : ""}
                  onClick={() => user && avatarInputRef.current?.click()}
                  onMouseEnter={(e) => {
                    if (user) {
                      (e.currentTarget as HTMLButtonElement).style.borderColor =
                        S.blue;
                    }
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLButtonElement).style.borderColor =
                      S.gold;
                  }}
                >
                  {avatarUrl ? (
                    <img
                      src={avatarUrl}
                      alt="PROFILE"
                      style={{
                        width: "100%",
                        height: "100%",
                        objectFit: "cover",
                      }}
                    />
                  ) : (
                    <span
                      style={{
                        color: S.dim,
                        fontSize: "0.55rem",
                        textAlign: "center",
                        padding: "4px",
                        letterSpacing: "1px",
                      }}
                    >
                      {user ? "TAP TO\nUPLOAD" : "NO\nPHOTO"}
                    </span>
                  )}
                </button>
                {user && (
                  <div
                    style={{
                      fontSize: "0.5rem",
                      color: S.dim,
                      textAlign: "center",
                      marginTop: "3px",
                      letterSpacing: "1px",
                    }}
                  >
                    PHOTO ID
                  </div>
                )}
              </div>

              {/* ID Info */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{ fontSize: "1.1rem", color: "#fff", fontWeight: 900 }}
                >
                  {user ? user.name : "--"}
                </div>
                <div
                  style={{
                    color: S.gold,
                    fontSize: "0.75rem",
                    marginTop: "2px",
                  }}
                >
                  {user ? `LEVEL ${user.lvl}` : "UNAFFILIATED"}
                </div>
                {/* Online / Offline badge */}
                {user && (
                  <div
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "4px",
                      marginTop: "5px",
                      fontSize: "0.55rem",
                      fontWeight: 900,
                      letterSpacing: "2px",
                      color: isOnline ? S.green : S.blue,
                    }}
                  >
                    {isOnline ? (
                      <>
                        <span
                          style={{
                            display: "inline-block",
                            width: "6px",
                            height: "6px",
                            borderRadius: "50%",
                            background: S.green,
                            boxShadow: `0 0 6px ${S.green}`,
                            flexShrink: 0,
                          }}
                        />
                        ONLINE
                      </>
                    ) : (
                      <>
                        <span style={{ flexShrink: 0 }}>⚡</span>
                        OFFLINE MODE
                      </>
                    )}
                  </div>
                )}
                {user?.uid && (
                  <div
                    style={{
                      marginTop: "6px",
                      fontSize: "0.6rem",
                      color: S.blue,
                      letterSpacing: "2px",
                      borderTop: `1px solid ${S.brd}`,
                      paddingTop: "5px",
                    }}
                  >
                    UID: #{user.uid}
                  </div>
                )}
              </div>
            </div>

            {/* ID Card image section */}
            {user &&
              (() => {
                const idCardImg = getIdCardImage(user.name);
                void idCardTick; // trigger re-render on import
                return (
                  <div style={{ marginTop: "10px" }}>
                    {idCardImg ? (
                      <img
                        src={idCardImg}
                        alt="ID Card"
                        style={{
                          width: "100%",
                          borderRadius: "8px",
                          marginBottom: "8px",
                          display: "block",
                        }}
                      />
                    ) : (
                      <div
                        style={{
                          width: "100%",
                          height: "80px",
                          background: "#0a0a0a",
                          border: `1px dashed ${S.brd}`,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          fontSize: "0.6rem",
                          color: S.dim,
                          letterSpacing: "2px",
                          marginBottom: "8px",
                          borderRadius: "4px",
                        }}
                      >
                        NO ID CARD IMPORTED
                      </div>
                    )}
                    <div
                      style={{
                        display: "flex",
                        gap: "6px",
                        marginBottom: "8px",
                      }}
                    >
                      <label
                        style={{
                          flex: 1,
                          background: "#111",
                          border: `1px solid ${S.blue}44`,
                          color: S.blue,
                          padding: "5px 8px",
                          fontSize: "0.6rem",
                          letterSpacing: "2px",
                          cursor: "pointer",
                          textAlign: "center",
                          fontFamily:
                            "'JetBrains Mono','Courier New',monospace",
                          fontWeight: 900,
                        }}
                      >
                        IMPORT ID CARD
                        <input
                          type="file"
                          accept="image/*"
                          style={{ display: "none" }}
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (!file) return;
                            const reader = new FileReader();
                            reader.onload = (ev) => {
                              const dataUrl = ev.target?.result as string;
                              setIdCardImage(user.name, dataUrl);
                              // Force re-render
                              e.target.value = "";
                              document.dispatchEvent(
                                new Event("idcard-updated"),
                              );
                              setIdCardTick((t) => t + 1);
                            };
                            reader.readAsDataURL(file);
                          }}
                        />
                      </label>
                      {idCardImg && (
                        <button
                          type="button"
                          data-ocid="id_link.export_button"
                          onClick={() => exportIdCardImage(user.name)}
                          style={{
                            flex: 1,
                            background: "#111",
                            border: `1px solid ${S.green}44`,
                            color: S.green,
                            padding: "5px 8px",
                            fontSize: "0.6rem",
                            letterSpacing: "2px",
                            cursor: "pointer",
                            fontFamily:
                              "'JetBrains Mono','Courier New',monospace",
                            fontWeight: 900,
                          }}
                        >
                          EXPORT ID CARD
                        </button>
                      )}
                    </div>
                  </div>
                );
              })()}

            {/* Hidden file input for avatar */}
            {user && (
              <input
                ref={avatarInputRef}
                type="file"
                accept="image/*"
                style={{ display: "none" }}
                onChange={handleAvatarChange}
              />
            )}

            {/* LOGOUT button — below ID card */}
            {user && (
              <button
                type="button"
                data-ocid="id_link.delete_button"
                style={{
                  ...btnSmall,
                  background: S.red,
                  color: "#fff",
                  marginTop: "4px",
                  width: "100%",
                  padding: "8px",
                  fontSize: "0.7rem",
                  letterSpacing: "2px",
                }}
                onClick={handleLogout}
              >
                LOGOUT
              </button>
            )}
          </div>

          {/* Xution Credit Card */}
          {user && (
            <div
              style={{
                background: "#080808",
                border: `1px solid ${S.brd}`,
                padding: "20px 15px",
                borderLeft: `5px solid ${S.gold}`,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: "10px",
              }}
            >
              <div
                style={{
                  width: "100%",
                  display: "flex",
                  alignItems: "center",
                  marginBottom: "8px",
                }}
              >
                <small
                  style={{
                    color: S.dim,
                    fontSize: "0.65rem",
                    letterSpacing: "2px",
                  }}
                >
                  XUTION CREDIT CARD
                </small>
              </div>
              <XutionCard currentUser={user} />
              {/* Personal transaction history and fund management for all users */}
              <div style={{ width: "100%", marginTop: "8px" }}>
                <PersonalTransactionHistory
                  currentUser={user}
                  transactions={allTransactions}
                />
                <PersonalFundManagement
                  currentUser={user}
                  onPurchase={refreshActivities}
                />
              </div>
            </div>
          )}

          {/* Activity Box — 24h scroll area */}
          <div
            style={{
              background: "#080808",
              border: `1px solid ${S.brd}`,
              padding: "15px",
              borderLeft: `5px solid ${S.green}`,
            }}
          >
            <small style={{ color: S.dim, fontSize: "0.65rem" }}>
              ACTIVITY (LAST 24H)
            </small>
            <div
              className="xution-scroll"
              style={{
                fontSize: "0.6rem",
                marginTop: "10px",
                height: "150px",
                maxHeight: "150px",
                overflowY: "auto",
                overflowX: "hidden",
                paddingRight: "4px",
                display: "block",
              }}
            >
              {activities.length === 0 ? (
                <div style={{ opacity: 0.4 }}>NO ACTIVITY IN LAST 24H</div>
              ) : (
                activities.map((act, i) => (
                  <div
                    key={`act-${act.ts}-${i}`}
                    style={{
                      marginBottom: "5px",
                      borderBottom: "1px solid #111",
                      paddingBottom: "3px",
                      color: S.dim,
                    }}
                  >
                    {typeof act === "string"
                      ? act
                      : `[${new Date(act.ts).toLocaleTimeString()}] ${act.msg}`}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Member Directory (collapsible, all logged-in users) */}
        {user && (
          <div id="member-directory-section">
            <MemberList
              currentUser={user}
              onActivity={refreshActivities}
              onDM={(name) => {
                setDmTarget(name);
                setDmInboxOpen(false);
                setActiveGroupId(null);
              }}
              lockdown={lockdown}
              xutNumbers={xutNumbers}
            />
          </div>
        )}

        {/* Active Office Selector — above Facilities */}
        {user && (
          <div style={{ marginBottom: "16px" }}>
            {/* Banner row */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "10px 15px",
                background: activeOffice ? "#0d1a00" : "#080808",
                border: `1px solid ${activeOffice ? S.green : S.brd}`,
                borderLeft: `5px solid ${activeOffice ? S.green : S.dim}`,
                gap: "10px",
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontSize: "0.5rem",
                    color: S.dim,
                    letterSpacing: "3px",
                    marginBottom: "3px",
                  }}
                >
                  ACTIVE OFFICE
                </div>
                <div
                  style={{
                    fontSize: "0.8rem",
                    color: activeOffice ? S.green : S.dim,
                    fontWeight: 900,
                    letterSpacing: "2px",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {activeOffice ? activeOffice.name : "NONE SELECTED"}
                </div>
                {activeOffice && (
                  <div
                    style={{
                      fontSize: "0.5rem",
                      color: S.blue,
                      letterSpacing: "2px",
                      marginTop: "2px",
                    }}
                  >
                    {activeOffice.floor}
                  </div>
                )}
              </div>
              <div style={{ display: "flex", gap: "6px", flexShrink: 0 }}>
                <button
                  type="button"
                  data-ocid="office_selector.open_modal_button"
                  onClick={() => setOfficePickerOpen((v) => !v)}
                  style={{
                    ...btnSmall,
                    background: officePickerOpen ? "#222" : S.gold,
                    color: officePickerOpen ? S.dim : "#000",
                    border: `1px solid ${S.gold}`,
                    padding: "5px 10px",
                    flex: "none",
                    fontSize: "0.6rem",
                  }}
                >
                  {officePickerOpen ? "CLOSE ▲" : "CHANGE ▼"}
                </button>
                {activeOffice && (
                  <button
                    type="button"
                    data-ocid="office_selector.clear_button"
                    onClick={() => {
                      setActiveOffice(null);
                      setOfficeFacilitiesState([...DEFAULT_OFFICE_FACILITIES]);
                      setOfficePickerOpen(false);
                    }}
                    style={{
                      ...btnSmall,
                      background: S.red,
                      color: "#fff",
                      padding: "5px 8px",
                      flex: "none",
                      fontSize: "0.6rem",
                    }}
                  >
                    CLEAR
                  </button>
                )}
              </div>
            </div>

            {/* Office picker dropdown */}
            {officePickerOpen && (
              <div
                className="xution-scroll"
                style={{
                  border: `1px solid ${S.brd}`,
                  borderTop: "none",
                  background: "#050505",
                  maxHeight: "220px",
                  overflowY: "auto",
                }}
              >
                {getOfficeLocations().length === 0 ? (
                  <div
                    style={{
                      padding: "12px 15px",
                      color: S.dim,
                      fontSize: "0.65rem",
                      letterSpacing: "2px",
                    }}
                  >
                    NO OFFICE LOCATIONS CONFIGURED
                  </div>
                ) : (
                  getOfficeLocations().map((office, idx) => {
                    const isActive = activeOffice?.id === office.id;
                    return (
                      <button
                        type="button"
                        key={office.id}
                        data-ocid={`office_selector.item.${idx + 1}`}
                        onClick={() => {
                          const newOffice = isActive ? null : office;
                          setActiveOffice(newOffice);
                          setOfficeFacilitiesState(
                            newOffice
                              ? getOfficeFacilities(newOffice.id)
                              : [...DEFAULT_OFFICE_FACILITIES],
                          );
                          setOfficePickerOpen(false);
                        }}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "10px",
                          width: "100%",
                          padding: "10px 15px",
                          background: isActive ? "#0d1a00" : "transparent",
                          border: "none",
                          borderBottom: `1px solid ${S.brd}`,
                          cursor: "pointer",
                          textAlign: "left",
                          fontFamily:
                            "'JetBrains Mono', 'Courier New', monospace",
                          fontWeight: 900,
                          textTransform: "uppercase",
                        }}
                      >
                        <span
                          style={{
                            color: isActive ? S.green : S.dim,
                            fontSize: "0.75rem",
                            flexShrink: 0,
                          }}
                        >
                          {isActive ? "◈" : "○"}
                        </span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div
                            style={{
                              fontSize: "0.75rem",
                              color: isActive ? S.green : S.white,
                              fontWeight: 900,
                              letterSpacing: "1px",
                            }}
                          >
                            {office.name}
                          </div>
                          <div
                            style={{
                              fontSize: "0.5rem",
                              color: S.blue,
                              letterSpacing: "2px",
                              marginTop: "2px",
                            }}
                          >
                            {office.floor}
                          </div>
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
            )}
          </div>
        )}

        {/* Facilities */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: "20px",
          }}
        >
          <h3
            style={{
              borderLeft: `5px solid ${S.gold}`,
              paddingLeft: "15px",
              margin: 0,
              fontSize: "0.9rem",
              letterSpacing: "3px",
            }}
          >
            FACILITIES
          </h3>
          {user?.lvl === 6 && activeOffice && (
            <button
              type="button"
              data-ocid="facilities.primary_button"
              onClick={() => {
                const newFac: OfficeFacility = {
                  id: `fac-${Date.now()}`,
                  name: "New Facility",
                  icon: "🏗️",
                  desc: "Custom facility.",
                };
                const updated = [...officeFacilities, newFac];
                setOfficeFacilitiesState(updated);
                saveOfficeFacilities(activeOffice.id, updated);
              }}
              style={{
                ...btnSmall,
                background: "#001a00",
                color: S.green,
                border: `1px solid ${S.green}55`,
                padding: "5px 10px",
                fontSize: "0.6rem",
              }}
            >
              + ADD FACILITY
            </button>
          )}
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr",
            gap: "12px",
            marginBottom: "30px",
          }}
        >
          {officeFacilities.map((f) => {
            const facilityKey = activeOffice
              ? `${activeOffice.name}::${f.id}`
              : f.id;
            const soldOut = menuSnapshot.filter(
              (item) =>
                item.facility === facilityKey &&
                item.stock !== undefined &&
                item.stock <= 0,
            );
            return (
              <div
                key={f.id}
                style={{
                  background: "#0c0c0c",
                  border: `1px solid ${selectedSector === f.id ? S.gold : S.brd}`,
                  transition: "border-color 0.15s",
                  borderLeft:
                    selectedSector === f.id
                      ? `4px solid ${S.gold}`
                      : `1px solid ${S.brd}`,
                  width: "100%",
                  textAlign: "left",
                  position: "relative",
                }}
              >
                {/* L6 edit/remove facility buttons */}
                {user?.lvl === 6 && activeOffice && (
                  <>
                    <button
                      type="button"
                      data-ocid="facility.edit_button"
                      title="EDIT FACILITY"
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditFacilityIds((prev) => {
                          const next = new Set(prev);
                          if (next.has(f.id)) next.delete(f.id);
                          else next.add(f.id);
                          return next;
                        });
                      }}
                      style={{
                        position: "absolute",
                        top: "6px",
                        right: "72px",
                        background: editFacilityIds.has(f.id) ? S.gold : "#333",
                        border: "none",
                        color: editFacilityIds.has(f.id) ? "#000" : "#fff",
                        fontSize: "0.5rem",
                        padding: "2px 6px",
                        cursor: "pointer",
                        zIndex: 2,
                        fontFamily: "inherit",
                        fontWeight: 900,
                        letterSpacing: "1px",
                      }}
                    >
                      ✏ EDIT
                    </button>
                    <button
                      type="button"
                      data-ocid="facilities.delete_button"
                      title="REMOVE FACILITY"
                      onClick={() => {
                        const updated = officeFacilities.filter(
                          (x) => x.id !== f.id,
                        );
                        setOfficeFacilitiesState(updated);
                        saveOfficeFacilities(activeOffice.id, updated);
                        if (selectedSector === f.id)
                          setSelectedSector("SECTOR DATA");
                      }}
                      style={{
                        position: "absolute",
                        top: "6px",
                        right: "6px",
                        background: S.red,
                        border: "none",
                        color: "#fff",
                        fontSize: "0.5rem",
                        padding: "2px 6px",
                        cursor: "pointer",
                        zIndex: 2,
                        fontFamily: "inherit",
                        fontWeight: 900,
                        letterSpacing: "1px",
                      }}
                    >
                      ✕ REMOVE
                    </button>
                  </>
                )}
                {/* Clickable header row */}
                <button
                  type="button"
                  data-ocid={`facility.${f.id.toLowerCase().replace(/\s+/g, "_")}.button`}
                  onClick={() => user && openSector(f.id)}
                  style={{
                    background: "transparent",
                    border: "none",
                    cursor: user ? "pointer" : "default",
                    height: "100px",
                    display: "flex",
                    alignItems: "center",
                    padding: "0 20px",
                    width: "100%",
                    textAlign: "left",
                  }}
                  onMouseEnter={(e) => {
                    if (user) {
                      const parent = (e.currentTarget as HTMLButtonElement)
                        .parentElement;
                      if (parent) parent.style.borderColor = S.gold;
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (selectedSector !== f.id) {
                      const parent = (e.currentTarget as HTMLButtonElement)
                        .parentElement;
                      if (parent) parent.style.borderColor = S.brd;
                    }
                  }}
                >
                  <div
                    style={{
                      fontSize: "2rem",
                      marginRight: "20px",
                      minWidth: "50px",
                      textAlign: "center",
                      flexShrink: 0,
                    }}
                  >
                    {f.logoUrl ? (
                      <img
                        src={f.logoUrl}
                        alt={f.name}
                        style={{
                          width: "50px",
                          height: "50px",
                          objectFit: "cover",
                          borderRadius: "4px",
                        }}
                      />
                    ) : (
                      f.icon
                    )}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <h4
                      style={{
                        margin: 0,
                        fontSize: "0.9rem",
                        color: selectedSector === f.id ? S.gold : S.white,
                        letterSpacing: "2px",
                      }}
                    >
                      {f.name}
                    </h4>
                    <p
                      style={{
                        margin: "4px 0 0",
                        fontSize: "0.6rem",
                        color: S.dim,
                        textTransform: "uppercase",
                      }}
                    >
                      {f.desc}
                    </p>
                  </div>
                  {soldOut.length > 0 && (
                    <span
                      style={{
                        background: S.red,
                        color: "#fff",
                        fontSize: "0.55rem",
                        fontWeight: 900,
                        letterSpacing: "1px",
                        padding: "2px 6px",
                        borderRadius: "2px",
                        flexShrink: 0,
                        marginLeft: "8px",
                      }}
                    >
                      {soldOut.length} SOLD OUT
                    </span>
                  )}
                </button>

                {/* Inline facility edit panel */}
                {editFacilityIds.has(f.id) &&
                  user?.lvl === 6 &&
                  activeOffice && (
                    <div
                      style={{
                        background: "#0a0a0a",
                        borderTop: `1px solid ${S.brd}`,
                        padding: "10px 20px",
                        display: "flex",
                        flexDirection: "column",
                        gap: "8px",
                      }}
                    >
                      <div
                        style={{
                          fontSize: "0.5rem",
                          color: S.gold,
                          letterSpacing: "3px",
                          fontWeight: 900,
                        }}
                      >
                        EDIT FACILITY
                      </div>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "8px",
                        }}
                      >
                        <span
                          style={{
                            fontSize: "0.55rem",
                            color: S.dim,
                            letterSpacing: "2px",
                            minWidth: "60px",
                          }}
                        >
                          NAME
                        </span>
                        <input
                          type="text"
                          data-ocid="facility.name.input"
                          defaultValue={f.name}
                          onBlur={(e) => {
                            const newName = e.currentTarget.value.trim();
                            if (!newName) return;
                            const updated = officeFacilities.map((x) =>
                              x.id === f.id ? { ...x, name: newName } : x,
                            );
                            setOfficeFacilitiesState(updated);
                            saveOfficeFacilities(activeOffice.id, updated);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") e.currentTarget.blur();
                          }}
                          style={{
                            flex: 1,
                            background: "#111",
                            border: `1px solid ${S.brd}`,
                            color: S.white,
                            fontFamily: "inherit",
                            fontSize: "0.7rem",
                            padding: "4px 8px",
                            letterSpacing: "1px",
                            outline: "none",
                          }}
                        />
                      </div>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "8px",
                          flexWrap: "wrap",
                        }}
                      >
                        <span
                          style={{
                            fontSize: "0.55rem",
                            color: S.dim,
                            letterSpacing: "2px",
                            minWidth: "60px",
                          }}
                        >
                          LOGO
                        </span>
                        <label
                          data-ocid="facility.logo.upload_button"
                          style={{
                            background: "#222",
                            border: `1px solid ${S.brd}`,
                            color: S.white,
                            fontSize: "0.55rem",
                            padding: "3px 10px",
                            cursor: "pointer",
                            letterSpacing: "1px",
                            fontWeight: 900,
                          }}
                        >
                          📂 UPLOAD LOGO
                          <input
                            type="file"
                            accept="image/*"
                            style={{ display: "none" }}
                            onChange={(e) => {
                              const file = e.currentTarget.files?.[0];
                              if (!file) return;
                              const reader = new FileReader();
                              reader.onload = (ev) => {
                                const logoUrl = ev.target?.result as string;
                                const updated = officeFacilities.map((x) =>
                                  x.id === f.id ? { ...x, logoUrl } : x,
                                );
                                setOfficeFacilitiesState(updated);
                                saveOfficeFacilities(activeOffice.id, updated);
                              };
                              reader.readAsDataURL(file);
                            }}
                          />
                        </label>
                        {f.logoUrl && (
                          <button
                            type="button"
                            data-ocid="facility.logo.delete_button"
                            onClick={() => {
                              const updated = officeFacilities.map((x) =>
                                x.id === f.id
                                  ? { ...x, logoUrl: undefined }
                                  : x,
                              );
                              setOfficeFacilitiesState(updated);
                              saveOfficeFacilities(activeOffice.id, updated);
                            }}
                            style={{
                              background: S.red,
                              border: "none",
                              color: "#fff",
                              fontSize: "0.55rem",
                              padding: "3px 10px",
                              cursor: "pointer",
                              fontFamily: "inherit",
                              fontWeight: 900,
                              letterSpacing: "1px",
                            }}
                          >
                            ✕ CLEAR LOGO
                          </button>
                        )}
                      </div>
                    </div>
                  )}

                {/* Sold-out scroll list — only shown when there are sold-out items */}
                {soldOut.length > 0 && (
                  <div
                    style={{
                      borderTop: `1px solid ${S.red}44`,
                      padding: "6px 20px 10px 20px",
                    }}
                  >
                    <div
                      style={{
                        fontSize: "0.5rem",
                        color: S.red,
                        letterSpacing: "3px",
                        fontWeight: 900,
                        marginBottom: "5px",
                      }}
                    >
                      SOLD OUT
                    </div>
                    <div
                      className="xution-scroll"
                      style={{
                        maxHeight: "80px",
                        overflowY: "auto",
                        display: "flex",
                        flexDirection: "column",
                        gap: "4px",
                      }}
                    >
                      {soldOut.map((item) => (
                        <div
                          key={`tile-so-${item.id}`}
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                            fontSize: "0.6rem",
                            color: S.white,
                            letterSpacing: "1px",
                            paddingBottom: "3px",
                            borderBottom: `1px solid ${S.brd}`,
                          }}
                        >
                          <span style={{ fontWeight: 900 }}>{item.name}</span>
                          <span
                            style={{
                              color: S.gold,
                              fontWeight: 900,
                              marginLeft: "8px",
                              flexShrink: 0,
                            }}
                          >
                            {formatFunds(item.price)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Sector Workspace */}
        {user && selectedSector !== "SECTOR DATA" && (
          <SectorWorkspace
            currentUser={user}
            selectedSector={selectedSector}
            onActivity={refreshActivities}
            activeOffice={activeOffice}
            lockdown={lockdown}
          />
        )}

        {/* About Section */}
        <div
          style={{
            marginTop: "40px",
            borderTop: `2px solid ${S.gold}`,
            paddingTop: "30px",
          }}
        >
          <EditableSection
            title="ABOUT XUTION"
            storageKey="x_about_content_v1"
            defaultContent={DEFAULT_ABOUT_CONTENT}
            currentUser={user}
            renderContent={(text) => (
              <p
                style={{
                  fontSize: "0.85rem",
                  opacity: 0.8,
                  lineHeight: 1.8,
                  whiteSpace: "pre-wrap",
                  margin: 0,
                }}
              >
                {text}
              </p>
            )}
          />

          <EditableSection
            title="FEATURES & CREDITS"
            storageKey="x_features_content_v1"
            defaultContent={DEFAULT_FEATURES_CONTENT}
            currentUser={user}
            renderContent={(text) => (
              <ul
                style={{
                  fontSize: "0.8rem",
                  opacity: 0.85,
                  listStyleType: "disc",
                  paddingLeft: "25px",
                  lineHeight: 2,
                  margin: 0,
                }}
              >
                {text
                  .split("\n")
                  .filter((line) => line.trim())
                  .map((line, i) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: static list
                    <li key={i}>{line.trim()}</li>
                  ))}
              </ul>
            )}
          />

          <EditableSection
            title="CREDITS"
            storageKey="x_credits_content_v1"
            defaultContent={DEFAULT_CREDITS_CONTENT}
            currentUser={user}
            renderContent={(text) => (
              <p
                style={{
                  fontSize: "0.8rem",
                  opacity: 0.7,
                  whiteSpace: "pre-wrap",
                  margin: 0,
                }}
              >
                {text}
              </p>
            )}
          />
        </div>
      </div>

      {/* Footer */}
      <footer
        style={{
          textAlign: "center",
          padding: "20px 0",
          borderTop: `1px solid ${S.brd}`,
          marginTop: "40px",
          fontSize: "0.7rem",
          opacity: 0.5,
        }}
      >
        &copy; 2026 XUTION | Sovereign Operations Portal
      </footer>
    </div>
  );
}
