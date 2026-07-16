import json
import math
import sys
import re
import unicodedata


ROMAN_STORE_SUFFIXES = {"I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"}


def number(value):
    try:
        return float(value or 0)
    except (TypeError, ValueError):
        return 0.0


def store_code(value):
    return str(value or "").zfill(2)


def branch_can_send(code, branch_logistics):
    return (branch_logistics.get(store_code(code)) or {}).get("sendsStock") is not False


def branch_can_receive(code, branch_logistics):
    return (branch_logistics.get(store_code(code)) or {}).get("receivesStock") is not False


def stock_curve(value):
    return str(value or "").strip().upper()[:1]


def stock_curve_rank(value):
    return {"A": 1, "B": 2, "C": 3, "D": 4, "E": 5}.get(stock_curve(value), 0)


def normalize_route_text(value):
    text = unicodedata.normalize("NFD", str(value or ""))
    text = "".join(char for char in text if unicodedata.category(char) != "Mn")
    return re.sub(r"[^A-Za-z0-9]+", " ", text).strip().upper()


def inferred_store_area(item):
    parts = [part for part in normalize_route_text(item.get("store_name")).split(" ") if part]
    while len(parts) > 1:
        last = parts[-1]
        if not last.isdigit() and last not in ROMAN_STORE_SUFFIXES:
            break
        parts.pop()
    return " ".join(parts)


def available_stock(item):
    return max(0, number(item.get("stock")), number(item.get("confirmed_stock")))


def real_stock(item):
    return max(0, number(item.get("stock")))


def origin_available_stock(item):
    stock = real_stock(item)
    confirmed_stock = item.get("confirmed_stock")
    if confirmed_stock is None or str(confirmed_stock).strip() == "":
        return stock
    return min(stock, max(0, number(confirmed_stock)))


def normalize_monthly_avg_sales(value):
    parsed = number(value)
    if parsed <= 0:
        return 0
    return round(parsed * 3) / 3


def monthly_to_daily(value):
    return normalize_monthly_avg_sales(value) / 30


def daily_to_monthly(value):
    return normalize_monthly_avg_sales(value * 30)


def own_daily_sales(item):
    monthly_daily = monthly_to_daily(item.get("monthly_avg_sales"))
    if monthly_daily > 0:
        return monthly_daily

    stock = available_stock(item)
    stock_days = number(item.get("stock_days"))
    if stock > 0 and stock_days > 0:
        return stock / stock_days

    return 0


def effective_stock_days(item, daily_sales):
    stock_days = number(item.get("stock_days"))
    if daily_sales > 0:
        return available_stock(item) / daily_sales
    return stock_days if stock_days > 0 else 0


def destination_need_quantity(stock_days, daily_sales, target_days):
    exact_need = (target_days - stock_days) * daily_sales
    if exact_need <= 0:
        return 0
    return max(0, math.floor(exact_need + 0.000001))


def route_priority(origin_item, destination_item, branch_logistics):
    origin_code = store_code(origin_item.get("store_code"))
    destination_code = store_code(destination_item.get("store_code"))
    origin = branch_logistics.get(origin_code, {})
    destination = branch_logistics.get(destination_code, {})
    origin_uf = str(origin.get("uf") or "").strip().upper()
    destination_uf = str(destination.get("uf") or "").strip().upper()

    if origin_uf and destination_uf and origin_uf != destination_uf:
        return 999

    origin_group = str(origin.get("group") or "").strip().upper()
    destination_group = str(destination.get("group") or "").strip().upper()
    origin_city = str(origin.get("city") or "").strip().upper()
    destination_city = str(destination.get("city") or "").strip().upper()

    if origin_city and destination_city and origin_city == destination_city:
        return 1

    origin_area = inferred_store_area(origin_item)
    destination_area = inferred_store_area(destination_item)
    if origin_area and destination_area and origin_area == destination_area:
        return 1

    if origin_group and destination_group and origin_group == destination_group:
        return 2

    if origin_uf and destination_uf and origin_uf == destination_uf and origin_group and destination_group:
        return 4

    try:
        distance = abs(int(origin_code) - int(destination_code))
    except ValueError:
        return 5

    if distance <= 2:
        return 3
    if distance <= 5:
        return 4
    return 5


def best_route_priority_for_destination(destination, origins, branch_logistics):
    best_priority = 999

    for origin in origins:
        if origin["remaining"] <= 0:
            continue
        if store_code(origin["item"].get("store_code")) == store_code(destination["item"].get("store_code")):
            continue
        best_priority = min(best_priority, route_priority(origin["item"], destination["item"], branch_logistics))

    return best_priority


def curve_move_priority(origin_item, destination_item):
    origin_rank = stock_curve_rank(origin_item.get("curve"))
    destination_rank = stock_curve_rank(destination_item.get("curve"))

    if not origin_rank or not destination_rank:
        return 999

    improvement = origin_rank - destination_rank
    if improvement <= 0:
        return 200 + origin_rank + destination_rank

    return ((5 - improvement) * 20) + ((5 - origin_rank) * 3) + destination_rank


def best_curve_move_priority_for_destination(destination, origins):
    best_priority = 999

    for origin in origins:
        if origin["remaining"] <= 0:
            continue
        if store_code(origin["item"].get("store_code")) == store_code(destination["item"].get("store_code")):
            continue
        best_priority = min(best_priority, curve_move_priority(origin["item"], destination["item"]))

    return best_priority


def destination_tie_key(origin, destination, priority, open_need):
    return "|".join([
        str(priority),
        str(curve_move_priority(origin["item"], destination["item"])),
        str(round(number(destination["item"].get("stock_days")), 2)),
        str(max(0, math.floor(open_need))),
    ])


def format_tie_quantity(value):
    return str(max(0, math.floor(number(value))))


def destination_allocation_key(destination):
    return store_code(destination["item"].get("store_code"))


def destination_open_need(destination, allocated_by_destination):
    return max(0, number(destination.get("need")) - allocated_by_destination.get(destination_allocation_key(destination), 0))


def destination_tie_info(ean, origin, destination, priority, destinations, allocated_by_destination, branch_logistics, max_route_priority):
    current_open_need = destination_open_need(destination, allocated_by_destination)
    tie_key = destination_tie_key(origin, destination, priority, current_open_need)
    tied_destinations = []

    for candidate in destinations:
        open_need = destination_open_need(candidate, allocated_by_destination)
        candidate_priority = route_priority(origin["item"], candidate["item"], branch_logistics)
        if open_need <= 0:
            continue
        if store_code(candidate["item"].get("store_code")) == store_code(origin["item"].get("store_code")):
            continue
        if candidate_priority > max_route_priority:
            continue
        if destination_tie_key(origin, candidate, candidate_priority, open_need) == tie_key:
            tied_destinations.append({"destination": candidate, "priority": candidate_priority, "open_need": open_need})

    total_need = sum(candidate["open_need"] for candidate in tied_destinations)
    origin_stock = max(0, math.floor(number(origin.get("remaining"))))

    return {
        "group_key": f"{ean}:{store_code(origin['item'].get('store_code'))}:{tie_key}",
        "tied_destinations": tied_destinations,
        "total_need": total_need,
        "origin_stock": origin_stock,
        "decision_required": len(tied_destinations) > 1 and total_need > origin_stock,
    }


def build_suggestion(ean, origin, destination, quantity, need, priority, index, tie_candidate_count=0, tie_total_need=0, tie_origin_stock=0, decision_group_key=""):
    origin_item = origin["item"]
    destination_item = destination["item"]
    return {
        "id": f"{ean}:{origin_item.get('store_code')}:{destination_item.get('store_code')}:{index}",
        "originCode": store_code(origin_item.get("store_code")),
        "originName": origin_item.get("store_name") or "",
        "destinationCode": store_code(destination_item.get("store_code")),
        "destinationName": destination_item.get("store_name") or "",
        "erpCode": origin_item.get("erp_code") or destination_item.get("erp_code") or "",
        "ean": ean,
        "description": destination_item.get("product_description") or "",
        "quantity": quantity,
        "maxQuantity": quantity,
        "originStock": number(origin_item.get("stock")),
        "originAvailableStock": number(origin.get("available_stock")),
        "originConfirmedStock": number(origin_item.get("confirmed_stock")),
        "originMonthlyAvgSales": normalize_monthly_avg_sales(origin_item.get("monthly_avg_sales")),
        "originCurve": origin_item.get("curve") or "",
        "originConfirmedPurchase": number(origin_item.get("confirmed_purchase")),
        "originConfirmedTransfer": number(origin_item.get("confirmed_transfer")),
        "destinationStock": number(destination_item.get("stock")),
        "destinationConfirmedStock": number(destination_item.get("confirmed_stock")),
        "destinationMonthlyAvgSales": normalize_monthly_avg_sales(destination_item.get("monthly_avg_sales")),
        "destinationCurve": destination_item.get("curve") or "",
        "destinationConfirmedPurchase": number(destination_item.get("confirmed_purchase")),
        "destinationConfirmedTransfer": number(destination_item.get("confirmed_transfer")),
        "originDailySales": monthly_to_daily(origin_item.get("monthly_avg_sales")),
        "destinationDailySales": monthly_to_daily(destination_item.get("monthly_avg_sales")),
        "originStockDays": number(origin_item.get("stock_days")),
        "destinationStockDays": number(destination_item.get("stock_days")),
        "destinationNeed": need,
        "routePriority": priority,
        "decisionRequired": tie_candidate_count > 1,
        "decisionResolved": False,
        "decisionReason": f"Empate de calculo: {tie_candidate_count} destinos disputam {format_tie_quantity(tie_total_need)} un. da origem {origin_item.get('store_name') or store_code(origin_item.get('store_code'))}, que tem {format_tie_quantity(tie_origin_stock)} un. disponivel. Ajuste as quantidades ou aceite a sugestao antes de confirmar." if tie_candidate_count > 1 else "",
        "decisionGroupKey": decision_group_key,
        "tieCandidateCount": tie_candidate_count,
    }


def calculate(payload):
    stock_items = payload.get("stockItems") or []
    filters = payload.get("filters") or {}
    rules = payload.get("rules") or {}
    branch_logistics = payload.get("branchLogistics") or {}
    selected_origins = {store_code(code) for code in filters.get("origins") or []}
    selected_destinations = {store_code(code) for code in filters.get("destinations") or []}
    selected_products = {str(ean) for ean in filters.get("products") or [] if ean}
    origin_minimum_days = number(rules.get("originMinimumDays"))
    destination_target_days = number(rules.get("destinationTargetDays"))
    max_route_priority = number(rules.get("maxRoutePriority"))
    selected_origin_curves = {stock_curve(curve) for curve in rules.get("originCurves") or [] if stock_curve(curve)}
    selected_destination_curves = {stock_curve(curve) for curve in rules.get("destinationCurves") or [] if stock_curve(curve)}
    grouped = {}
    missing_erp_code = 0

    for item in stock_items:
        ean = str(item.get("ean") or "")
        if not ean:
            continue
        if not item.get("erp_code"):
            missing_erp_code += 1
        if selected_products and ean not in selected_products:
            continue
        grouped.setdefault(ean, []).append(item)

    suggestions = []
    eligible_origins = 0
    eligible_destinations = 0
    blocked_different_uf = 0
    blocked_route = 0

    for ean, items in grouped.items():
        origins = []
        for item in items:
            code = store_code(item.get("store_code"))
            if selected_origins and code not in selected_origins:
                continue
            if not branch_can_send(code, branch_logistics):
                continue
            if selected_origin_curves and stock_curve(item.get("curve")) not in selected_origin_curves:
                continue
            stock = origin_available_stock(item)
            if stock <= 0:
                continue
            daily_sales = own_daily_sales(item)
            stock_days = stock / daily_sales if daily_sales > 0 else number(item.get("stock_days"))
            protected_stock = daily_sales * origin_minimum_days if daily_sales > 0 else 0
            remaining = max(0, math.floor(stock - protected_stock))
            if remaining > 0:
                enriched_item = {
                    **item,
                    "monthly_avg_sales": daily_to_monthly(daily_sales),
                    "stock_days": stock_days,
                }
                origins.append({"item": enriched_item, "available_stock": stock, "remaining": remaining})

        origins.sort(
            key=lambda origin: number(origin["item"].get("stock_days")),
            reverse=True,
        )
        eligible_origins += len(origins)

        destinations = []
        for item in items:
            code = store_code(item.get("store_code"))
            if selected_destinations and code not in selected_destinations:
                continue
            if not branch_can_receive(code, branch_logistics):
                continue
            if selected_destination_curves and stock_curve(item.get("curve")) not in selected_destination_curves:
                continue
            stock = available_stock(item)
            daily_sales = own_daily_sales(item)
            stock_days = effective_stock_days(item, daily_sales)
            if daily_sales <= 0 or stock_days >= destination_target_days:
                continue
            need = destination_need_quantity(stock_days, daily_sales, destination_target_days)
            if need > 0:
                enriched_item = {
                    **item,
                    "stock": stock,
                    "monthly_avg_sales": daily_to_monthly(daily_sales),
                    "stock_days": stock_days,
                }
                destinations.append({"item": enriched_item, "need": need})

        destinations.sort(key=lambda destination: (best_route_priority_for_destination(destination, origins, branch_logistics), best_curve_move_priority_for_destination(destination, origins), number(destination["item"].get("stock_days")), -number(destination.get("need"))))
        eligible_destinations += len(destinations)

        allocated_by_destination = {}
        handled_destination_tie_groups = set()

        for destination in destinations:
            remaining_need = destination_open_need(destination, allocated_by_destination)
            ranked_origins = []
            for origin in origins:
                if origin["remaining"] <= 0:
                    continue
                if store_code(origin["item"].get("store_code")) == store_code(destination["item"].get("store_code")):
                    continue

                priority = route_priority(origin["item"], destination["item"], branch_logistics)
                if priority <= max_route_priority:
                    ranked_origins.append((origin, priority))
                elif priority == 999:
                    blocked_different_uf += 1
                else:
                    blocked_route += 1

            ranked_origins.sort(key=lambda item: (item[1], curve_move_priority(item[0]["item"], destination["item"]), -number(item[0]["item"].get("stock_days"))))

            for origin, priority in ranked_origins:
                remaining_need = destination_open_need(destination, allocated_by_destination)
                if remaining_need <= 0 or origin["remaining"] <= 0:
                    break

                tie_info = destination_tie_info(ean, origin, destination, priority, destinations, allocated_by_destination, branch_logistics, max_route_priority)
                if tie_info["decision_required"]:
                    if tie_info["group_key"] in handled_destination_tie_groups:
                        continue

                    handled_destination_tie_groups.add(tie_info["group_key"])
                    remaining_origin_stock = tie_info["origin_stock"]
                    for candidate in tie_info["tied_destinations"]:
                        quantity = min(remaining_origin_stock, candidate["open_need"])
                        candidate_key = destination_allocation_key(candidate["destination"])
                        suggestions.append(build_suggestion(
                            ean,
                            origin,
                            candidate["destination"],
                            quantity,
                            candidate["destination"]["need"],
                            candidate["priority"],
                            len(suggestions),
                            len(tie_info["tied_destinations"]),
                            tie_info["total_need"],
                            tie_info["origin_stock"],
                            tie_info["group_key"],
                        ))
                        if quantity > 0:
                            remaining_origin_stock -= quantity
                            allocated_by_destination[candidate_key] = allocated_by_destination.get(candidate_key, 0) + quantity
                    origin["remaining"] = remaining_origin_stock
                    continue

                quantity = min(origin["remaining"], remaining_need)
                if quantity <= 0:
                    continue
                origin["remaining"] -= quantity
                remaining_need -= quantity
                destination_key = destination_allocation_key(destination)
                allocated_by_destination[destination_key] = allocated_by_destination.get(destination_key, 0) + quantity
                suggestions.append(build_suggestion(ean, origin, destination, quantity, destination["need"], priority, len(suggestions)))

    return {
        "engine": "python",
        "suggestions": suggestions,
        "productGroups": len(grouped),
        "stockRows": len(stock_items),
        "eligibleOrigins": eligible_origins,
        "eligibleDestinations": eligible_destinations,
        "missingErpCode": missing_erp_code,
        "blockedDifferentUf": blocked_different_uf,
        "blockedRoute": blocked_route,
    }


def main():
    payload = json.loads(sys.stdin.read() or "{}")
    sys.stdout.write(json.dumps(calculate(payload), ensure_ascii=False))


if __name__ == "__main__":
    main()
