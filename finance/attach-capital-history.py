"""Attach Pearl's portfolio chronology to the shared finance editor at build time."""
from pathlib import Path
import sys

path = Path(sys.argv[1])
source = path.read_text()
anchor = '            <Box\n              title="Evoluția capitalului"'
if source.count(anchor) != 1:
    raise SystemExit("Cannot locate the capital chart in the pinned finance editor")
start = source.index(anchor)
end = source.index('            </Box>', start) + len('            </Box>')
original = source[start:end]
replacement = ('            {query.rig_id || query.activity || query.search || query.include_voided ? (\n'
               + original + '\n            ) : (\n'
               '              <CapitalEvolution start={query.start} end={query.end} />\n'
               '            )}')
path.write_text('import CapitalEvolution from "../capital-evolution";\n' + source[:start] + replacement + source[end:])
