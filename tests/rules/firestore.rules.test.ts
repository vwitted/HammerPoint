// Firestore security rules tests. Run with `npm run test:rules`, which starts the local
// Firestore emulator (requires Java). Nothing here talks to the real Firebase project.
import { after, afterEach, before, describe, it } from "node:test";
import { readFileSync } from "node:fs";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { deleteDoc, doc, getDoc, setDoc, updateDoc } from "firebase/firestore";

let env: RulesTestEnvironment;

const profile = (uid: string, role: string) => ({
  uid,
  email: `${uid}@example.com`,
  displayName: uid,
  role,
  createdAt: "2026-01-01T00:00:00.000Z",
});

const db = (uid: string | null) =>
  uid ? env.authenticatedContext(uid).firestore() : env.unauthenticatedContext().firestore();

// Writes documents directly, bypassing the rules, to set up each scenario.
const seed = (path: string, data: Record<string, unknown>) =>
  env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), path), data));

before(async () => {
  const [host, port] = (process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8080").split(":");
  env = await initializeTestEnvironment({
    projectId: "demo-hammerpoint",
    firestore: { rules: readFileSync("firestore.rules", "utf8"), host, port: Number(port) },
  });
});

afterEach(async () => {
  await env.clearFirestore();
});

after(async () => {
  await env.cleanup();
});

describe("user profiles: roles cannot be self-assigned", () => {
  it("lets a new user create their own profile as standard", async () => {
    await assertSucceeds(setDoc(doc(db("alice"), "users/alice"), profile("alice", "standard")));
  });

  it("blocks signing up as admin or pro", async () => {
    await assertFails(setDoc(doc(db("alice"), "users/alice"), profile("alice", "admin")));
    await assertFails(setDoc(doc(db("alice"), "users/alice"), profile("alice", "pro")));
  });

  it("blocks creating a profile for someone else", async () => {
    await assertFails(setDoc(doc(db("alice"), "users/bob"), profile("bob", "standard")));
  });

  it("lets an owner edit their profile details", async () => {
    await seed("users/alice", profile("alice", "standard"));
    await assertSucceeds(updateDoc(doc(db("alice"), "users/alice"), { displayName: "Alice B", company: "Acme" }));
  });

  it("blocks an owner from promoting themselves", async () => {
    await seed("users/alice", profile("alice", "standard"));
    await assertFails(updateDoc(doc(db("alice"), "users/alice"), { role: "admin" }));
    await assertFails(updateDoc(doc(db("alice"), "users/alice"), { role: "pro" }));
  });

  it("blocks sneaking a role change in alongside allowed fields", async () => {
    await seed("users/alice", profile("alice", "standard"));
    await assertFails(updateDoc(doc(db("alice"), "users/alice"), { displayName: "x", role: "admin" }));
  });

  it("blocks overwriting the whole profile with a new role", async () => {
    await seed("users/alice", profile("alice", "standard"));
    await assertFails(setDoc(doc(db("alice"), "users/alice"), profile("alice", "admin")));
  });

  it("lets an admin change another user's role", async () => {
    await seed("users/admin1", profile("admin1", "admin"));
    await seed("users/alice", profile("alice", "standard"));
    await assertSucceeds(updateDoc(doc(db("admin1"), "users/alice"), { role: "pro" }));
  });

  it("does not let a pro user change roles", async () => {
    await seed("users/pro1", profile("pro1", "pro"));
    await seed("users/alice", profile("alice", "standard"));
    await assertFails(updateDoc(doc(db("pro1"), "users/alice"), { role: "pro" }));
  });

  it("only lets admins delete profiles", async () => {
    await seed("users/admin1", profile("admin1", "admin"));
    await seed("users/alice", profile("alice", "standard"));
    await assertFails(deleteDoc(doc(db("alice"), "users/alice")));
    await assertSucceeds(deleteDoc(doc(db("admin1"), "users/alice")));
  });
});

describe("user profiles: privacy", () => {
  it("lets users read their own profile", async () => {
    await seed("users/alice", profile("alice", "standard"));
    await assertSucceeds(getDoc(doc(db("alice"), "users/alice")));
  });

  it("blocks users from reading other users' profiles", async () => {
    await seed("users/bob", profile("bob", "standard"));
    await assertFails(getDoc(doc(db("alice"), "users/bob")));
    await assertFails(getDoc(doc(db(null), "users/bob")));
  });

  it("lets admins read any profile", async () => {
    await seed("users/admin1", profile("admin1", "admin"));
    await seed("users/bob", profile("bob", "standard"));
    await assertSucceeds(getDoc(doc(db("admin1"), "users/bob")));
  });
});

describe("watchlists and search alerts", () => {
  for (const sub of ["watchlist", "searchAlerts"]) {
    it(`lets owners manage their own ${sub}`, async () => {
      const ref = doc(db("alice"), `users/alice/${sub}/item1`);
      await assertSucceeds(setDoc(ref, { title: "Lathe" }));
      await assertSucceeds(getDoc(ref));
      await assertSucceeds(deleteDoc(ref));
    });

    it(`blocks other users from ${sub}`, async () => {
      await seed(`users/bob/${sub}/item1`, { title: "Lathe" });
      await assertFails(getDoc(doc(db("alice"), `users/bob/${sub}/item1`)));
      await assertFails(setDoc(doc(db("alice"), `users/bob/${sub}/item2`), { title: "x" }));
    });
  }
});

describe("announcements", () => {
  const announcement = { title: "Hello", content: "World", type: "info", active: true, createdAt: "2026-01-01", createdBy: "x" };

  it("are readable by anyone", async () => {
    await seed("announcements/a1", announcement);
    await assertSucceeds(getDoc(doc(db(null), "announcements/a1")));
  });

  it("cannot be posted or deleted by regular users", async () => {
    await seed("users/alice", profile("alice", "standard"));
    await seed("announcements/a1", announcement);
    await assertFails(setDoc(doc(db("alice"), "announcements/a2"), announcement));
    await assertFails(deleteDoc(doc(db("alice"), "announcements/a1")));
    await assertFails(setDoc(doc(db(null), "announcements/a3"), announcement));
  });

  it("can be posted and deleted by admins", async () => {
    await seed("users/admin1", profile("admin1", "admin"));
    await assertSucceeds(setDoc(doc(db("admin1"), "announcements/a2"), announcement));
    await assertSucceeds(deleteDoc(doc(db("admin1"), "announcements/a2")));
  });
});
