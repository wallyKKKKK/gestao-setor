"""Offline bridge for comparing the existing Python engines; no database access."""

import importlib.util
import json
from pathlib import Path
import statistics
import sys
import time

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parent.parent
ENGINES = {
    "python_script": ROOT / "scripts" / "reallocation-engine.py",
    "python_legacy_api": ROOT / "api" / "reallocation-suggestions.py",
}


def summarize(result):
    return {
        "stockRows": result["stockRows"],
        "productGroups": result["productGroups"],
        "suggestions": len(result["suggestions"]),
        "units": sum(row["quantity"] for row in result["suggestions"]),
        "allocations": [
            [row["ean"], row["originCode"], row["destinationCode"], row["quantity"]]
            for row in result["suggestions"]
        ],
    }


def main():
    request = json.load(sys.stdin)
    output = {}
    for engine_name, engine_path in ENGINES.items():
        spec = importlib.util.spec_from_file_location(engine_name, engine_path)
        engine = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(engine)
        jobs = []
        for job in request["jobs"]:
            payload = job["payload"]
            engine.calculate(payload)
            samples = []
            for _ in range(job.get("repetitions", 1)):
                started = time.perf_counter()
                result = engine.calculate(payload)
                samples.append((time.perf_counter() - started) * 1000)
            jobs.append({
                "id": job["id"],
                "medianMs": statistics.median(samples),
                "samplesMs": samples,
                "result": summarize(result) if job.get("summaryOnly") else result,
            })
        output[engine_name] = jobs
    json.dump(output, sys.stdout, ensure_ascii=True, allow_nan=False, separators=(",", ":"))


if __name__ == "__main__":
    main()
