from decimal import Decimal
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from gcc.core import Store
from gcc.financial import Financial
from capital_history import allocate_ron, capital_history


class CapitalHistoryTest(unittest.TestCase):
    def test_allocate_keeps_fractional_currency_precision(self):
        total = Decimal('12.3455')
        allocated = allocate_ron(total, {'2024-02-01': Decimal(1), '2024-02-02': Decimal(3)})
        self.assertEqual(sum(allocated.values()), total)

    def test_vast_accrual_replaces_matching_receipt_and_carries_opening_capital(self):
        with TemporaryDirectory() as folder:
            finance = Financial(Store(Path(folder) / 'test.sqlite3'))
            finance.transaction({'type':'purchase','cash_status':'paid','currency':'RON','amount':'100',
                                 'description':'Hardware','date':'2024-01-01'}, 'test')
            finance.transaction({'type':'revenue','cash_status':'received','activity':'vast','currency':'USD',
                                 'amount':'10','description':'Vast aggregate','exchange_rate':'4.75',
                                 'fx_source':'Fixture'}, 'test')
            with finance.store.db() as db:
                db.execute('INSERT INTO fin_sync VALUES (?,?,?,?,?,?)',
                           ('vast-owner-report-fixture',1,'ok','2024-01-02','2024-01-03','Fixture'))
                for day, amount in [('2024-01-02','4'),('2024-01-03','6')]:
                    db.execute('INSERT INTO fin_vast_daily VALUES (?,?,?,?,?,?)',
                               (day,amount,'{}',1,'2024-01-02','2024-01-03'))
            series = capital_history(finance, Path(folder) / 'missing.json', start='2024-01-02')
            self.assertEqual(series['reconstructed'], ['vast'])
            self.assertEqual(series['undated'], 0)
            self.assertEqual([p['recovered_ron'] for p in series['points']], [19.0,47.5])
            self.assertTrue(all(p['invested_ron']==100 for p in series['points']))
            self.assertEqual(len(finance.transactions()), 2)
