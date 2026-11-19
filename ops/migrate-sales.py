"""Replace the matching Pearl aggregate with legacy sales in a single SQLite transaction."""
import argparse
import json
from pathlib import Path

from gcc.core import Store, Problem
from gcc.financial import Financial
from pearl_sales import migrate


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--ledger', type=Path, required=True)
    parser.add_argument('--legacy', type=Path, required=True)
    parser.add_argument('--aggregate', required=True)
    args = parser.parse_args()
    if not args.ledger.is_file():
        raise Problem('Registrul existent este necesar.')
    sales = json.loads(args.legacy.read_text())
    result = migrate(Financial(Store(args.ledger)), sales, args.aggregate)
    print(f"Sales in financial ledger: {len(result['sales'])}")


if __name__ == '__main__':
    main()
