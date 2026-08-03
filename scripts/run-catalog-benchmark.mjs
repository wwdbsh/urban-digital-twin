/* global console, process */
import { runSyntheticCatalogBenchmark } from "../src/release/benchmark.ts";

const argv = process.argv.slice(2); const index = argv.indexOf("--records"); const records = index >= 0 ? Number(argv[index + 1]) : 2_000;
if (!Number.isInteger(records) || records < 1 || records > 10_000) throw new Error("--records must be an integer between 1 and 10,000.");
console.log(JSON.stringify(runSyntheticCatalogBenchmark(records), null, 2));
