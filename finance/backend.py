"""Serve the existing financial ledger without starting GPU Control Center or its workers."""
from hmac import compare_digest
from pathlib import Path
from urllib.parse import parse_qs
from types import SimpleNamespace
import os
import sys

from gcc.core import Problem, Store
from gcc.financial import Financial, day
from gcc.financial_api import route
from gcc.http import Handler, Limiter, Server
from gcc.vast import Vast
from gcc.worker import Worker
from pearl_sales import endpoint as pearl_sales
from capital_history import capital_history


class FinanceHandler(Handler):
    def route(self):
        app = self.server.app
        if not compare_digest(self.headers.get('X-Pearl-Finance-Key', ''), app.secret):
            raise Problem('Acces financiar nepermis.', 403)
        app.limiter.check('pearl', 180)
        url = self.path_info()
        if not url.path.startswith('/api/financial/'):
            raise Problem('Rută financiară inexistentă.', 404)
        if self.command not in ('GET', 'POST'):
            raise Problem('Metodă nepermisă.', 405)
        limit = 393216 if url.path.endswith('/receipt') else 65536
        body = self.body(limit) if self.command == 'POST' else None
        if url.path == '/api/financial/rig-activity' and self.command == 'GET':
            machines = {machine['id']: machine for machine in app.vast.machines()}
            result = {}
            for rig in app.financial.collections()['rigs']:
                machine = machines.get(rig['vast_id'])
                if machine:
                    rented = machine.get('rented')
                    result[rig['id']] = 'active' if machine.get('online') is True and isinstance(rented, int) and rented > 0 else 'idle' if rented == 0 else 'unknown'
            return self.send(200, result)
        if url.path == '/api/financial/capital-history' and self.command == 'GET':
            query = parse_qs(url.query)
            start = day(query.get('start', [None])[0])
            end = day(query.get('end', [None])[0])
            if start and end and start > end:
                raise Problem('Interval de date invalid.')
            archive = Path(__file__).resolve().parent.parent / 'data/pearl-credited-days.json'
            return self.send(200, capital_history(app.financial, archive, start, end))
        if url.path == '/api/financial/pearl-sales':
            return self.send(200, pearl_sales(app.financial, body, 'pearl-monitor'))
        if body and url.path in ('/api/financial/transaction', '/api/financial/bulk'):
            ids = body.get('ids', []) if url.path.endswith('/bulk') else [body.get('id')]
            if isinstance(ids, list):
                with app.store.db() as db:
                    for transaction_id in ids[:100]:
                        if not isinstance(transaction_id, str):
                            continue
                        managed = db.execute("""SELECT 1 FROM fin_transactions t JOIN fin_mining m
                            ON t.external_id IN ('pearl-detail:' || m.id, 'pearl-fee:' || m.id)
                            WHERE t.id=? AND m.status='reconciled'""", (transaction_id,)).fetchone()
                        if managed:
                            raise Problem('Editează această vânzare Pearl în Portofoliu.', 409)
        route(self, url.path, url.query, body, 'pearl-monitor')


def main():
    database = Path(os.environ['PEARL_FINANCE_DATABASE'])
    if not database.is_file():
        sys.exit('Existing finance database required')
    store = Store(database)
    vast = Vast()
    port = int(os.environ['PEARL_FINANCE_PORT'])
    with Server(('127.0.0.1', port), FinanceHandler) as server:
        server.app = SimpleNamespace(
            store=store, vast=vast, worker=Worker(store, vast),
            financial=Financial(store), limiter=Limiter(), secret=os.environ['PEARL_FINANCE_TOKEN'],
        )
        server.serve_forever()


if __name__ == '__main__':
    main()
