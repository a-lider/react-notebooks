import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

interface Column {
  key: string
  label: string
  align?: 'left' | 'right'
}

interface DataTableProps {
  columns: Column[]
  rows: Record<string, string | number>[]
}

export function DataTable({ columns, rows }: DataTableProps) {
  return (
    <div className="rounded-xl border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            {columns.map((c) => (
              <TableHead key={c.key} className={c.align === 'right' ? 'text-right' : ''}>
                {c.label}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row, i) => (
            <TableRow key={i}>
              {columns.map((c) => (
                <TableCell
                  key={c.key}
                  className={c.align === 'right' ? 'text-right tabular-nums' : ''}
                >
                  {typeof row[c.key] === 'number'
                    ? (row[c.key] as number).toLocaleString('en-US')
                    : row[c.key]}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
