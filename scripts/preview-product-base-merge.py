"""Compare two product exports with the catalog. This script never writes to Supabase."""

import argparse
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor
import csv
import json
from pathlib import Path
import re
import unicodedata
from urllib.parse import urlencode
from urllib.request import Request, urlopen

import openpyxl


def text(value):
    return " ".join(str(value if value is not None else "").split())


def normalized(value):
    return "".join(c for c in unicodedata.normalize("NFD", text(value).upper()) if not unicodedata.combining(c))


def valid_description(value):
    return any(c.isalpha() for c in value) and "\ufffd" not in value


def barcode(value):
    return value if re.fullmatch(r"[0-9]+", value) and value.strip("0") else ""


def attribute(value):
    if normalized(value) in {"", "VAZIO", "A DEFINIR", "SEM FAB", "SEM FABRICANTE", "0", "USO INTERNO"}:
        return ""
    return value if valid_description(value) else ""


def unique(values):
    distinct = {}
    for value in values:
        if value:
            distinct.setdefault(normalized(value), value)
    return list(distinct.values())


def database_connection():
    env = {}
    for line in Path(".env.local").read_text(encoding="utf-8-sig").splitlines():
        key, sep, value = line.partition("=")
        if sep and not key.startswith("#"):
            env[key.strip()] = value.strip().strip("\"'")
    url = env["NEXT_PUBLIC_SUPABASE_URL"].rstrip("/") + "/rest/v1/"
    secret = env["SUPABASE_SERVICE_ROLE_KEY"]
    headers = {"apikey": secret, "Authorization": f"Bearer {secret}"}
    return url, headers


def read_catalog(include_backup_fields=False):
    url, headers = database_connection()
    url += "reallocation_products"
    fields = "id,erp_code,ean,description,manufacturer,classification"
    if include_backup_fields:
        fields += ",search_text,source_file,imported_at,created_at,updated_at"
    bounds = [f"{prefix}0000000-0000-0000-0000-000000000000" for prefix in "048c"]

    def read_partition(index):
        current = bounds[index]
        result = []
        while True:
            params = [
                ("select", fields),
                ("order", "id.asc"), ("limit", "1000"),
                ("id", ("gt." if result else "gte.") + current),
            ]
            if index + 1 < len(bounds):
                params.append(("id", "lt." + bounds[index + 1]))
            with urlopen(Request(url + "?" + urlencode(params), headers=headers, method="GET"), timeout=30) as response:
                page = json.load(response)
            if not isinstance(page, list):
                raise ValueError("Resposta inesperada na consulta da base")
            result.extend(page)
            if len(page) < 1000:
                return result
            if page[-1]["id"] <= current:
                raise ValueError("Paginacao da base nao avancou")
            current = page[-1]["id"]

    with ThreadPoolExecutor(max_workers=len(bounds)) as executor:
        return [row for group in executor.map(read_partition, range(len(bounds))) for row in group]


def csv_rows(path):
    try:
        path.read_bytes().decode("utf-8-sig")
        encoding = "utf-8-sig"
    except UnicodeDecodeError:
        encoding = "cp1252"
    with path.open(encoding=encoding, newline="") as source:
        reader = csv.reader(source, delimiter=";")
        if [normalized(col) for col in next(reader)] != ["CODIGO PRODUTO", "DESCRICAO", "BARRA"]:
            raise ValueError("Cabecalho inesperado no CSV")
        for row in reader:
            if any(row):
                yield reader.line_num, [text(value) for value in row]


def excel_rows(path):
    book = openpyxl.load_workbook(path, read_only=True, data_only=True)
    try:
        sheet = book.worksheets[0]
        rows = sheet.iter_rows(values_only=True)
        if [normalized(col) for col in next(rows)] != ["COD. DE BARRAS", "PRODUTO", "FABRICANTE", "CLASSIFICACAO PRINCIPAL"]:
            raise ValueError("Cabecalho inesperado no Excel")
        for number, row in enumerate(rows, 2):
            if any(value is not None for value in row):
                yield number, [text(value) for value in row]
    finally:
        book.close()


def taxonomy(path):
    levels = [text(part) for part in path.split(">") if text(part) and normalized(part) != "PRINCIPAL"]
    if len(levels) >= 3:
        return levels[1], " > ".join(levels[2:])
    return "", levels[-1] if levels else ""


def field_key(field, value):
    if field == "classification":
        return tuple(normalized(part) for part in value.split(">") if text(part))
    return normalized(value)


def write_csv(path, header, rows):
    with path.open("w", encoding="utf-8-sig", newline="") as output:
        writer = csv.writer(output, delimiter=";")
        writer.writerow(header)
        # Prevent source text from being treated as spreadsheet formulas.
        writer.writerows(["'" + cell if isinstance(cell, str) and cell.startswith(("=", "+", "-", "@")) else cell for cell in row] for row in rows)


def preview(csv_path, excel_path, output, catalog):
    stats = Counter()
    issues = []
    pairs = defaultdict(list)
    csv_by_ean = defaultdict(set)
    xlsx_by_ean = defaultdict(list)
    db_by_pair = {}
    db_by_ean = defaultdict(set)
    db_by_code = defaultdict(set)
    ean_spellings = defaultdict(set)
    for row in catalog:
        code, ean = row["erp_code"], row["ean"]
        db_by_pair[(code, ean)] = row
        if barcode(ean):
            db_by_ean[ean].add(code)
            db_by_code[code].add(ean)
            ean_spellings[ean.lstrip("0")].add(ean)
    catalog_codes = {code for code, _ in db_by_pair}

    def issue(kind, code="", ean="", field="", source="", current="", line="", origin=""):
        stats[kind] += 1
        if not origin:
            origin = "CSV" if kind.startswith("CSV_") else "Excel" if kind.startswith("EXCEL_") else ""
        issues.append((kind, code, ean, field, source, current, origin, line))

    missing_barcodes = []
    for line, row in csv_rows(csv_path):
        stats["csv_rows"] += 1
        if len(row) != 3:
            issue("CSV_LINHA_INVALIDA", source=" | ".join(row), line=line)
            continue
        code, description, raw_ean = row
        if not re.fullmatch(r"[A-Za-z0-9]+", code):
            issue("CSV_CODIGO_INVALIDO", code, raw_ean, source=description, line=line)
            continue
        if not raw_ean:
            missing_barcodes.append((line, code, description))
            continue
        ean = barcode(raw_ean)
        if not ean:
            issue("CSV_BARRA_INVALIDA", code, raw_ean, source=description, line=line)
            continue
        if (code, ean) in pairs:
            stats["csv_repeated_pairs"] += 1
        pairs[(code, ean)].append((line, description))
        csv_by_ean[ean].add(code)
        ean_spellings[ean.lstrip("0")].add(ean)

    csv_barcodes_per_code = Counter(code for code, _ in pairs)
    csv_codes_with_barcodes = set(csv_barcodes_per_code)
    for line, code, description in missing_barcodes:
        if code in csv_codes_with_barcodes:
            stats["csv_blank_ean_with_other_pair"] += 1
            continue
        existing_eans = db_by_code[code]
        if len(existing_eans) == 1:
            ean = next(iter(existing_eans))
            existing = db_by_pair[(code, ean)]
            if valid_description(description) and normalized(description) == normalized(existing["description"]):
                pairs[(code, ean)].append((line, description))
                stats["csv_ean_reused_by_code"] += 1
                continue
        issue("CSV_SEM_BARRA_CONFIRMADA", code, source=description, current=" | ".join(sorted(existing_eans)), line=line)

    for line, row in excel_rows(excel_path):
        stats["xlsx_rows"] += 1
        raw_ean, description, manufacturer, classification = row
        ean = barcode(raw_ean)
        if not ean:
            issue("EXCEL_SEM_BARRA_VALIDA", ean=raw_ean, source=description, line=line)
            continue
        xlsx_by_ean[ean].append((line, description, attribute(manufacturer), attribute(classification)))

    source_pairs = len(pairs)
    for ean, entries in xlsx_by_ean.items():
        if ean in csv_by_ean:
            continue
        codes = db_by_ean[ean]
        if len(codes) == 1:
            code = next(iter(codes))
            pairs.setdefault((code, ean), [])
        else:
            issue("EXCEL_SEM_CODIGO_ERP_UNICO", ean=ean, source=entries[0][1], current=" | ".join(sorted(codes)), line=entries[0][0])

    fields = ("description", "manufacturer", "classification")
    candidates = []
    changes = []
    proposed_pairs = set()
    complete_codes = set()
    changes_by_code = set()
    for (code, ean), csv_items in sorted(pairs.items()):
        db = db_by_pair.get((code, ean))
        entries = xlsx_by_ean.get(ean, [])
        line = csv_items[0][0] if csv_items else (entries[0][0] if entries else "")
        origin = "CSV" if csv_items else "Excel"
        descriptions = unique(value for _, value in csv_items if valid_description(value))
        if csv_items and not descriptions:
            issue("CSV_DESCRICAO_INVALIDA", code, ean, source=csv_items[0][1], line=line)
        if len(descriptions) > 1:
            issue("CSV_DESCRICOES_CONFLITANTES", code, ean, source=" | ".join(descriptions), line=line)
            continue
        codes = csv_by_ean[ean] | db_by_ean[ean] | {code}
        if len(codes) > 1:
            issue("BARRA_LIGADA_A_OUTRO_ERP", code, ean, current=" | ".join(sorted(codes)), line=line, origin=origin)
            continue
        other_spellings = ean_spellings[ean.lstrip("0")] - {ean}
        if other_spellings and not db:
            issue("BARRA_VARIANTE_ZEROS", code, ean, current=" | ".join(sorted(other_spellings)), line=line, origin=origin)
            continue
        if csv_items and not descriptions:
            continue
        description = descriptions[0] if descriptions else text(db["description"])
        if not valid_description(description):
            issue("SEM_DESCRICAO_CONFIRMADA", code, ean, source=description, line=line, origin=origin)
            continue

        excel_description = unique(entry[1] for entry in entries if valid_description(entry[1]))
        manufacturer = unique(entry[2] for entry in entries)
        classification = unique(entry[3] for entry in entries)
        if len(excel_description) > 1 or (excel_description and normalized(excel_description[0]) != normalized(description)):
            kind = "DESCRICOES_DIFERENTES_ENTRE_ARQUIVOS_A7" if descriptions else "EXCEL_SEM_CORROBORACAO_DA_DESCRICAO"
            issue(kind, code, ean, "description", " | ".join(excel_description), description, entries[0][0], "Excel")
            continue
        elif entries:
            stats["xlsx_links_verified"] += 1
        incoming = {"description": description}
        for key, values in (("manufacturer", manufacturer), ("classification", classification)):
            if len(values) > 1:
                issue("EXCEL_ATRIBUTO_CONFLITANTE", code, ean, key, " | ".join(values), line=entries[0][0])
            incoming[key] = values[0] if len(values) == 1 else ""

        resolved = {}
        filled = []
        replaced = []
        for field in fields:
            old = (db[field] or "") if db else ""
            current_valid = valid_description(old) if field == "description" else bool(attribute(old))
            new = incoming[field]
            if not new or field_key(field, old) == field_key(field, new):
                resolved[field] = old
                continue
            resolved[field] = new
            target = replaced if current_valid else filled
            target.append(field)
            if current_valid:
                stats[f"replace_{field}"] += 1
                source_line, source_origin = (entries[0][0], "Excel") if field != "description" and entries else (line, origin)
                changes.append((code, ean, field, old, new, source_origin, source_line))
        department, category = taxonomy(attribute(resolved["classification"]))
        if not db or filled or replaced:
            proposed_pairs.add((code, ean))
            changes_by_code.add(code)
            stats["update" if db else "insert"] += 1
            for field in filled:
                stats[f"{'fill' if db else 'insert'}_{field}"] += 1
            if all((attribute(resolved["manufacturer"]), department, category, attribute(resolved["classification"]))):
                stats["proposed_complete_rows"] += 1
                complete_codes.add(code)
            if len(ean) < 8:
                stats["proposed_short_barcodes"] += 1
            if not db:
                stats["new_pair_existing_code" if code in catalog_codes else "new_pair_new_code"] += 1
                if db_by_code[code]:
                    stats["new_pair_preserves_other_barcodes"] += 1
                action = "Novo vinculo"
            elif replaced and filled:
                action = "Atualizar e completar"
            else:
                action = "Atualizar" if replaced else "Completar"
            stats[action] += 1
            candidates.append((action, code, ean, resolved["description"],
                               resolved["manufacturer"], department, category, resolved["classification"], ", ".join(filled), ", ".join(replaced)))
        else:
            stats["unchanged"] += 1

    stats.update({
        "catalog_rows": len(catalog), "catalog_codes": len(catalog_codes),
        "source_pairs": source_pairs, "pairs_checked": len(pairs), "proposed_codes": len(changes_by_code),
        "proposed_complete_codes": len(complete_codes), "issue_rows": len(issues),
        "issue_pairs": len({(code, ean) for _, code, ean, _, _, _, _, _ in issues if code and ean}),
        "conflicting_barcodes": len({ean for kind, _, ean, *_ in issues if kind == "BARRA_LIGADA_A_OUTRO_ERP"}),
        "codes_with_multiple_barcodes_in_csv": sum(count > 1 for count in csv_barcodes_per_code.values()),
        "replacement_fields": len(changes),
    })
    assert len(candidates) == len(proposed_pairs) == stats["update"] + stats["insert"]
    assert all(code and barcode(ean) and valid_description(description) for _, code, ean, description, *_ in candidates)
    assert all(len(csv_by_ean[ean] | db_by_ean[ean] | {code}) == 1 for code, ean in proposed_pairs)
    output.mkdir(parents=True, exist_ok=True)
    write_csv(output / "previa-atualizacao-produtos.csv",
              ["Acao", "Codigo ERP", "EAN ou barra", "Descricao", "Fabricante", "Departamento", "Categoria", "Classificacao completa", "Campos preenchidos", "Campos atualizados"], candidates)
    write_csv(output / "alteracoes-a7-antes-e-depois.csv",
              ["Codigo ERP", "EAN ou barra", "Campo", "Valor atual", "Novo valor do A7", "Arquivo", "Linha na origem"], changes)
    write_csv(output / "pendencias-atualizacao-produtos.csv",
              ["Motivo", "Codigo ERP", "EAN ou barra", "Campo", "Valor de origem", "Valor atual ou codigos", "Arquivo", "Linha na origem"], issues)
    print(json.dumps(stats, indent=2, sort_keys=True))
    return candidates


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("csv_path", type=Path)
    parser.add_argument("excel_path", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    preview(args.csv_path, args.excel_path, args.output, read_catalog())
