"""Reconstruct portfolio recovery from daily earning weights without changing cash entries."""
from collections import defaultdict
from datetime import date, timedelta
from decimal import Decimal, ROUND_FLOOR, ROUND_HALF_UP
import json
from pathlib import Path


def allocate_ron(total, weights):
    scale = 10 ** max(2, -total.as_tuple().exponent)
    units = int(total * scale)
    weight_sum = sum(weights.values())
    if not weights or not weight_sum or units < 0:
        return {}
    fractions = {day: units * weight / weight_sum for day, weight in weights.items()}
    amounts = {day: int(amount.to_integral_value(rounding=ROUND_FLOOR)) for day, amount in fractions.items()}
    remainder = units - sum(amounts.values())
    for day in sorted(amounts, key=lambda item: (-fractions[item] + amounts[item], item))[:remainder]:
        amounts[day] += 1
    return {day: Decimal(units) / scale for day, units in amounts.items() if units}


def historical_sources(transactions, rows, report, mining, archive):
    output = {}
    excluded = set()
    revenues = [row for row in transactions if row['type'] == 'revenue' and row['cash_status'] == 'received'
                and row['currency'] == 'USD' and row['reporting_amount'] is not None]

    if report:
        start, end = report['start_date'], report['end_date']
        weights = {row['day']: Decimal(row['total_usd']).quantize(Decimal('.01'))
                   for row in rows if start <= row['day'] <= end}
        matching = [row for row in revenues if row['activity'] == 'vast' and not row['date']
                    and Decimal(row['amount']) == sum(weights.values())]
        if len(matching) == 1:
            entry = matching[0]
            amounts = allocate_ron(Decimal(entry['reporting_amount']), weights)
            if amounts:
                output['vast'] = amounts
                excluded.add(entry['id'])

    weights = {day: Decimal(str(payload['allocatedUsd']))
               for day, payload in (archive or {}).get('days', {}).items() if 'allocatedUsd' in payload}
    if weights:
        batches = defaultdict(set)
        for row in mining:
            if row['reconciles_id']:
                batches[row['reconciles_id']].add('pearl-detail:' + row['id'])
        candidates = []
        for ids in batches.values():
            entries = [row for row in revenues if row['activity'] == 'pearl' and row['external_id'] in ids]
            if entries and len(entries) == len(ids) and sum(Decimal(row['amount']) for row in entries) == sum(weights.values()):
                candidates.append(entries)
        if len(candidates) == 1:
            entries = candidates[0]
            amounts = allocate_ron(sum(Decimal(row['reporting_amount']) for row in entries), weights)
            if amounts:
                output['pearl'] = amounts
                excluded.update(row['id'] for row in entries)
    return output, excluded


def capital_history(finance, archive_path, start=None, end=None):
    transactions = finance.transactions()
    try:
        archive = json.loads(Path(archive_path).read_text())
    except FileNotFoundError:
        archive = None
    with finance.store.db() as db:
        vast = [dict(row) for row in db.execute('SELECT day,total_usd FROM fin_vast_daily')]
        report = db.execute("SELECT start_date,end_date FROM fin_sync WHERE id LIKE 'vast-owner-report-%' AND status='ok' ORDER BY at DESC LIMIT 1").fetchone()
        mining = [dict(row) for row in db.execute("SELECT id,reconciles_id FROM fin_mining WHERE event='sale' AND status='reconciled'")]
    reconstructed, excluded = historical_sources(transactions, vast, report, mining, archive)
    events = defaultdict(lambda: defaultdict(Decimal))
    undated = 0
    undated_sales = Decimal(0)
    for row in transactions:
        if row['id'] in excluded or row['cash_status'] not in ('paid', 'received'):
            continue
        if not row['date'] or row['reporting_amount'] is None:
            undated += 1
            if row['type'] == 'sale' and row['reporting_amount'] is not None:
                undated_sales += Decimal(row['reporting_amount'])
            continue
        amount = Decimal(row['reporting_amount'])
        day = events[row['date']]
        kind = row['type']
        if kind in ('purchase', 'sale', 'refund'):
            day['capital'] += amount if kind == 'purchase' else -amount
        elif kind == 'revenue':
            key = row['activity'] if row['activity'] in ('vast', 'pearl') else 'other'
            day[key] += amount
        elif kind == 'expense':
            day['expenses'] += amount
        elif kind == 'adjustment':
            day['adjustment'] += amount
    for key, amounts in reconstructed.items():
        for day, amount in amounts.items():
            events[day][key] += amount
    metadata = {'reconstructed': list(reconstructed), 'undated': undated, 'undatedSalesRon': float(undated_sales)}
    if not events:
        return {'points': [], **metadata}
    first = date.fromisoformat(min(events))
    last = date.fromisoformat(min(max(events), end)) if end else date.fromisoformat(max(events))
    visible = date.fromisoformat(start) if start else first
    running = defaultdict(Decimal)
    points = []
    def lei(value): return float(value.quantize(Decimal(".01"), rounding=ROUND_HALF_UP))
    for offset in range((last - first).days + 1):
        day = first + timedelta(days=offset)
        iso = day.isoformat()
        values = events.get(iso, {})
        for key, value in values.items():
            running[key] += value
        if day < visible:
            continue
        recovered = sum(running[key] for key in ('vast', 'pearl', 'other'))
        remaining = max(Decimal(0), running['capital'] - recovered + running['expenses'] - running['adjustment'])
        points.append({
            'date': iso, 'invested_ron': lei(running['capital']), 'recovered_ron': lei(recovered),
            'vast_ron': lei(running['vast']), 'pearl_ron': lei(running['pearl']),
            'remaining_ron': lei(remaining),
        })
    return {'points': points, **metadata}
