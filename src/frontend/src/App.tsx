import { useCallback, useEffect, useRef, useState } from "react";

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

interface SectorLog {
  id?: string;
  sector: string;
  title: string;
  body: string;
  author: string;
  level: number;
  date: string;
}

interface AdminPost {
  id?: string;
  author: string;
  content: string;
  minLvl: number;
  date: string;
  sector?: string;
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

interface DMMessage {
  from: string;
  text: string;
  ts: string;
}

interface TransactionEntry {
  member: string;
  prevAmount: number;
  newAmount: number;
  changedBy: string;
  ts: string;
  description?: string;
}

interface MenuItem {
  id: string;
  facility: string;
  name: string;
  price: number;
  description: string;
  createdBy: string;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const IMMUNE = ["UNITY", "SYNDELIOUS"];

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
  const raw = getRawActivities();
  const entry: ActivityEntry = { msg, ts: new Date().toISOString() };
  raw.unshift(entry);
  localStorage.setItem("x_act_v22", JSON.stringify(raw.slice(0, 50)));
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

function getFacilityMenu(facility: string): MenuItem[] {
  return getMenuItems().filter((item) => item.facility === facility);
}

function getCardExpiry(uid: string | undefined): string {
  if (!uid) return "01/29";
  const uidNum = Number.parseInt(uid, 10);
  const mm = String((uidNum % 12) + 1).padStart(2, "0");
  return `${mm}/29`;
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
function addDM(a: string, b: string, from: string, text: string) {
  const msgs = getDMs(a, b);
  msgs.push({ from, text, ts: new Date().toISOString() });
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
        </div>
      </div>

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
  const [expanded, setExpanded] = useState(false);
  const [db] = useState<UserDB>(getDB);
  const [inputVals, setInputVals] = useState<Record<string, string>>({});
  const memberNames = Object.keys(db);

  const handleSet = (name: string) => {
    const val = Number.parseFloat(inputVals[name] || "");
    if (Number.isNaN(val) || val < 0) return;
    const prev = getFunds(name);
    const next = Number.parseFloat(val.toFixed(2));
    setFunds(name, next);
    addTransaction({
      member: name,
      prevAmount: prev,
      newAmount: next,
      changedBy: currentUser.name,
      ts: new Date().toISOString(),
      description: `FUND ADJUSTMENT BY ${currentUser.name}`,
    });
    setInputVals((prev) => ({ ...prev, [name]: "" }));
    onUpdate();
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
}: {
  currentUser: CurrentUser;
}) {
  const [expanded, setExpanded] = useState(false);
  const [txns, setTxns] = useState<TransactionEntry[]>(() =>
    getMemberTransactions(currentUser.name),
  );

  const refresh = () => setTxns(getMemberTransactions(currentUser.name));

  // Poll for updates (e.g. L6 adjusts your balance)
  useEffect(() => {
    const id = setInterval(refresh, 3000);
    return () => clearInterval(id);
  });

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
              NO TRANSACTIONS YET
            </div>
          ) : (
            txns.map((t, i) => {
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
                        color: S.white,
                        fontWeight: 900,
                        letterSpacing: "1px",
                        marginBottom: "2px",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {t.description || "FUND UPDATE"}
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
  const [expanded, setExpanded] = useState(false);
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [funds, setFundsState] = useState<number>(() =>
    getFunds(currentUser.name),
  );

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

    const prevAmount = funds;
    const newAmount = isSovereign
      ? prevAmount
      : Number.parseFloat((prevAmount - cost).toFixed(2));

    if (!isSovereign) {
      setFunds(currentUser.name, newAmount);
      setFundsState(newAmount);
    }

    addTransaction({
      member: currentUser.name,
      prevAmount,
      newAmount,
      changedBy: currentUser.name,
      ts: new Date().toISOString(),
      description: `PURCHASE: ${desc}`,
    });
    addActivity(`PURCHASE: ${desc} BY ${currentUser.name}`);

    setDescription("");
    setAmount("");
    setSuccess(true);
    onPurchase();

    setTimeout(() => setSuccess(false), 2000);
  };

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
  );
}

// ─── GlobalTransactionHistory (L6 only) ──────────────────────────────────────

function GlobalTransactionHistory() {
  const [expanded, setExpanded] = useState(false);
  const [txns, setTxns] = useState<TransactionEntry[]>(getTransactions);

  const refresh = () => setTxns(getTransactions());

  useEffect(() => {
    const id = setInterval(refresh, 3000);
    return () => clearInterval(id);
  });

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
          {/* Column headers */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr 1fr 1fr",
              gap: "8px",
              paddingBottom: "8px",
              borderBottom: `1px solid ${S.red}44`,
              marginBottom: "6px",
            }}
          >
            {["MEMBER", "PREV", "NEW", "BY / DATE"].map((col) => (
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
            ))}
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
                      gridTemplateColumns: "1fr 1fr 1fr 1fr",
                      gap: "8px",
                      padding: "6px 0",
                      borderBottom: `1px solid ${S.brd}`,
                      alignItems: "center",
                    }}
                  >
                    <div
                      style={{
                        fontSize: "0.65rem",
                        color: S.white,
                        fontWeight: 900,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {t.member}
                    </div>
                    <div
                      style={{
                        fontSize: "0.65rem",
                        color: S.dim,
                        fontWeight: 900,
                      }}
                    >
                      {formatFunds(t.prevAmount)}
                    </div>
                    <div
                      style={{
                        fontSize: "0.65rem",
                        fontWeight: 900,
                        color: isPositive ? S.green : S.red,
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

function AuthScreen({ onLogin }: { onLogin: (user: CurrentUser) => void }) {
  const [mode, setMode] = useState<"up" | "in">("up");
  const [name, setName] = useState("");
  const [lvl, setLvl] = useState(1);
  const [q, setQ] = useState("");
  const [a, setA] = useState("");
  const [loginA, setLoginA] = useState("");
  const [qDisp, setQDisp] = useState("");
  const [err, setErr] = useState("");

  const handleNameChange = useCallback(
    (val: string) => {
      setName(val);
      if (mode === "in") {
        const db = getDB();
        const upper = val.trim().toUpperCase();
        if (db[upper]) {
          setQDisp(`CHALLENGE: ${db[upper].q}`);
        } else {
          setQDisp("NOT FOUND");
        }
      }
    },
    [mode],
  );

  const switchMode = (m: "up" | "in") => {
    setMode(m);
    setErr("");
    setQDisp("");
  };

  const runAuth = () => {
    const n = name.trim().toUpperCase();
    const db = getDB();
    setErr("");
    if (!n) return;

    if (mode === "up") {
      if (db[n]) {
        setErr("NAME CLAIMED");
        return;
      }
      if (!q || !a) {
        setErr("DATA MISSING");
        return;
      }
      const uid = generateUID();
      const record: UserRecord = { lvl, q, a: a.trim().toLowerCase(), uid };
      db[n] = record;
      setDB(db);
      addActivity(`NEW ID REGISTERED: ${n}`);
      onLogin({ name: n, ...record });
    } else {
      if (!db[n]) {
        setErr("NOT FOUND");
        return;
      }
      if (db[n].a !== loginA.trim().toLowerCase()) {
        setErr("DENIED");
        return;
      }
      addActivity(`ID LOGGED IN: ${n}`);
      onLogin({ name: n, ...db[n] });
    }
  };

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
          style={{ ...btnPrimary, marginTop: "15px" }}
          onClick={runAuth}
        >
          INITIALIZE
        </button>
        {err && (
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
      </div>
    </div>
  );
}

// ─── DMPanel ──────────────────────────────────────────────────────────────────

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
  const scrollRef = useRef<HTMLDivElement>(null);
  const [isFav, setIsFav] = useState(() =>
    getFavourites(currentUser.name).includes(target),
  );

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
    if (!text) return;
    addDM(currentUser.name, target, currentUser.name, text);
    setInput("");
    refresh();
  };

  return (
    <div
      style={{
        position: "fixed",
        bottom: "70px",
        right: "20px",
        width: "320px",
        maxWidth: "calc(100vw - 40px)",
        background: "#0a0a0a",
        border: `2px solid ${S.gold}`,
        zIndex: 9000,
        display: "flex",
        flexDirection: "column",
        fontFamily: "'JetBrains Mono', 'Courier New', monospace",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "10px 12px",
          borderBottom: `1px solid ${S.brd}`,
          background: "#080808",
        }}
      >
        <span
          style={{
            color: S.gold,
            fontSize: "0.75rem",
            fontWeight: 900,
            letterSpacing: "2px",
            textTransform: "uppercase",
            flex: 1,
            minWidth: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          DM: {target}
        </span>
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

      {/* Message history */}
      <div
        ref={scrollRef}
        className="xution-scroll"
        style={{
          maxHeight: "250px",
          overflowY: "auto",
          padding: "10px 12px",
          display: "flex",
          flexDirection: "column",
          gap: "6px",
        }}
      >
        {messages.length === 0 ? (
          <div
            style={{
              color: S.dim,
              fontSize: "0.65rem",
              textAlign: "center",
              padding: "20px 0",
              textTransform: "uppercase",
            }}
          >
            NO MESSAGES YET
          </div>
        ) : (
          messages.map((msg, i) => {
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
                    maxWidth: "85%",
                    wordBreak: "break-word",
                    textTransform: "uppercase",
                    fontWeight: 900,
                    border: isOwn
                      ? `1px solid ${S.gold}33`
                      : `1px solid ${S.brd}`,
                  }}
                >
                  {msg.text}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Input */}
      <div
        style={{
          display: "flex",
          borderTop: `1px solid ${S.brd}`,
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
  onChangeLvl,
  onDel,
}: {
  memberName: string;
  db: UserDB;
  currentUser: CurrentUser;
  isFav: boolean;
  onDM: (name: string) => void;
  onFavToggle: (name: string) => void;
  onChangeLvl: (name: string, change: number) => void;
  onDel: (name: string) => void;
}) {
  const isImmune = IMMUNE.includes(memberName);
  const isSelf = memberName === currentUser.name;
  const canAdmin = currentUser.lvl === 6 && !isImmune;
  const [unread, setUnread] = useState(() =>
    isSelf ? 0 : getDMUnreadCount(currentUser.name, memberName),
  );

  // Poll for new messages every 3 seconds
  useEffect(() => {
    if (isSelf) return;
    const id = setInterval(() => {
      setUnread(getDMUnreadCount(currentUser.name, memberName));
    }, 3000);
    return () => clearInterval(id);
  }, [memberName, currentUser.name, isSelf]);

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

      {/* Action buttons */}
      {(!isSelf || canAdmin) && (
        <div style={{ display: "flex", gap: "5px", width: "100%" }}>
          {!isSelf && (
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
          )}
          {canAdmin && (
            <>
              <button
                type="button"
                style={{
                  ...btnSmall,
                  background: "#1a3a1a",
                  color: S.green,
                  border: `1px solid ${S.green}44`,
                }}
                onClick={() => onChangeLvl(memberName, 1)}
              >
                LVL +
              </button>
              <button
                type="button"
                style={{
                  ...btnSmall,
                  background: "#1a1a00",
                  color: S.gold,
                  border: `1px solid ${S.gold}44`,
                }}
                onClick={() => onChangeLvl(memberName, -1)}
              >
                LVL −
              </button>
              {!isSelf && (
                <button
                  type="button"
                  style={{
                    ...btnSmall,
                    background: S.red,
                    color: "#fff",
                  }}
                  onClick={() => onDel(memberName)}
                >
                  DELETE
                </button>
              )}
            </>
          )}
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
}: {
  currentUser: CurrentUser;
  onActivity: () => void;
  onDM: (name: string) => void;
}) {
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

  const refresh = () => setDbState(getDB());

  const handleFavToggle = (name: string) => {
    const next = toggleFavourite(currentUser.name, name);
    setFavs(next);
  };

  const changeLvl = (name: string, change: number) => {
    if (IMMUNE.includes(name)) return;
    const d = getDB();
    const newLvl = d[name].lvl + change;
    if (newLvl < 1 || newLvl > 6) return;
    d[name].lvl = newLvl;
    setDB(d);
    addActivity(`MODIFIED ${name} TO L${newLvl}`);
    refresh();
    onActivity();
  };

  const delMem = (name: string) => {
    if (name === currentUser.name || IMMUNE.includes(name)) return;
    if (window.confirm(`TERMINATE IDENTITY: ${name}?`)) {
      const d = getDB();
      delete d[name];
      setDB(d);
      addActivity(`DELETED IDENTITY: ${name}`);
      refresh();
      onActivity();
    }
  };

  const memberNames = Object.keys(db);
  const favouriteNames = favs.filter((n) => memberNames.includes(n));
  const otherNames = memberNames.filter((n) => !favs.includes(n));

  const sharedRowProps = {
    db,
    currentUser,
    onDM,
    onFavToggle: handleFavToggle,
    onChangeLvl: changeLvl,
    onDel: delMem,
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
      )}
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
  const isSovereign = currentUser.lvl === 6;
  const [items, setItemsState] = useState<MenuItem[]>(() =>
    getFacilityMenu(facility),
  );
  const [addOpen, setAddOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [newPrice, setNewPrice] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [successIds, setSuccessIds] = useState<Record<string, boolean>>({});
  const [funds, setFundsState] = useState<number>(() =>
    getFunds(currentUser.name),
  );

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
    const prevAmount = funds;
    const newAmount = isSovereign
      ? prevAmount
      : Number.parseFloat((prevAmount - item.price).toFixed(2));
    if (!isSovereign) {
      setFunds(currentUser.name, newAmount);
      setFundsState(newAmount);
    }
    addTransaction({
      member: currentUser.name,
      prevAmount,
      newAmount,
      changedBy: currentUser.name,
      ts: new Date().toISOString(),
      description: `PURCHASE: ${item.name} @ ${facility}`,
    });
    addActivity(
      `PURCHASE: ${item.name} FROM ${facility} BY ${currentUser.name}`,
    );
    onActivity();
    setSuccessIds((prev) => ({ ...prev, [item.id]: true }));
    setTimeout(
      () => setSuccessIds((prev) => ({ ...prev, [item.id]: false })),
      2000,
    );
  };

  const handleAddItem = () => {
    const name = newName.trim();
    const price = Number.parseFloat(newPrice);
    if (!name) return;
    if (Number.isNaN(price) || price < 0) return;
    const allItems = getMenuItems();
    const newItem: MenuItem = {
      id: Date.now().toString(),
      facility,
      name,
      price: Number.parseFloat(price.toFixed(2)),
      description: newDesc.trim(),
      createdBy: currentUser.name,
    };
    allItems.push(newItem);
    setMenuItems(allItems);
    setNewName("");
    setNewDesc("");
    setNewPrice("");
    addActivity(`MENU ITEM ADDED: ${name} TO ${facility}`);
    onActivity();
    refreshItems();
  };

  const handleDeleteItem = (itemId: string) => {
    const allItems = getMenuItems().filter((i) => i.id !== itemId);
    setMenuItems(allItems);
    addActivity(`MENU ITEM DELETED FROM ${facility}`);
    onActivity();
    refreshItems();
  };

  return (
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
          {items.map((item) => (
            <div
              key={item.id}
              style={{
                padding: "10px 12px",
                marginBottom: "8px",
                background: "#050505",
                border: `1px solid ${S.brd}`,
                display: "flex",
                flexDirection: "column",
                gap: "6px",
              }}
            >
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
                      color: S.white,
                      fontWeight: 900,
                      letterSpacing: "1px",
                    }}
                  >
                    {item.name}
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
              <div style={{ display: "flex", gap: "6px" }}>
                <button
                  type="button"
                  style={{
                    ...btnSmall,
                    background: S.gold,
                    color: "#000",
                    flex: "none",
                    padding: "7px 14px",
                  }}
                  onClick={() => handlePurchase(item)}
                >
                  PURCHASE
                </button>
                {isSovereign && (
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
          ))}
        </div>
      )}
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
                onKeyDown={(e) => e.key === "Enter" && handleAddItem()}
                style={{ ...inputStyle, marginBottom: "0" }}
              />
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
  );
}

// ─── SectorWorkspace ──────────────────────────────────────────────────────────

function SectorWorkspace({
  currentUser,
  selectedSector,
  onActivity,
  activeOffice,
}: {
  currentUser: CurrentUser;
  selectedSector: string;
  onActivity: () => void;
  activeOffice: OfficeLocation | null;
}) {
  const [logs, setLogs] = useState<SectorLog[]>(getSectorLogs);
  const [adminPosts, setAdminPostsState] = useState<AdminPost[]>(getAdminPosts);
  const [ebMsg, setEbMsg] = useState("");
  // Selected office within the Offices sector (for browsing the list)
  const [selectedOffice, setSelectedOffice] = useState<OfficeLocation | null>(
    null,
  );
  const [ebActive, setEbActive] = useState(!!getBroadcastMsg());

  // Log form state
  const [logTitle, setLogTitle] = useState("");
  const [logBody, setLogBody] = useState("");
  const [logLevel, setLogLevel] = useState(1);

  // Post form state
  const [postTxt, setPostTxt] = useState("");
  const [postMinLvl, setPostMinLvl] = useState(1);

  // Post edit state: maps post id -> edit draft text (undefined = not editing)
  const [editingPost, setEditingPost] = useState<Record<string, string>>({});

  // Log edit state: maps log id -> edit draft body (undefined = not editing)
  const [editingLog, setEditingLog] = useState<Record<string, string>>({});

  const refreshLogs = () => setLogs(getSectorLogs());
  const refreshPosts = () => setAdminPostsState(getAdminPosts());

  const submitLog = () => {
    if (!logTitle || !logBody) return;
    const allLogs = getSectorLogs();
    allLogs.push({
      id: Date.now().toString(),
      sector: activeSectorKey,
      title: logTitle,
      body: logBody,
      author: currentUser.name,
      level: logLevel,
      date: new Date().toLocaleString(),
    });
    setSectorLogs(allLogs);
    setLogTitle("");
    setLogBody("");
    refreshLogs();
  };

  const toggleEB = () => {
    if (!ebMsg) return;
    setBroadcastMsg(ebMsg);
    setEbActive(true);
    addActivity("EMERGENCY BROADCAST ACTIVATED");
    onActivity();
  };

  const deactivateEB = () => {
    setBroadcastMsg("");
    setEbActive(false);
    setEbMsg("");
    addActivity("EMERGENCY BROADCAST DEACTIVATED");
    onActivity();
  };

  const makePost = () => {
    if (!postTxt) return;
    const posts = getAdminPosts();
    posts.push({
      id: Date.now().toString(),
      author: currentUser.name,
      content: postTxt,
      minLvl: postMinLvl,
      date: new Date().toLocaleString(),
      sector: activeSectorKey,
    });
    setAdminPosts(posts);
    setPostTxt("");
    addActivity("ADMIN POST TRANSMITTED");
    refreshPosts();
    onActivity();
  };

  const deletePost = (postId: string) => {
    const posts = getAdminPosts().filter((p) => p.id !== postId);
    setAdminPosts(posts);
    addActivity("ADMIN POST DELETED");
    refreshPosts();
    onActivity();
  };

  const saveEditPost = (postId: string, newContent: string) => {
    const posts = getAdminPosts().map((p) =>
      p.id === postId ? { ...p, content: newContent } : p,
    );
    setAdminPosts(posts);
    refreshPosts();
    onActivity();
  };

  const deleteLog = (logId: string) => {
    const logs = getSectorLogs().filter((l) => l.id !== logId);
    setSectorLogs(logs);
    addActivity("SECTOR LOG DELETED");
    refreshLogs();
    onActivity();
  };

  const saveEditLog = (logId: string, newBody: string) => {
    const logs = getSectorLogs().map((l) =>
      l.id === logId ? { ...l, body: newBody } : l,
    );
    setSectorLogs(logs);
    refreshLogs();
    onActivity();
  };

  // Reset selected office when sector changes
  // biome-ignore lint/correctness/useExhaustiveDependencies: selectedSector is a prop that drives this reset
  useEffect(() => {
    setSelectedOffice(null);
  }, [selectedSector]);

  // Update EB banner in parent
  useEffect(() => {
    const stored = getBroadcastMsg();
    if (stored) setEbActive(true);
  }, []);

  // Propagate EB state up to App level
  useEffect(() => {
    const event = new CustomEvent("xution-eb", {
      detail: { active: ebActive, msg: getBroadcastMsg() },
    });
    window.dispatchEvent(event);
  }, [ebActive]);

  // Use the global active office (if set) as a namespace prefix for facility data.
  // Within the Offices sector, a locally-selected office overrides for browsing.
  const activeSectorKey = activeOffice
    ? `${activeOffice.name}::${selectedSector}`
    : selectedOffice
      ? selectedOffice.name
      : selectedSector;

  const filteredLogs = logs
    .filter((l) => l.sector === activeSectorKey)
    .slice()
    .reverse();

  const filteredPosts = adminPosts.filter(
    (p) =>
      p.minLvl <= currentUser.lvl &&
      (!p.sector || p.sector === activeSectorKey),
  );

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
            const redacted = currentUser.lvl < l.level;
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
                  <p style={{ margin: "4px 0 0", color: S.white }}>{l.body}</p>
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
          <button
            type="button"
            style={{ ...btnPrimary, marginTop: "8px" }}
            onClick={submitLog}
          >
            SUBMIT LOG
          </button>
        </div>
      )}

      {/* L6 Emergency Broadcast */}
      {currentUser.lvl === 6 && (
        <div
          style={{
            borderTop: `1px solid ${S.brd}`,
            paddingTop: "15px",
            marginBottom: "20px",
          }}
        >
          <p style={{ color: S.red, fontSize: "0.7rem", marginBottom: "10px" }}>
            EMERGENCY BROADCAST TOOL
          </p>
          <input
            type="text"
            placeholder="BROADCAST MESSAGE"
            value={ebMsg}
            onChange={(e) => setEbMsg(e.target.value)}
            style={{ ...inputStyle, borderColor: S.red }}
          />
          <button
            type="button"
            style={{
              ...btnPrimary,
              background: S.red,
              color: "#fff",
              marginTop: "8px",
            }}
            onClick={toggleEB}
          >
            ACTIVATE BROADCAST
          </button>
          {ebActive && (
            <button
              type="button"
              style={{
                ...btnPrimary,
                background: "#222",
                color: S.red,
                border: `1px solid ${S.red}`,
                marginTop: "8px",
              }}
              onClick={deactivateEB}
            >
              DEACTIVATE BROADCAST
            </button>
          )}
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

                  {isEditing ? (
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
                    <p style={{ margin: "4px 0 0", color: S.white }}>
                      {p.content}
                    </p>
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

// ─── App ──────────────────────────────────────────────────────────────────────

export default function App() {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [activities, setActivities] =
    useState<ActivityEntry[]>(get24hActivities);
  const [ebActive, setEbActive] = useState(!!getBroadcastMsg());
  const [ebMsg, setEbMsg] = useState(getBroadcastMsg());
  const [selectedSector, setSelectedSector] = useState("SECTOR DATA");
  const [dmTarget, setDmTarget] = useState<string | null>(null);
  const [avatarUrl, setAvatarUrl] = useState<string>("");
  const avatarInputRef = useRef<HTMLInputElement>(null);
  // Global active office — determines which office's data is shown for all facilities
  const [activeOffice, setActiveOffice] = useState<OfficeLocation | null>(null);
  const [officePickerOpen, setOfficePickerOpen] = useState(false);

  const refreshActivities = useCallback(() => {
    setActivities(get24hActivities());
  }, []);

  // Listen for EB events from SectorWorkspace
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail.active) {
        setEbActive(true);
        setEbMsg(getBroadcastMsg());
      }
    };
    window.addEventListener("xution-eb", handler);
    return () => window.removeEventListener("xution-eb", handler);
  }, []);

  const handleLogin = (u: CurrentUser) => {
    setUser(u);
    setAvatarUrl(getAvatar(u.name));
    refreshActivities();
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
  };

  const handleLogout = () => {
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
      {!user && <AuthScreen onLogin={handleLogin} />}

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

      {/* Contact Pill */}
      <a
        href="mailto:Gameloverv@gmail.com"
        style={{
          position: "fixed",
          bottom: "20px",
          right: "20px",
          background: S.gold,
          color: "#000",
          padding: "12px",
          borderRadius: "4px",
          textDecoration: "none",
          zIndex: 9999,
          fontSize: "0.7rem",
          border: "2px solid #000",
          fontFamily: "'JetBrains Mono', 'Courier New', monospace",
          fontWeight: 900,
          textTransform: "uppercase",
        }}
      >
        📧 CONTACT COMMAND
      </a>

      {/* DM Panel */}
      {user && dmTarget && (
        <DMPanel
          currentUser={user}
          target={dmTarget}
          onClose={() => setDmTarget(null)}
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
                {user && (
                  <button
                    type="button"
                    style={{
                      ...btnSmall,
                      background: S.red,
                      color: "#fff",
                      marginTop: "8px",
                      width: "100%",
                      padding: "6px",
                    }}
                    onClick={handleLogout}
                  >
                    LOGOUT
                  </button>
                )}
              </div>
            </div>

            {/* Hidden file input */}
            {user && (
              <input
                ref={avatarInputRef}
                type="file"
                accept="image/*"
                style={{ display: "none" }}
                onChange={handleAvatarChange}
              />
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
                <PersonalTransactionHistory currentUser={user} />
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

        {/* Fund Management (L6 Sovereigns only) */}
        {user?.lvl === 6 && (
          <>
            <FundManagement onUpdate={refreshActivities} currentUser={user} />
            <GlobalTransactionHistory />
          </>
        )}

        {/* Member Directory (collapsible, all logged-in users) */}
        {user && (
          <MemberList
            currentUser={user}
            onActivity={refreshActivities}
            onDM={(name) => setDmTarget(name)}
          />
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
                          setActiveOffice(isActive ? null : office);
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
        <h3
          style={{
            borderLeft: `5px solid ${S.gold}`,
            paddingLeft: "15px",
            marginBottom: "20px",
            fontSize: "0.9rem",
            letterSpacing: "3px",
          }}
        >
          FACILITIES
        </h3>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr",
            gap: "12px",
            marginBottom: "30px",
          }}
        >
          {FACILITIES.map((f) => (
            <button
              type="button"
              key={f.id}
              onClick={() => user && openSector(f.id)}
              style={{
                background: "#0c0c0c",
                border: `1px solid ${selectedSector === f.id ? S.gold : S.brd}`,
                cursor: user ? "pointer" : "default",
                height: "100px",
                display: "flex",
                alignItems: "center",
                padding: "0 20px",
                transition: "border-color 0.15s",
                borderLeft:
                  selectedSector === f.id
                    ? `4px solid ${S.gold}`
                    : `1px solid ${S.brd}`,
                width: "100%",
                textAlign: "left",
              }}
              onMouseEnter={(e) => {
                if (user) {
                  (e.currentTarget as HTMLButtonElement).style.borderColor =
                    S.gold;
                }
              }}
              onMouseLeave={(e) => {
                if (selectedSector !== f.id) {
                  (e.currentTarget as HTMLButtonElement).style.borderColor =
                    S.brd;
                }
              }}
            >
              <div
                style={{
                  fontSize: "2rem",
                  marginRight: "20px",
                  minWidth: "50px",
                  textAlign: "center",
                }}
              >
                {f.icon}
              </div>
              <div>
                <h4
                  style={{
                    margin: 0,
                    fontSize: "0.9rem",
                    color: selectedSector === f.id ? S.gold : S.white,
                    letterSpacing: "2px",
                  }}
                >
                  {f.id}
                </h4>
                <p
                  style={{
                    margin: "4px 0 0",
                    fontSize: "0.6rem",
                    color: S.dim,
                    textTransform: "uppercase",
                  }}
                >
                  {f.d}
                </p>
              </div>
            </button>
          ))}
        </div>

        {/* Sector Workspace */}
        {user && selectedSector !== "SECTOR DATA" && (
          <SectorWorkspace
            currentUser={user}
            selectedSector={selectedSector}
            onActivity={refreshActivities}
            activeOffice={activeOffice}
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
