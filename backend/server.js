import express from "express";
import cors from "cors";
import session from "express-session";
import bcrypt from "bcrypt";
import { pool } from "./db.js";

const app = express();

// ✅ CORS: allow your frontend origin and cookies
app.use(cors({
  origin: "http://127.0.0.1:5500/frontend/", // replace with actual frontend origin
  credentials: true
}));

app.use(express.json());

// ✅ Session middleware
app.use(session({
  name: "daiho.sid",
  secret: process.env.SESSION_SECRET || "change_this_secret",
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, maxAge: 24 * 60 * 60 * 1000 } // 1 day
}));

// ✅ Auth routes
app.post("/login", async (req, res) => {
  const { username, password } = req.body;
  const result = await pool.query("SELECT * FROM users WHERE username=$1", [username]);
  if (result.rows.length === 0) return res.status(401).json({ error: "Invalid credentials" });

  const user = result.rows[0];
  const match = await bcrypt.compare(password, user.password_hash);
  if (!match) return res.status(401).json({ error: "Invalid credentials" });

  req.session.user = { id: user.id, role: user.role };
  res.json({ message: "Logged in", role: user.role });
});

app.post("/logout", (req, res) => {
  req.session.destroy(() => res.json({ message: "Logged out" }));
});

app.get("/me", (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: "Not logged in" });
  res.json(req.session.user);
});

// ✅ Protected middleware
function requireAuth(req, res, next) {
  if (!req.session.user) return res.status(401).json({ error: "Unauthorized" });
  next();
}

// ✅ Sales routes
app.get("/sales", requireAuth, async (req, res) => {
  const { date } = req.query;
  const result = await pool.query("SELECT * FROM sales WHERE date=$1 ORDER BY id ASC", [date]);
  const totals = await pool.query(
    "SELECT SUM(total) AS gross_sale, SUM(investment) AS total_investment, SUM(profit) AS total_profit FROM sales WHERE date=$1",
    [date]
  );
  res.json({ rows: result.rows, totals: totals.rows[0] });
});

app.post("/sales", requireAuth, async (req, res) => {
  const { date, item, qty, investment, price, total, type } = req.body;
  const profit = type === "SALE" ? (price * qty - investment * qty) : 0;
  await pool.query(
    "INSERT INTO sales(date,item,qty,investment,price,total,profit,type,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'ACTIVE')",
    [date, item, qty || null, investment || null, price || null, total, profit, type]
  );
  res.json({ message: "Sale added" });
});

app.get("/sales/:id", requireAuth, async (req, res) => {
  const result = await pool.query("SELECT * FROM sales WHERE id=$1", [req.params.id]);
  res.json(result.rows[0]);
});

app.put("/sales/:id", requireAuth, async (req, res) => {
  const { item, qty, investment, price, total, type } = req.body;
  const profit = type === "SALE" ? (price * qty - investment * qty) : 0;
  await pool.query(
    "UPDATE sales SET item=$1, qty=$2, investment=$3, price=$4, total=$5, profit=$6, type=$7 WHERE id=$8",
    [item, qty || null, investment || null, price || null, total, profit, type, req.params.id]
  );
  res.json({ message: "Sale updated" });
});

app.put("/sales/:id/toggle", requireAuth, async (req, res) => {
  await pool.query("UPDATE sales SET status = CASE WHEN status='RETURNED' THEN 'ACTIVE' ELSE 'RETURNED' END WHERE id=$1", [req.params.id]);
  res.json({ message: "Status toggled" });
});

app.delete("/sales/:id", requireAuth, async (req, res) => {
  await pool.query("DELETE FROM sales WHERE id=$1", [req.params.id]);
  res.json({ message: "Sale deleted" });
});

// ✅ Export CSV
app.get("/export", requireAuth, async (req, res) => {
  const { date } = req.query;
  const result = await pool.query("SELECT * FROM sales WHERE date=$1 ORDER BY id ASC", [date]);
  let csv = "Qty,Item,Investment,Price,Total,Profit,Type,Status\n";
  result.rows.forEach(r => {
    csv += `${r.qty || ""},${r.item},${r.investment || ""},${r.price || ""},${r.total},${r.profit},${r.type},${r.status}\n`;
  });
  res.header("Content-Type", "text/csv");
  res.attachment(`sales_${date}.csv`);
  res.send(csv);
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
