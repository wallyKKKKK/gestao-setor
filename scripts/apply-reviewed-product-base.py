"""Apply only the previously reviewed A7 catalog batch, using its temporary RPC."""

import argparse
from hashlib import sha256
import json
from pathlib import Path
import runpy
from tempfile import TemporaryDirectory
from urllib.error import HTTPError
from urllib.request import Request, urlopen

helpers = runpy.run_path(str(Path(__file__).with_name("preview-product-base-merge.py")))
read_catalog = helpers["read_catalog"]

EXPECTED_UPDATES = 11210
EXPECTED_INSERTS = 257
REVIEW_FILES = (
    "previa-atualizacao-produtos.csv",
    "alteracoes-a7-antes-e-depois.csv",
    "pendencias-atualizacao-produtos.csv",
)
FUNCTION = "apply_a7_product_catalog_20261110"


def digest(path):
    return sha256(path.read_bytes()).hexdigest()


def prepare(csv_path, excel_path, approved, work):
    current = read_catalog(include_backup_fields=True)
    by_pair = {(row["erp_code"], row["ean"]): row for row in current}
    with TemporaryDirectory() as tmp:
        proposals = helpers["preview"](csv_path, excel_path, Path(tmp), current)
        signatures = {name: digest(approved / name) for name in REVIEW_FILES}
        if any(digest(Path(tmp) / name) != expected for name, expected in signatures.items()):
            raise SystemExit("A base ou as fontes mudaram e a previa nao coincide. Nenhuma gravacao executada.")

    rows = []
    previous_rows = []
    inserts = []
    for action, code, ean, description, manufacturer, _, _, classification, _, _ in proposals:
        old = by_pair.get((code, ean))
        if (action == "Novo vinculo") != (old is None):
            raise ValueError("Operacao inconsistente com o cadastro")
        if old:
            previous_rows.append(old)
        else:
            inserts.append([code, ean])
        rows.append({
            "erp_code": code, "ean": ean,
            "description": description, "manufacturer": manufacturer, "classification": classification,
            "search_text": helpers["normalized"](" ".join((code, ean, description, manufacturer, classification))),
            "expected_id": old["id"] if old else None,
            "expected_updated_at": old["updated_at"] if old else None,
        })
    if (len(previous_rows), len(inserts)) != (EXPECTED_UPDATES, EXPECTED_INSERTS):
        raise SystemExit("A quantidade da proposta nao coincide com a aprovada.")
    source_file = csv_path.name + " + " + excel_path.name
    work.mkdir(parents=True, exist_ok=True)
    batch = {"source_file": source_file, "rows": rows}
    backup = {"source_file": source_file, "approved_hashes": signatures, "previous_rows": previous_rows,
              "new_pairs": inserts, "catalog_rows_before": len(current)}
    (work / "backup-antes-da-atualizacao.json").write_text(json.dumps(backup, ensure_ascii=False), encoding="utf-8")
    (work / "lote-verificado.json").write_text(json.dumps(batch, ensure_ascii=False), encoding="utf-8")
    print(json.dumps({"ready": len(rows), "backup": len(previous_rows), "inserts": len(inserts)}))


def rpc(work, apply):
    batch = json.loads((work / "lote-verificado.json").read_text(encoding="utf-8"))
    url, headers = helpers["database_connection"]()
    payload = json.dumps({"p_rows": batch["rows"], "p_apply": apply}, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    try:
        with urlopen(Request(url + "rpc/" + FUNCTION, data=payload,
                             headers={**headers, "Content-Type": "application/json"}, method="POST"), timeout=120) as response:
            receipt = json.load(response)
    except HTTPError as error:
        raise SystemExit(f"HTTP {error.code}: {error.read().decode('utf-8', errors='replace')}") from error
    if (receipt.get("updated"), receipt.get("inserted"), receipt.get("applied")) != (EXPECTED_UPDATES, EXPECTED_INSERTS, apply):
        raise SystemExit("O retorno do banco nao coincide com o lote esperado. Verifique antes de repetir.")
    if apply:
        (work / "recibo-atualizacao.json").write_text(json.dumps(receipt, indent=2), encoding="utf-8")
    print(json.dumps(receipt))


def verify(work):
    batch = json.loads((work / "lote-verificado.json").read_text(encoding="utf-8"))
    current = read_catalog()
    by_pair = {(row["erp_code"], row["ean"]): row for row in current}
    for expected in batch["rows"]:
        found = by_pair.get((expected["erp_code"], expected["ean"]))
        if not found or any(found[field] != expected[field] for field in ("description", "manufacturer", "classification")):
            raise SystemExit("A verificacao independente encontrou um registro divergente.")
        if expected["expected_id"] and found["id"] != expected["expected_id"]:
            raise SystemExit("O identificador de um registro existente mudou.")
    print(json.dumps({"verified": len(batch["rows"]), "catalog_after": len(current)}))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("phase", choices=("prepare", "preflight", "apply", "verify"))
    parser.add_argument("work", type=Path)
    parser.add_argument("approved", nargs="?", type=Path)
    parser.add_argument("csv_path", nargs="?", type=Path)
    parser.add_argument("excel_path", nargs="?", type=Path)
    args = parser.parse_args()
    if args.phase == "prepare":
        prepare(args.csv_path, args.excel_path, args.approved, args.work)
    elif args.phase == "verify":
        verify(args.work)
    else:
        rpc(args.work, args.phase == "apply")
