#!/usr/bin/env node
// Deploys SomniAI (prompt 7.4, DEPLOY.md): the web app to Vercel, the AI Brain
// to Render from its Dockerfile, each in a staging and a production copy,
// both on MongoDB Atlas. No Git integration on either host: the public
// repository must not gain deployment links that name anyone (CLAUDE.md, rule 1).
//
//   node scripts/deploy.mjs setup  <staging|production>   create or update both services and their settings
//   node scripts/deploy.mjs brain  <staging|production>   deploy the AI Brain at the pushed commit
//   node scripts/deploy.mjs app    <staging|production>   deploy the web app from this working tree
//   node scripts/deploy.mjs check  <staging|production>   both healthy?
//   node scripts/deploy.mjs all    <staging|production>   setup, brain, app, check
//
// Reads .env.deploy.local (your tokens, the Atlas strings, the operator's
// details) and .env.local (the Google, Firebase and Twilio keys, reused).
// Secrets it makes (NEXTAUTH_SECRET, CRON_SECRET, AI_BRAIN_TOKEN and the
// staging test key) are made once per environment and kept in
// .env.deploy.local. It prints names, addresses and states, never a value.
// What isn't secret (addresses, ids) goes to deploy/environments.json.

import { execFileSync, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const VERCEL_CLI = "vercel@65.7.0";
const DEPLOY_FILE = ".env.deploy.local";
const STATE_FILE = "deploy/environments.json";

export const ENVIRONMENTS = {
  staging: { vercelProject: "somniai-staging", renderService: "somniai-brain-staging", renderPlan: "free", atlas: "ATLAS_STAGING_URI", prefix: "STAGING" },
  production: { vercelProject: "somniai", renderService: "somniai-brain", renderPlan: "starter", atlas: "ATLAS_PRODUCTION_URI", prefix: "PRODUCTION" },
};

/** KEY=value lines; values may be quoted; comments and blanks skipped. */
export function parseEnv(text) {
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) {
      out[m[1]] = m[2].trim().replace(/^"(.*)"$/s, "$1").replace(/^'(.*)'$/s, "$1");
    }
  }
  return out;
}

const readEnv = (file) => (existsSync(file) ? parseEnv(readFileSync(file, "utf8")) : {});

/** The secrets an environment needs that SomniAI makes itself: made once, kept in .env.deploy.local. */
export function ensureSecrets(env, prefix, make = () => randomBytes(32).toString("hex")) {
  // Staging also gets TEST_KEY: kept as STAGING_TEST_KEY, the app's own name for it.
  const names = ["NEXTAUTH_SECRET", "CRON_SECRET", "AI_BRAIN_TOKEN", ...(prefix === "STAGING" ? ["TEST_KEY"] : [])];
  const added = [];
  for (const n of names) {
    const key = `${prefix}_${n}`;
    if (!env[key]) {
      env[key] = make();
      added.push(key);
    }
  }
  return added;
}

/**
 * Every variable the web app gets in an environment (names are the app's).
 * The operator's details only in production: staging's legal pages say they aren't set.
 */
export function appEnv(name, deploy, local, urls) {
  const e = ENVIRONMENTS[name];
  const p = e.prefix;
  const vars = {
    SOMNIAI_ENV: name,
    MONGO_DB_URI: deploy[e.atlas],
    NEXTAUTH_URL: urls.app,
    NEXTAUTH_SECRET: deploy[`${p}_NEXTAUTH_SECRET`],
    CRON_SECRET: deploy[`${p}_CRON_SECRET`],
    AI_BRAIN_URL: urls.brain,
    AI_BRAIN_TOKEN: deploy[`${p}_AI_BRAIN_TOKEN`],
    // Reused from .env.local. Google sign-in stays off until its redirect addresses are registered (DEPLOY.md).
    GOOGLE_CLIENT_ID: local.GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: local.GOOGLE_CLIENT_SECRET,
    NEXT_PUBLIC_GOOGLE_ENABLED: deploy[`${p}_GOOGLE_ENABLED`] === "true" ? "true" : "false",
    FIREBASE_PROJECT_ID: local.FIREBASE_PROJECT_ID,
    FIREBASE_CLIENT_EMAIL: local.FIREBASE_CLIENT_EMAIL,
    FIREBASE_PRIVATE_KEY: local.FIREBASE_PRIVATE_KEY,
    TWILIO_ACCOUNT_SID: local.TWILIO_ACCOUNT_SID,
    TWILIO_AUTH_TOKEN: local.TWILIO_AUTH_TOKEN,
    TWILIO_FROM: local.TWILIO_FROM,
    OPS_ALERT_WEBHOOK: deploy.OPS_ALERT_WEBHOOK,
    OPS_ALERT_FORMAT: deploy.OPS_ALERT_FORMAT,
  };
  if (name === "staging") {
    vars.STAGING_TEST_KEY = deploy.STAGING_TEST_KEY;
  }
  if (name === "production") {
    vars.SOMNIAI_OPERATOR = deploy.SOMNIAI_OPERATOR;
    vars.SOMNIAI_CONTACT = deploy.SOMNIAI_CONTACT;
    vars.SOMNIAI_JURISDICTION = deploy.SOMNIAI_JURISDICTION;
    vars.SOMNIAI_HOSTING = "the web app on Vercel (Mumbai), the prediction service on Render (Singapore), and the database on MongoDB Atlas (AWS Mumbai)";
    vars.SOMNIAI_BACKUPS = "The database plan SomniAI uses keeps no backups, so deleted data is gone from everywhere at once.";
  }
  return Object.fromEntries(Object.entries(vars).filter(([, v]) => v !== undefined && v !== ""));
}

/** The address the Android app is built against: production's, and only over HTTPS (7.4). */
export function androidServerUrl(state) {
  const url = state?.production?.app;
  if (!url) {
    throw new Error("production isn't deployed yet: no address in deploy/environments.json");
  }
  if (!url.startsWith("https://")) {
    throw new Error(`production's address must be https, not ${url}`);
  }
  return url;
}

export function readState(file = STATE_FILE) {
  return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
}

// --- the hosts' APIs -------------------------------------------------------

async function api(base, token, method, path, body) {
  const res = await fetch(base + path, {
    method,
    headers: { authorization: `Bearer ${token}`, accept: "application/json", ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  }
  catch {
    // Not JSON: kept as text for the error.
  }
  return { status: res.status, json, text };
}

function fail(what, r) {
  // An API's error message, never a request (which could hold a value).
  const msg = r.json?.error?.message ?? r.json?.message ?? r.text.slice(0, 200);
  throw new Error(`${what}: HTTP ${r.status}: ${msg}`);
}

const vercel = (deploy) => (method, path, body) => api("https://api.vercel.com", deploy.VERCEL_TOKEN, method, path, body);
const render = (deploy) => (method, path, body) => api("https://api.render.com/v1", deploy.RENDER_API_KEY, method, path, body);

async function vercelTeam(v) {
  const r = await v("GET", "/v2/teams");
  if (r.status !== 200 || !r.json?.teams?.length) {
    fail("Vercel teams", r);
  }
  return r.json.teams[0];
}

async function vercelProject(v, team, name) {
  const got = await v("GET", `/v9/projects/${name}?teamId=${team.id}`);
  if (got.status === 200) {
    return got.json;
  }
  const made = await v("POST", `/v11/projects?teamId=${team.id}`, { name, framework: "nextjs" });
  if (made.status !== 200) {
    fail(`create Vercel project ${name}`, made);
  }
  return made.json;
}

async function vercelProductionDomain(v, team, project) {
  const r = await v("GET", `/v9/projects/${project.id}/domains?teamId=${team.id}`);
  if (r.status !== 200) {
    fail("Vercel domains", r);
  }
  const vercelApp = (r.json.domains ?? []).map((d) => d.name).filter((n) => n.endsWith(".vercel.app"));
  // The project's own name.vercel.app if it got it, else the shortest one it has.
  return vercelApp.sort((a, b) => a.length - b.length)[0] ?? `${project.name}.vercel.app`;
}

async function setVercelEnv(v, team, project, vars) {
  const list = Object.entries(vars).map(([key, value]) => ({ key, value, type: key.startsWith("NEXT_PUBLIC_") ? "plain" : "encrypted", target: ["production"] }));
  const r = await v("POST", `/v10/projects/${project.id}/env?upsert=true&teamId=${team.id}`, list);
  if (r.status !== 200 && r.status !== 201) {
    fail("set Vercel environment variables", r);
  }
}

async function renderOwner(r) {
  const res = await r("GET", "/owners?limit=20");
  if (res.status !== 200 || !res.json?.length) {
    fail("Render owners", res);
  }
  return res.json[0].owner;
}

async function renderService(r, owner, name) {
  const res = await r("GET", `/services?name=${encodeURIComponent(name)}&ownerId=${owner.id}&limit=20`);
  if (res.status !== 200) {
    fail("Render services", res);
  }
  return res.json.map((x) => x.service).find((s) => s.name === name) ?? null;
}

function repoUrl() {
  return execFileSync("git", ["remote", "get-url", "origin"], { encoding: "utf8" }).trim().replace(/\.git$/, "");
}

const head = () => execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();

// --- steps -----------------------------------------------------------------

function loadState() {
  return readState();
}

function saveState(state) {
  mkdirSync("deploy", { recursive: true });
  writeFileSync(STATE_FILE, `${JSON.stringify(state, null, 2)}\n`);
}

function saveDeployFile(env, added) {
  if (added.length === 0) {
    return;
  }
  const text = readFileSync(DEPLOY_FILE, "utf8").replace(/\s*$/, "\n");
  const lines = added.map((k) => `${k}=${env[k]}`).join("\n");
  writeFileSync(DEPLOY_FILE, `${text}# Made by scripts/deploy.mjs; keep.\n${lines}\n`);
  console.log(`  made and saved in ${DEPLOY_FILE}: ${added.join(", ")}`);
}

async function setup(name) {
  const e = ENVIRONMENTS[name];
  const deploy = readEnv(DEPLOY_FILE);
  const local = readEnv(".env.local");
  for (const need of ["VERCEL_TOKEN", "RENDER_API_KEY", e.atlas]) {
    if (!deploy[need]) {
      throw new Error(`${need} is missing from ${DEPLOY_FILE}`);
    }
  }
  saveDeployFile(deploy, ensureSecrets(deploy, e.prefix));
  const state = loadState();

  // The AI Brain on Render, from the public repository's ai-brain/Dockerfile, never auto-deployed.
  const r = render(deploy);
  const owner = await renderOwner(r);
  let service = await renderService(r, owner, e.renderService);
  const brainEnv = [{ key: "AI_BRAIN_TOKEN", value: deploy[`${e.prefix}_AI_BRAIN_TOKEN`] }];
  if (!service) {
    const made = await r("POST", "/services", {
      type: "web_service",
      name: e.renderService,
      ownerId: owner.id,
      repo: repoUrl(),
      branch: "develop",
      rootDir: "ai-brain",
      autoDeploy: "no",
      envVars: brainEnv,
      serviceDetails: {
        runtime: "docker",
        plan: e.renderPlan,
        region: "singapore",
        healthCheckPath: "/health",
        envSpecificDetails: { dockerfilePath: "./Dockerfile", dockerContext: "." },
      },
    });
    if (made.status !== 201 && made.status !== 200) {
      fail(`create Render service ${e.renderService}`, made);
    }
    service = made.json.service ?? made.json;
    console.log(`  Render: created ${e.renderService} (${e.renderPlan}, Singapore)`);
  }
  else {
    const put = await r("PUT", `/services/${service.id}/env-vars`, brainEnv);
    if (put.status !== 200) {
      fail("set Render environment variables", put);
    }
    console.log(`  Render: ${e.renderService} exists; its key is set`);
  }
  const brainUrl = service.serviceDetails?.url ?? `https://${e.renderService}.onrender.com`;

  // The web app on Vercel.
  const v = vercel(deploy);
  const team = await vercelTeam(v);
  const project = await vercelProject(v, team, e.vercelProject);
  const domain = await vercelProductionDomain(v, team, project);
  const urls = { app: `https://${domain}`, brain: brainUrl };
  const vars = appEnv(name, deploy, local, urls);
  await setVercelEnv(v, team, project, vars);
  console.log(`  Vercel: ${e.vercelProject} (${urls.app}); ${Object.keys(vars).length} variables set: ${Object.keys(vars).sort().join(", ")}`);

  state[name] = { app: urls.app, brain: urls.brain, vercelProject: e.vercelProject, vercelProjectId: project.id, vercelTeamId: team.id, renderServiceId: service.id };
  saveState(state);
  return state[name];
}

async function waitForRenderDeploy(r, serviceId, deployId) {
  for (let i = 0; i < 120; i++) {
    const d = await r("GET", `/services/${serviceId}/deploys/${deployId}`);
    const status = d.json?.status;
    if (status === "live") {
      return;
    }
    if (["build_failed", "update_failed", "canceled", "pre_deploy_failed", "deactivated"].includes(status)) {
      throw new Error(`Render deploy ${deployId} ended ${status}; see its log on render.com`);
    }
    await new Promise((res) => setTimeout(res, 10_000));
  }
  throw new Error("Render deploy didn't finish in 20 minutes");
}

async function brain(name) {
  const deploy = readEnv(DEPLOY_FILE);
  const s = loadState()[name];
  if (!s) {
    throw new Error(`run setup ${name} first`);
  }
  const commit = head();
  const pushed = execFileSync("git", ["branch", "-r", "--contains", commit], { encoding: "utf8" });
  if (!pushed.trim()) {
    throw new Error(`commit ${commit.slice(0, 7)} isn't on GitHub yet: Render builds from the repository, so push first`);
  }
  const r = render(deploy);
  const d = await r("POST", `/services/${s.renderServiceId}/deploys`, { commitId: commit, clearCache: "do_not_clear" });
  if (d.status !== 201 && d.status !== 200) {
    fail("start Render deploy", d);
  }
  console.log(`  Render: deploying ${commit.slice(0, 7)} to ${ENVIRONMENTS[name].renderService}…`);
  await waitForRenderDeploy(r, s.renderServiceId, d.json.id);
  console.log("  Render: live");
}

function app(name) {
  const deploy = readEnv(DEPLOY_FILE);
  const s = loadState()[name];
  if (!s) {
    throw new Error(`run setup ${name} first`);
  }
  // Link this folder to the environment's project for the CLI, then deploy the working tree.
  mkdirSync(".vercel", { recursive: true });
  writeFileSync(".vercel/project.json", JSON.stringify({ orgId: s.vercelTeamId, projectId: s.vercelProjectId }));
  const commit = head();
  const dirty = spawnSync("git", ["status", "--porcelain"], { encoding: "utf8" }).stdout.trim() !== "";
  console.log(`  Vercel: deploying ${commit.slice(0, 7)}${dirty ? " (with uncommitted changes)" : ""} to ${s.vercelProject}…`);
  const res = spawnSync("npx", ["--yes", VERCEL_CLI, "deploy", "--prod", "--yes", "--token", deploy.VERCEL_TOKEN,
    "--scope", s.vercelTeamId, "--env", `SOMNIAI_COMMIT=${commit.slice(0, 7)}${dirty ? "-dirty" : ""}`], {
    stdio: ["ignore", "pipe", "pipe"], encoding: "utf8", shell: process.platform === "win32",
  });
  // The CLI prints the deployment's address and its build; never the token.
  const out = `${res.stdout ?? ""}${res.stderr ?? ""}`.split(deploy.VERCEL_TOKEN).join("***");
  if (res.status !== 0) {
    console.log(out.split("\n").slice(-40).join("\n"));
    throw new Error("Vercel deploy failed");
  }
  console.log(`  Vercel: live at ${s.app}`);
}

export async function check(name, fetchFn = fetch) {
  const s = loadState()[name];
  if (!s) {
    throw new Error(`run setup ${name} first`);
  }
  const problems = [];
  const brainRes = await fetchFn(`${s.brain}/health`, { signal: AbortSignal.timeout(90_000) }).catch((e) => ({ ok: false, status: e.message }));
  const brainBody = brainRes.ok ? await brainRes.json() : null;
  console.log(`  AI Brain ${s.brain}/health: ${brainRes.status}${brainBody ? `, models loaded: ${brainBody.modelsLoaded}` : ""}`);
  if (!brainBody?.modelsLoaded) {
    problems.push("the AI Brain isn't answering with its models loaded");
  }
  const appRes = await fetchFn(`${s.app}/api/health`, { signal: AbortSignal.timeout(60_000) }).catch((e) => ({ ok: false, status: e.message }));
  const appBody = appRes.ok ? await appRes.json() : null;
  console.log(`  app ${s.app}/api/health: ${appRes.status}${appBody ? ` ${JSON.stringify(appBody)}` : ""}`);
  if (!appBody?.ok || appBody.database !== "up") {
    problems.push("the app can't reach its database");
  }
  if (appBody && appBody.aiBrain !== "up") {
    problems.push(`the app sees the AI Brain as ${appBody.aiBrain}`);
  }
  if (appBody && appBody.environment !== name) {
    problems.push(`the app says it is ${appBody.environment}, not ${name}`);
  }
  console.log(problems.length ? `  NOT HEALTHY: ${problems.join("; ")}` : `  ${name}: healthy`);
  return problems.length === 0;
}

async function main() {
  const [step, name] = process.argv.slice(2);
  if (!["setup", "brain", "app", "check", "all"].includes(step) || !ENVIRONMENTS[name]) {
    console.error("usage: node scripts/deploy.mjs <setup|brain|app|check|all> <staging|production>");
    process.exit(2);
  }
  console.log(`${step} ${name}`);
  if (step === "setup" || step === "all") {
    await setup(name);
  }
  if (step === "brain" || step === "all") {
    await brain(name);
  }
  if (step === "app" || step === "all") {
    app(name);
  }
  if (step === "check" || step === "all") {
    process.exit((await check(name)) ? 0 : 1);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => {
    console.error(`deploy: ${e.message}`);
    process.exit(1);
  });
}
