from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

from gcc.core import Store
from gcc.financial import Financial
from pearl_sales import migrate, endpoint


class UnifiedSalesTest(unittest.TestCase):
    @patch('pearl_sales.rates_for', return_value={
        '2024-11-13': {'exchange_rate':'4.60', 'fx_date':'2024-11-13', 'fx_source':'test fixture'},
    })
    def test_import_update_archive_restore(self, _):
        with TemporaryDirectory() as temp:
            finance = Financial(Store(Path(temp) / 'ledger.sqlite3'))
            aggregate = finance.transaction({
                'type':'revenue', 'activity':'pearl', 'cash_status':'received',
                'currency':'USD', 'amount':'12.30', 'description':'Aggregate',
            }, 'test')['id']
            rows = [{'id':'legacy-1','date':'2024-11-13','quantity':'10.50','usd':'12.30'}]
            sale = migrate(finance, rows, aggregate)['sales'][0]
            self.assertEqual(len(finance.transactions()), 1)
            self.assertEqual(len(migrate(finance, rows, aggregate)['sales']), 1)
            sale = endpoint(finance, {**sale,'action':'update','feeUsd':'0.25'}, 'test')['sales'][0]
            self.assertEqual(sale['feeUsd'], .25)
            self.assertEqual(len(finance.transactions()), 2)
            archived = endpoint(finance, {**sale,'action':'archive'}, 'test')
            self.assertEqual(archived['sales'], [])
            self.assertEqual(finance.transactions(), [])
            restored = endpoint(finance, {**archived['archived'][0],'action':'restore'}, 'test')
            self.assertEqual(restored['sales'][0]['feeUsd'], .25)
            self.assertEqual(len(finance.transactions()), 2)


if __name__ == '__main__':
    unittest.main()
