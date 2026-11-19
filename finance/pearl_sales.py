"""Unified Pearl sale details and audited ledger entries."""
import json
import time
from datetime import date, timedelta
from decimal import Decimal, InvalidOperation
from urllib.request import Request, urlopen

from gcc.core import Problem
from gcc.financial import audit, uid


def amount(value, precision, limit):
    try:
        result = Decimal(str(value))
        if not result.is_finite() or result < 0 or result > limit or result != result.quantize(precision):
            raise ValueError()
        return result
    except (InvalidOperation, ValueError):
        raise Problem('Sumă sau cantitate invalidă.') from None


def details(data):
    try:
        day = date.fromisoformat(data.get('date', ''))
    except (TypeError, ValueError):
        raise Problem('Completează data exactă a vânzării.') from None
    if day > date.today():
        raise Problem('Data vânzării este în viitor.')
    quantity = amount(data.get('quantity'), Decimal('.00000001'), 10**10)
    gross = amount(data.get('usd'), Decimal('.01'), 10**12)
    fee = amount(data.get('feeUsd', 0), Decimal('.01'), 10**12)
    note = str(data.get('note') or '').strip()
    if quantity <= 0 or fee > gross or len(note) > 250:
        raise Problem('Verifică suma, cantitatea, comisionul și nota.')
    return day.isoformat(), quantity, gross, fee, note


def rates_for(days):
    first = (date.fromisoformat(min(days)) - timedelta(days=7)).isoformat()
    last = max(days)
    url = f'https://api.frankfurter.dev/v1/{first}..{last}?base=USD&symbols=RON'
    try:
        with urlopen(Request(url, headers={'User-Agent': 'PearlMonitor/1.0'}), timeout=8) as response:
            choices = json.load(response, parse_float=Decimal)['rates']
        result = {}
        for day in days:
            lower = (date.fromisoformat(day) - timedelta(days=7)).isoformat()
            published = max(key for key in choices if lower <= key <= day and choices[key]['RON'] > 0)
            result[day] = {
                'exchange_rate': str(choices[published]['RON']), 'fx_date': published,
                'fx_source': 'Frankfurter · curs USD/RON de referință',
            }
        return result
    except (OSError, ValueError, KeyError, TypeError):
        raise Problem('Cursul istoric USD/RON este indisponibil.', 503) from None


SQL = """
SELECT m.*, t.id AS ledger_id, t.date AS ledger_date, t.amount AS ledger_usd,
       t.notes AS ledger_note, t.voided AS ledger_voided, t.version AS ledger_version,
       fee.amount AS ledger_fee, fee.id AS fee_id
FROM fin_mining m JOIN fin_transactions t ON t.external_id='pearl-detail:' || m.id
LEFT JOIN fin_transactions fee ON fee.external_id='pearl-fee:' || m.id AND fee.voided=0
WHERE m.event='sale' AND m.status='reconciled'
"""


def list_sales(db):
    active, archived = [], []
    for row in db.execute(SQL + ' ORDER BY t.date, t.created_at, m.id'):
        sale = {
            'id': row['id'], 'date': row['ledger_date'], 'quantity': float(row['tokens']),
            'usd': float(row['ledger_usd']), 'feeUsd': float(row['ledger_fee'] or 0),
            'note': row['ledger_note'] or '', 'version': row['ledger_version'],
        }
        (archived if row['ledger_voided'] else active).append(sale)
    return {'sales': active, 'archived': archived}


def cash_row(values, fx, fee=False):
    day, quantity, gross, commission, note = values
    return dict(fx, type='expense' if fee else 'revenue', activity='pearl',
        category='mining_fee' if fee else 'mining_sale',
        currency='USD', cash_status='paid' if fee else 'received',
        amount=str(commission if fee else gross), date=day, notes=note,
        description='Comision vânzare PRL' if fee else f'Vânzare PRL · {quantity}',
        reconciliation='reconciled')


def update_cash(db, finance, row, changes, actor):
    updated = finance._validate_tx(dict(row) | changes | {'reporting_amount': None})
    db.execute(f"UPDATE fin_transactions SET {','.join(key+'=?' for key in updated)},"
               "version=version+1,updated_at=?,voided=0 WHERE id=?",
               (*updated.values(), time.time(), row['id']))
    audit(db, actor, 'pearl_sale_updated', row['id'], dict(row), updated)


def toggle_cash(db, row, voided, actor):
    db.execute('UPDATE fin_transactions SET voided=?,version=version+1,updated_at=? WHERE id=?',
               (int(voided), time.time(), row['id']))
    audit(db, actor, 'pearl_sale_archived' if voided else 'pearl_sale_restored',
          row['id'], dict(row), {'voided': voided})


def save(db, finance, sid, values, fx, actor, aggregate=None):
    day, quantity, gross, commission, note = values
    transaction = db.execute('SELECT * FROM fin_transactions WHERE external_id=?', ('pearl-detail:'+sid,)).fetchone()
    fee = db.execute('SELECT * FROM fin_transactions WHERE external_id=?', ('pearl-fee:'+sid,)).fetchone()
    cash = cash_row(values, fx)
    if transaction:
        update_cash(db, finance, transaction, cash, actor)
        tid = transaction['id']
    else:
        tid = finance._insert(db, cash | {'external_id':'pearl-detail:'+sid}, actor)
    if commission > 0:
        cash = cash_row(values, fx, fee=True)
        if fee:
            update_cash(db, finance, fee, cash, actor)
        else:
            finance._insert(db, cash | {'external_id':'pearl-fee:'+sid}, actor, detect_duplicate=False)
    elif fee and not fee['voided']:
        toggle_cash(db, fee, True, actor)
    db.execute("""
        INSERT INTO fin_mining (id,activity,date,event,tokens,usd_proceeds,sale_price,fees_usd,wallet,transaction_id,notes,reconciles_id,status)
        VALUES (?,'pearl',?,'sale',?,?,?,?, '',?, ?,?,'reconciled')
        ON CONFLICT(id) DO UPDATE SET date=excluded.date,tokens=excluded.tokens,usd_proceeds=excluded.usd_proceeds,
        sale_price=excluded.sale_price,fees_usd=excluded.fees_usd,notes=excluded.notes
    """, (sid, day, str(quantity), str(gross), str(gross/quantity), str(commission), tid, note, aggregate))
    return tid


def endpoint(finance, data, actor):
    if data is None:
        with finance.store.db() as db:
            return list_sales(db)
    action = data.get('action')
    if action not in ('create', 'update', 'archive', 'restore'):
        raise Problem('Operație necunoscută.')
    values = details(data) if action in ('create', 'update') else None
    with finance.store.db() as db:
        previous = db.execute(SQL + ' AND m.id=?', (data.get('id'),)).fetchone() if action != 'create' else None
    if action != 'create' and (not previous or data.get('version') != previous['ledger_version']):
        raise Problem('Vânzarea s-a schimbat. Reîncarcă lista.', 409)
    rate = None
    if values:
        if previous and previous['ledger_date'] == values[0]:
            with finance.store.db() as db:
                r = db.execute('SELECT exchange_rate,fx_date,fx_source FROM fin_transactions WHERE id=?', (previous['ledger_id'],)).fetchone()
                rate = dict(r) if r['exchange_rate'] else None
        rate = rate or rates_for([values[0]])[values[0]]
    with finance.store.db() as db:
        db.execute('BEGIN IMMEDIATE')
        if previous:
            sid = previous['id']
            current = db.execute('SELECT * FROM fin_transactions WHERE id=?', (previous['ledger_id'],)).fetchone()
            if current['version'] != previous['ledger_version']:
                raise Problem('Vânzarea s-a schimbat. Reîncarcă lista.', 409)
            if action in ('archive', 'restore'):
                voided = action == 'archive'
                toggle_cash(db, current, voided, actor)
                fee = db.execute('SELECT * FROM fin_transactions WHERE external_id=?', ('pearl-fee:'+sid,)).fetchone()
                if fee and Decimal(previous['fees_usd'] or '0') > 0:
                    toggle_cash(db, fee, voided, actor)
            else:
                if current['voided']:
                    raise Problem('Restaurează vânzarea înainte de editare.', 409)
                save(db, finance, sid, values, rate, actor)
        else:
            save(db, finance, uid(), values, rate, actor)
        return list_sales(db)


def migrate(finance, legacy, aggregate_id, actor='pearl-import'):
    if not isinstance(legacy,list) or not legacy:
        raise Problem('Lista de vânzări este goală.')
    items = [(row['id'], details(row)) for row in legacy]
    if len(set(sid for sid, _ in items)) != len(items):
        raise Problem('Identificatori de vânzare duplicați.')
    converted = rates_for({row[0] for _, row in items})
    with finance.store.db() as db:
        db.execute('BEGIN IMMEDIATE')
        old = db.execute("SELECT * FROM fin_transactions WHERE id=? AND activity='pearl' AND type='revenue'", (aggregate_id,)).fetchone()
        if not old or old['currency'] != 'USD':
            raise Problem('Agregatul Pearl nu a fost găsit.')
        if old['voided']:
            if all(db.execute('SELECT id FROM fin_mining WHERE id=? AND reconciles_id=?', (sid, aggregate_id)).fetchone() for sid, _ in items):
                return list_sales(db)
            raise Problem('Agregatul este deja arhivat.')
        if sum(values[2] for _, values in items) != Decimal(old['amount']):
            raise Problem('Vânzările importate nu corespund agregatului USD.')
        allocations = db.execute('SELECT * FROM fin_allocations WHERE transaction_id=?', (aggregate_id,)).fetchall()
        for sid, values in items:
            tid = save(db, finance, sid, values, converted[values[0]], actor, aggregate_id)
            for allocation in allocations:
                db.execute('INSERT INTO fin_allocations VALUES (?,?,?,?,?)',
                           (uid(), tid, allocation['rig_id'], allocation['share_pct'], allocation['notes']))
        toggle_cash(db, old, True, actor)
        audit(db, actor, 'pearl_aggregate_replaced', aggregate_id, dict(old), {'sales':len(items), 'rates':'Frankfurter'})
        return list_sales(db)
