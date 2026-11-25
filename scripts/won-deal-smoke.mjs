// A won deal makes the account an active customer and a billing customer. Usage: node scripts/won-deal-smoke.mjs [baseUrl]
const BASE = process.argv[2] ?? "http://localhost:5173";
const ADMIN = { email: process.env.SMOKE_ADMIN_EMAIL ?? "admin@gexart.test", password: process.env.SMOKE_ADMIN_PASSWORD ?? "LocalDevOnly-2026" };
const run = Date.now().toString(36);
let cookie = "", failures = 0;
const call = async (method, path, body) => {
  const res = await fetch(`${BASE}/api/v1${path}`, { method, headers: { "content-type": "application/json", "x-requested-with": "gexart-crm", cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
  const set = res.headers.get("set-cookie"); if (set) cookie = set.split(";")[0];
  return { status: res.status, body: await res.json().catch(() => null) };
};
const check = (name, cond, extra) => { if (cond) console.log(`  ✓ ${name}`); else (failures++, console.log(`  ✗ ${name}`, JSON.stringify(extra ?? "").slice(0, 300))); };
for (let i = 0; i < 30; i++) { try { if ((await fetch(`${BASE}/api/v1/health`)).ok) break; } catch {} await new Promise((r) => setTimeout(r, 2000)); }
await call("POST", "/auth/login", ADMIN);

console.log("Won deal becomes a customer");
const acc = await call("POST", "/accounts", { name: `Won Client ${run}`, phone: "9811122233", email: `won.${run}@example.test`, city: "Kolkata", state: "West Bengal" });
check("account created", acc.status === 201, acc.body);
const accId = acc.body.data.id;
const opp = await call("POST", "/opportunities", { name: `Deal ${run}`, account_id: accId, stage: "proposal_sent", amount_minor: 5000000, currency: "INR" });
check("deal created", opp.status === 201, opp.body);
const oppId = opp.body.data.id;
const before = await call("GET", `/billing-access/from-account/${accId}`);
check("not a customer yet", before.body?.data?.linked === false, before.body);
const won = await call("PATCH", `/opportunities/${oppId}`, { stage: "closed_won" });
check("deal marked won", won.status === 200, won.body);
const after = await call("GET", `/billing-access/from-account/${accId}`);
check("account is now a billing customer", after.body?.data?.linked === true && !!after.body.data.partyId, after.body);
const parties = (await call("GET", `/billing/masters/parties?type=CUSTOMER&search=${encodeURIComponent(`Won Client ${run}`)}&limit=5`)).body?.parties ?? [];
check("the customer exists in billing with the CRM details", parties.length === 1 && parties[0].phone === "9811122233", parties);
const acc2 = (await call("GET", `/accounts/${accId}`)).body?.data;
check("account status is active customer", acc2?.status === "active_customer", acc2?.status);
const again = await call("PATCH", `/opportunities/${oppId}`, { name: `Deal renamed ${run}` });
check("saving the won deal again changes nothing else", again.status === 200);
const parties2 = (await call("GET", `/billing/masters/parties?type=CUSTOMER&search=${encodeURIComponent(`Won Client ${run}`)}&limit=5`)).body?.parties ?? [];
check("still just one customer", parties2.length === 1, parties2.length);

console.log("Sync accounts that were already won");
const acc3 = await call("POST", "/accounts", { name: `Old Won ${run}`, phone: "9811199988" });
const opp3 = await call("POST", "/opportunities", { name: `Old deal ${run}`, account_id: acc3.body.data.id, stage: "closed_won", amount_minor: 100000, currency: "INR" });
check("deal created already won", opp3.status === 201, opp3.body);
const sync = await call("POST", "/billing-access/from-account/sync-won", {});
check("sync links the accounts that had no customer yet", sync.status === 200 && sync.body.data.checked >= 0, sync.body);
const l3 = await call("GET", `/billing-access/from-account/${acc3.body.data.id}`);
check("that old won account is now linked", l3.body?.data?.linked === true, l3.body);
console.log(failures === 0 ? "All won-deal checks passed" : failures + " check(s) failed");
process.exit(failures ? 1 : 0);
