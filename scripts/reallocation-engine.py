import json
import math
import sys


def number(value):
    try:
        return float(value or 0)
    except (TypeError, ValueError):
        return 0.0


def store_code(value):
    return str(value or "").zfill(2)


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

    if origin_group and destination_group and origin_group == destination_group:
        return 0
    if origin_city and destination_city and origin_city == destination_city:
        return 10
    if origin_group and destination_group:
        return 50

    try:
        return abs(int(origin_code) - int(destination_code))
    except ValueError:
        return 99


def build_suggestion(ean, origin, destination, quantity, need, priority, index):
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
        "originConfirmedStock": number(origin_item.get("confirmed_stock")),
        "originMonthlyAvgSales": number(origin_item.get("monthly_avg_sales")),
        "originCurve": origin_item.get("curve") or "",
        "originConfirmedPurchase": number(origin_item.get("confirmed_purchase")),
        "originConfirmedTransfer": number(origin_item.get("confirmed_transfer")),
        "destinationStock": number(destination_item.get("stock")),
        "destinationConfirmedStock": number(destination_item.get("confirmed_stock")),
        "destinationMonthlyAvgSales": number(destination_item.get("monthly_avg_sales")),
        "destinationCurve": destination_item.get("curve") or "",
        "destinationConfirmedPurchase": number(destination_item.get("confirmed_purchase")),
        "destinationConfirmedTransfer": number(destination_item.get("confirmed_transfer")),
        "originDailySales": number(origin_item.get("monthly_avg_sales")) / 30,
        "destinationDailySales": number(destination_item.get("monthly_avg_sales")) / 30,
        "originStockDays": number(origin_item.get("stock_days")),
        "destinationStockDays": number(destination_item.get("stock_days")),
        "destinationNeed": need,
        "routePriority": priority,
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
    need_days_threshold = number(rules.get("needDaysThreshold"))
    destination_target_days = number(rules.get("destinationTargetDays"))
    max_route_priority = number(rules.get("maxRoutePriority"))
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
            stock = number(item.get("stock"))
            if stock <= 0:
                continue
            daily_sales = number(item.get("monthly_avg_sales")) / 30
            protected_stock = daily_sales * origin_minimum_days if daily_sales > 0 else 0
            remaining = max(0, math.floor(stock - protected_stock))
            if remaining > 0:
                origins.append({"item": item, "remaining": remaining})

        origins.sort(key=lambda origin: number(origin["item"].get("stock_days")), reverse=True)
        eligible_origins += len(origins)

        destinations = []
        for item in items:
            code = store_code(item.get("store_code"))
            if selected_destinations and code not in selected_destinations:
                continue
            daily_sales = number(item.get("monthly_avg_sales")) / 30
            stock_days = number(item.get("stock_days"))
            if daily_sales <= 0 or stock_days > need_days_threshold:
                continue
            need = max(0, math.ceil((destination_target_days - stock_days) * daily_sales))
            if need > 0:
                destinations.append({"item": item, "need": need})

        destinations.sort(key=lambda destination: number(destination["item"].get("stock_days")))
        eligible_destinations += len(destinations)

        for destination in destinations:
            remaining_need = destination["need"]
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

            ranked_origins.sort(key=lambda item: (item[1], -number(item[0]["item"].get("stock_days"))))

            for origin, priority in ranked_origins:
                if remaining_need <= 0 or origin["remaining"] <= 0:
                    break
                quantity = min(origin["remaining"], remaining_need)
                if quantity <= 0:
                    continue
                origin["remaining"] -= quantity
                remaining_need -= quantity
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
