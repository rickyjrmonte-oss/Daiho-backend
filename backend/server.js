import express from "express";
import cors from "cors";
import { pool } from "./db.js";
import session from "express-session";
import bcrypt from "bcrypt";

const app = express();
app.use(cors({
  origin: 'https://daiho.onrender.com',
  credentials: true
}));

app.use(express.json());

app.use(session({
  name: "daiho.sid",
  secret: process.env.SESSION_SECRET || "change_this_secret",
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, maxAge: 24 * 60 * 60 * 1000 } // 1 day
}));

// auth middleware
function requireAuth(req, res, next) {
  if (req.session && req.session.user && req.session.user.username === "admin") {
    return next();
  }
  return res.status(401).json({ error: "Unauthorized" });
}

// optional: endpoint to check current session
app.get("/me", (req, res) => {
  if (req.session && req.session.user) return res.json({ user: req.session.user });
  return res.status(401).json({ error: "Not authenticated" });
});

// login route
app.post("/login", async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: "Missing credentials" });

  const { rows } = await pool.query("SELECT * FROM users WHERE username=$1", [username]);
  if (rows.length === 0) return res.status(401).json({ error: "Invalid credentials" });

  const user = rows[0];
  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) return res.status(401).json({ error: "Invalid credentials" });

  // create session
  req.session.user = { id: user.id, username: user.username, role: user.role };
  res.json({ ok: true });
});

// logout route
app.post("/logout", (req, res) => {
  req.session.destroy(err => {
    if (err) return res.status(500).json({ error: "Logout failed" });
    res.clearCookie("daiho.sid");
    res.json({ ok: true });
  });
});

// Utility: compute totals from rows
function computeTotals(rows) {
  let gross_sale = 0;
  let total_investment = 0;
  let total_profit = 0;

  rows.forEach(r => {
    if (r.type === "SALE" && r.status === "ACTIVE") {
      gross_sale += Number(r.total || 0);
      total_investment += Number(r.qty || 0) * Number(r.investment || 0);
      total_profit += Number(r.profit || 0);
    }
    if (r.type === "DATA" && r.status === "ACTIVE") {
      gross_sale += Number(r.total || 0);
    }
  });

  return { gross_sale, total_investment, total_profit };
}

// Health check
app.get("/health", (req, res) => {
  res.status(200).json({ ok: true, time: new Date().toISOString() });
});

// GET all sales for a date
app.get("/sales", requireAuth, async (req, res) => {
  const { date } = req.query;
  const { rows } = await pool.query(
    "SELECT * FROM sales WHERE date=$1 ORDER BY id ASC",
    [date]
  );
  const totals = computeTotals(rows);
  res.json({ rows, totals });
});

// GET single sale by ID (needed for Edit modal)
app.get("/sales/:id", requireAuth, async (req, res) => {
  const { id } = req.params;
  const { rows } = await pool.query("SELECT * FROM sales WHERE id=$1", [id]);
  if (rows.length === 0) return res.status(404).json({ error: "Not found" });
  res.json(rows[0]);
});

// POST new SALE or DATA
app.post("/sales", requireAuth, async (req, res) => {
  const { date, item, type } = req.body;

  if (type === "SALE") {
    const qty = Number(req.body.qty);
    const investment = Number(req.body.investment);
    const price = Number(req.body.price);

    if (investment > price) {
      return res.status(400).json({ error: "Investment must not exceed Price." });
    }

    const total = qty * price;
    const profit = qty * (price - investment);

    const q = `
      INSERT INTO sales (date,type,item,qty,investment,price,total,profit,status)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'ACTIVE')
      RETURNING *`;
    const { rows } = await pool.query(q, [date, type, item, qty, investment, price, total, profit]);
    return res.json(rows[0]);
  }

  if (type === "DATA") {
    const total = Number(req.body.total);
    const q = `
      INSERT INTO sales (date,type,item,total,status)
      VALUES ($1,$2,$3,$4,'ACTIVE')
      RETURNING *`;
    const { rows } = await pool.query(q, [date, type, item, total]);
    return res.json(rows[0]);
  }

  res.status(400).json({ error: "Invalid type" });
});

// PUT edit SALE or DATA
app.put("/sales/:id", requireAuth, async (req, res) => {
  const { id } = req.params;
  const { type, item, qty, investment, price, total } = req.body;

  let q, params;

  if (type === "SALE") {
    const newTotal = qty * price;
    const newProfit = qty * (price - investment);
    q = "UPDATE sales SET item=$1, qty=$2, investment=$3, price=$4, total=$5, profit=$6 WHERE id=$7 RETURNING *";
    params = [item, qty, investment, price, newTotal, newProfit, id];
  } else if (type === "DATA") {
    q = "UPDATE sales SET item=$1, total=$2 WHERE id=$3 RETURNING *";
    params = [item, total, id];
  } else {
    return res.status(400).json({ error: "Invalid type" });
  }

  const { rows } = await pool.query(q, params);
  if (rows.length === 0) return res.status(404).json({ error: "Not found" });
  res.json(rows[0]);
});

// PUT toggle RETURNED status
app.put("/sales/:id/toggle", requireAuth, async (req, res) => {
  const { id } = req.params;
  const { rows } = await pool.query("SELECT * FROM sales WHERE id=$1", [id]);
  if (rows.length === 0) return res.status(404).json({ error: "Not found" });

  const current = rows[0];
  const nextStatus = current.status === "ACTIVE" ? "RETURNED" : "ACTIVE";
  const { rows: updated } = await pool.query(
    "UPDATE sales SET status=$1 WHERE id=$2 RETURNING *",
    [nextStatus, id]
  );
  res.json(updated[0]);
});

// DELETE sale
app.delete("/sales/:id", requireAuth, async (req, res) => {
  const { id } = req.params;
  await pool.query("DELETE FROM sales WHERE id=$1", [id]);
  res.json({ ok: true });
});

// Export CSV
app.get("/export", requireAuth, async (req, res) => {
  const { date } = req.query;
  const { rows } = await pool.query(
    "SELECT * FROM sales WHERE date=$1 ORDER BY id ASC",
    [date]
  );

  const header = ["Qty","Item","Investment","Price","Total","Profit","Type","Status"].join(",");
  const lines = rows.map(r => {
    const qty = r.type === "DATA" ? "N/A" : r.qty;
    const inv = r.type === "DATA" ? "N/A" : r.investment;
    const price = r.type === "DATA" ? "N/A" : r.price;
    const profit = r.type === "DATA" ? "N/A" : r.profit;
    return [qty, r.item, inv, price, r.total, profit, r.type, r.status].join(",");
  });

  const csv = [header, ...lines].join("\n");
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", `attachment; filename="sales_${date}.csv"`);
  res.send(csv);
});

app.get("/",  (req, res) => res.send("Sales backend OK"));

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`Server running on ${PORT}`));


