/* global Buffer, console, process */

import { cp, mkdir, readFile, rename, stat } from "node:fs/promises";
import { join, resolve } from "node:path";

const RELEASE = "manhattan-citywide-20260804";

function parseArgs(argv) {
  const output = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--") continue;
    if (!token?.startsWith("--")) continue;
    const equals = token.indexOf("=");
    if (equals > 2) output[token.slice(2, equals)] = token.slice(equals + 1);
    else { output[token.slice(2)] = argv[index + 1]; index += 1; }
  }
  return output;
}

async function exists(path) { try { await stat(path); return true; } catch (error) { if (error?.code === "ENOENT") return false; throw error; } }

async function run() {
  const values = parseArgs(process.argv.slice(2));
  const validatedRoot = resolve(String(values["validated-root"] ?? `data/generated/catalog/${RELEASE}-replay-a`));
  const outputRoot = resolve(String(values["output-root"] ?? `public/data/${RELEASE}`));
  if (await exists(outputRoot)) throw new Error(`Refusing to overwrite existing local citywide release: ${outputRoot}`);
  const manifestText = await readFile(join(validatedRoot, "manifest.json"), "utf8");
  const manifest = JSON.parse(manifestText);
  if (manifest.releaseId !== RELEASE || manifest.fixtureOnly !== false) throw new Error("Validated citywide release identity is invalid.");
  const stageRoot = `${outputRoot}.staging-${process.pid}-${Date.now()}`;
  await mkdir(resolve(outputRoot, ".."), { recursive: true });
  try {
    await cp(validatedRoot, stageRoot, { recursive: true, force: false, errorOnExist: true });
    await rename(stageRoot, outputRoot);
    console.log(JSON.stringify({ outputRoot, releaseId: manifest.releaseId, bytes: Buffer.byteLength(manifestText), publishedFiles: Object.keys(manifest.publishedFiles ?? {}).length }, null, 2));
  } catch (error) {
    const quarantinePath = resolve(`data/generated/citywide-recovery-quarantine/manhattan-citywide-20260804-cp4-publish-failed-${Date.now()}`);
    try {
      if (await exists(stageRoot)) {
        await mkdir(quarantinePath, { recursive: false, mode: 0o700 });
        await rename(stageRoot, quarantinePath);
        console.error(`Citywide local publish stage quarantined at ${quarantinePath}`);
      }
    } catch (quarantineError) {
      console.error(`Citywide local publish stage quarantine failed: ${quarantineError instanceof Error ? quarantineError.message : String(quarantineError)}`);
    }
    throw error;
  }
}

run().catch((error) => { console.error(error instanceof Error ? error.stack ?? error.message : String(error)); process.exitCode = 1; });
