"""Serve the existing financial ledger without starting GPU Control Center or its workers."""
from hmac import compare_digest
from pathlib import Path
from types import SimpleNamespace
import os
import sys

from gcc.core import Problem, Store
from gcc.financial import Financial
from gcc.financial_api import route
from gcc.http import Handler, Limiter, Server
from gcc.vast import Vast
from gcc.worker import Worker


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
